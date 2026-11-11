"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { FileVault } = require("../src/vault");
const {
  mapSalesforce,
  loadConnectors,
  clientCredentials,
  boundedBytes,
} = require("../src/runtime-connectors");
const mapping = {
  kind: "sale",
  fields: {
    value: "Price__c",
    client: "Client__c",
    status: "StageName",
    settlementDate: "SettledAt__c",
  },
  statusMap: { "Closed Won": "settled" },
  basis: "GST exclusive",
};
test("Salesforce reviewed status mappings require explicit settlement evidence", () => {
  let r = mapSalesforce(
    { Id: "1", Client__c: "c1", Price__c: 100, StageName: "Closed Won" },
    mapping,
  );
  assert.equal(r.transactionStatus, "indicative");
  r = mapSalesforce(
    {
      Id: "1",
      Client__c: "c1",
      Price__c: 100,
      StageName: "Closed Won",
      SettledAt__c: "2025-01-01",
    },
    mapping,
  );
  assert.equal(r.transactionStatus, "settled");
  assert.equal(
    mapSalesforce({ Id: "1", Client__c: "c1", Price__c: null }, mapping)
      .observations[0].value,
    null,
  );
});
test("source network configuration defaults to disabled without touching config or credentials", () => {
  assert.deepEqual(loadConnectors({ enabled: false }), {
    adapters: {},
    vault: null,
  });
});
test("OAuth client credentials cache tokens and do not expose credential in URL", async () => {
  let calls = 0;
  const token = clientCredentials({
    tenantId: "synthetic",
    clientId: "client",
    scope: "scope",
    secret: async () => "fixture-secret",
    fetcher: async (url, request) => {
      calls++;
      assert.ok(!url.includes("fixture-secret"));
      assert.equal(request.body.get("client_secret"), "fixture-secret");
      return {
        ok: true,
        json: async () => ({
          access_token: "synthetic-token",
          expires_in: 3600,
        }),
      };
    },
  });
  assert.equal(await token(), "synthetic-token");
  assert.equal(await token(), "synthetic-token");
  assert.equal(calls, 1);
});
test("original document vault is encrypted, replay-safe and tenant-bound", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "brwa-vault-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const v = new FileVault(dir, Buffer.alloc(32, 2)),
    bytes = Buffer.from("%PDF original synthetic");
  const ref = v.put("tenant-1", bytes);
  assert.equal(v.put("tenant-1", bytes), ref);
  assert.deepEqual(v.read("tenant-1", ref), bytes);
  assert.throws(() => v.read("tenant-2", ref));
  assert.throws(() => v.read("tenant-1", "../../etc/passwd"));
});
test("document download size cap applies to streaming content", async () => {
  await assert.rejects(
    boundedBytes(
      {
        body: (async function* () {
          yield Buffer.alloc(5);
          yield Buffer.alloc(5);
        })(),
      },
      8,
    ),
    /size limit/,
  );
});
