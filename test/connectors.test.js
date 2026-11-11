"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const {
  SharePointAdapter,
  SalesforceAdapter,
  Cirrus8Adapter,
  makeTransport,
} = require("../src/connectors");
const { validateExtraction, extractDocument } = require("../src/extraction");
test("Graph delta pagination retains changes, rename, tombstones and final cursor", async () => {
  const requests = [];
  const adapter = new SharePointAdapter({
    driveId: "d1",
    request: async (path) => {
      requests.push(path);
      return requests.length === 1
        ? {
            value: [{ id: "1", file: {}, name: "renamed.pdf", eTag: "v2" }],
            "@odata.nextLink":
              "https://graph.microsoft.com/v1.0/drives/d1/root/delta?page=2",
          }
        : {
            value: [{ id: "2", deleted: {} }],
            "@odata.deltaLink":
              "https://graph.microsoft.com/v1.0/drives/d1/root/delta?token=end",
          };
    },
    mapItem: async (i) => ({ id: i.id, name: i.name, version: i.eTag }),
  });
  const r = await adapter.sync();
  assert.equal(requests.length, 2);
  assert.equal(r.records[0].name, "renamed.pdf");
  assert.equal(r.records[1].deleted, true);
  assert.ok(r.cursor.endsWith("token=end"));
});
test("Graph hostile pagination and foreign drive cursor are rejected", async () => {
  const adapter = new SharePointAdapter({
    driveId: "d1",
    request: async () => ({
      value: [],
      "@odata.nextLink": "https://evil.example/steal",
    }),
    mapItem: (i) => i,
  });
  await assert.rejects(adapter.sync(), /outside approved scope/);
  await assert.rejects(
    adapter.sync("https://graph.microsoft.com/v1.0/drives/other/root/delta"),
    /outside approved scope/,
  );
});
test("Salesforce queryAll pagination maps deleted rows and overlapping watermark", async () => {
  const requests = [];
  const a = new SalesforceAdapter({
    origin: "https://synthetic.my.salesforce.com",
    object: "Opportunity",
    fields: ["StageName"],
    request: async (path) => {
      requests.push(path);
      return requests.length === 1
        ? {
            records: [
              {
                Id: "1",
                StageName: "Closed Won",
                SystemModstamp: "2025-01-01T00:00:00Z",
              },
            ],
            done: false,
            nextRecordsUrl: "/services/data/v62.0/query/next",
          }
        : {
            records: [
              {
                Id: "2",
                IsDeleted: true,
                SystemModstamp: "2025-01-02T00:00:00Z",
              },
            ],
            done: true,
          };
    },
    mapRecord: (r) => ({ id: r.Id, status: r.StageName }),
  });
  const r = await a.sync("2025-01-02T00:00:00Z");
  assert.equal(requests.length, 2);
  assert.ok(
    decodeURIComponent(requests[0]).includes("2025-01-01T00:00:00.000Z"),
  );
  assert.equal(r.records[0].status, "Closed Won");
  assert.equal(r.records[1].deleted, true);
});
test("invalid Salesforce field mappings cannot inject SOQL", () =>
  assert.throws(
    () =>
      new SalesforceAdapter({
        origin: "https://x.my.salesforce.com",
        object: "Opportunity WHERE Id != null",
        fields: [],
      }),
    /Invalid Salesforce/,
  ));
test("Cirrus8 adapter preserves effective dates and null rent fields", async () => {
  const a = new Cirrus8Adapter({
    readFeed: async () => ({
      records: [{ id: "r1", effectiveAt: "2025-07-01", rent: null }],
      cursor: "new",
    }),
    mapRecord: (r) => ({ ...r }),
  });
  const r = await a.sync("old");
  assert.equal(r.records[0].rent, null);
  assert.equal(r.records[0].effectiveAt, "2025-07-01");
});
test("read-only transport honours throttling and never follows arbitrary URLs", async () => {
  let calls = 0;
  const sleeps = [];
  const request = makeTransport({
    origin: "https://graph.microsoft.com",
    token: async () => "synthetic",
    sleep: async (ms) => sleeps.push(ms),
    fetcher: async (url, init) => {
      calls++;
      assert.equal(init.redirect, "error");
      assert.equal(init.method, undefined);
      return calls === 1
        ? {
            ok: false,
            status: 429,
            headers: new Headers({ "retry-after": "1" }),
          }
        : { ok: true, json: async () => ({ ok: true }) };
    },
  });
  assert.deepEqual(await request("/v1.0/drives/d1"), { ok: true });
  assert.deepEqual(sleeps, [1000]);
  await assert.rejects(
    request("https://evil.example/"),
    /outside approved scope/,
  );
  assert.equal(calls, 2);
});
test("extraction rejects hallucinated digits, absent quotes and page zero", () => {
  const r = validateExtraction(
    {
      observations: [
        {
          measure: "sale_price",
          value: 999,
          unit: "AUD",
          basis: "net",
          quote: "sale_price 100",
          page: 0,
          confidence: 1,
        },
      ],
    },
    [{ text: "sale_price 100" }],
  );
  assert.ok(r[0].issues.includes("invalid page"));
  assert.ok(r[0].issues.includes("numeric value not supported by quote"));
});
test("PDF provider contract records model, pages and literal traceability", async () => {
  const r = await extractDocument({
    bytes: Buffer.from("%PDF-synthetic"),
    mime: "application/pdf",
    layoutProvider: async () => ({ pages: [{ text: "Value: 1,200 AUD" }] }),
    extractionProvider: async () => ({
      model: "mock-v1",
      observations: [
        {
          measure: "adopted_value",
          value: 1200,
          unit: "AUD",
          basis: "GST exclusive",
          page: 1,
          quote: "Value: 1,200 AUD",
          confidence: 1,
        },
      ],
    }),
  });
  assert.equal(r.model, "mock-v1");
  assert.deepEqual(r.observations[0].issues, []);
});
test("PDF extraction fails closed without configured approved providers", async () => {
  await assert.rejects(
    extractDocument({ bytes: Buffer.from("pdf"), mime: "application/pdf" }),
    /not configured/,
  );
});
