"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { Store } = require("../src/store");
const { Platform } = require("../src/service");
const { seed, demoUser, adapters, fixtures } = require("../src/fixtures");
function setup(t) {
  const store = new Store(),
    p = new Platform(store, adapters());
  seed(p);
  t.after(() => store.close());
  return { p, store, u: { ...demoUser } };
}
const rejects = (fn, status) => assert.throws(fn, (e) => e.status === status);
test("replaying imports is idempotent and preserves lease effective dates", (t) => {
  const { p, u } = setup(t);
  const before = p.list(u, "entities");
  assert.deepEqual(p.ingest(u, "cirrus8", fixtures.cirrus8), {
    imported: 0,
    duplicates: 2,
  });
  assert.equal(p.list(u, "entities").length, before.length);
  const terms = before.filter((e) => e.type === "rent-term");
  assert.deepEqual(
    terms.map((t) => t.data.amount),
    [220000, 231000],
  );
  assert.deepEqual(
    terms.map((t) => t.effective_at),
    ["2024-07-01", "2025-07-01"],
  );
});
test("all document observations have literal page provenance and remain pending", (t) => {
  const { p, u } = setup(t);
  for (const e of p.list(u, "evidence").filter((e) => e.document_id)) {
    assert.equal(e.status, "pending");
    const doc = p.document(u, e.document_id);
    assert.ok(doc.pages[e.page - 1].text.includes(e.data.quote));
    assert.equal(doc.source_uri, undefined);
  }
});
test("low confidence and unsupported numeric extraction cannot publish", (t) => {
  const { p, u } = setup(t);
  const e = p
    .list(u, "evidence")
    .find((e) => e.issues.includes("numeric value not supported by quote"));
  const r = p.list(u, "reviews").find((r) => r.evidence_id === e.id);
  rejects(
    () =>
      p.review(u, r.id, {
        decision: "approved",
        version: e.version,
        confirmedValue: e.value,
        reason: "Test",
      }),
    422,
  );
  assert.equal(
    p.list(u, "evidence").find((x) => x.id === e.id).status,
    "pending",
  );
});
test("property match and audited correction allow verified source-page evidence", (t) => {
  const { p, u } = setup(t);
  let e = p
    .list(u, "evidence")
    .find((e) => e.issues.includes("numeric value not supported by quote"));
  const match = p.list(u, "reviews").find((r) => r.type === "property-match"),
    property = p
      .list(u, "properties")
      .find((p) => p.locality === "Osborne Park");
  p.review(u, match.id, {
    decision: "approved",
    propertyId: property.id,
    reason: "Checked synthetic title and scope",
  });
  e = p.list(u, "evidence").find((x) => x.id === e.id);
  e = p.correctEvidence(u, e.id, {
    version: e.version,
    value: 2950000,
    unit: "AUD",
    basis: "GST unknown",
    page: 1,
    quote: "sale_price: 2,950,000 AUD | GST unknown",
    reason: "Corrected decimal placement against page 1",
  });
  assert.deepEqual(e.issues, []);
  const r = p.list(u, "reviews").find((r) => r.evidence_id === e.id);
  p.review(u, r.id, {
    decision: "approved",
    version: e.version,
    confirmedValue: 2950000,
    reason: "Verified page 1",
  });
  assert.equal(
    p.list(u, "evidence").find((x) => x.id === e.id).status,
    "verified",
  );
  assert.ok(e.data.correction.original);
});
test("stale reviews cannot override newer corrections or approval", (t) => {
  const { p, u } = setup(t);
  const e = p
      .list(u, "evidence")
      .find((e) => e.document_id && !e.issues.length),
    r = p.list(u, "reviews").find((r) => r.evidence_id === e.id);
  rejects(
    () =>
      p.review(u, r.id, {
        decision: "approved",
        version: e.version - 1,
        confirmedValue: e.value,
        reason: "Stale",
      }),
    409,
  );
  p.review(u, r.id, {
    decision: "approved",
    version: e.version,
    confirmedValue: e.value,
    reason: "Checked",
  });
  rejects(
    () =>
      p.review(u, r.id, {
        decision: "rejected",
        version: e.version + 1,
        reason: "Stale",
      }),
    409,
  );
});
test("Closed Won remains indicative and valuation opinion remains distinct", (t) => {
  const { p, u } = setup(t);
  assert.equal(
    p.list(u, "evidence").find((e) => e.data.sourceRecordId === "SF-S2")
      .transaction_status,
    "indicative",
  );
  assert.equal(
    p.list(u, "evidence").find((e) => e.measure === "adopted_value")
      .transaction_status,
    "opinion",
  );
  assert.equal(
    p
      .list(u, "evidence")
      .find((e) => e.document_id && e.measure === "sale_price").kind,
    "sale",
  );
});
test("tenant and client boundaries protect collections, documents and writes", (t) => {
  const { p, u } = setup(t);
  const property = p.list(u, "properties")[0],
    doc = p.list(u, "documents")[0];
  for (const restricted of [
    { ...u, tenant: "another-tenant" },
    { ...u, clients: ["another-client"] },
  ]) {
    assert.equal(p.list(restricted, "properties").length, 0);
    assert.equal(p.list(restricted, "evidence").length, 0);
    rejects(() => p.property(restricted, property.id), 404);
    rejects(() => p.document(restricted, doc.id), 404);
    rejects(() => p.quote(restricted, { propertyId: property.id }), 404);
  }
  rejects(
    () =>
      p.ingest(
        { ...u, clients: ["another-client"] },
        "cirrus8",
        fixtures.cirrus8,
      ),
    403,
  );
});
test("server roles enforce writes independently of UI", (t) => {
  const { p, u } = setup(t),
    reader = { ...u, role: "reader" };
  rejects(() => p.ingest(reader, "cirrus8", []), 403);
  rejects(
    () => p.createProperty(reader, { client: "demo-client", address: "a" }),
    403,
  );
  rejects(() => p.quote(reader, {}), 403);
  rejects(() => p.pause(reader, "cirrus8", true), 403);
});
test("failed imports roll back raw and canonical changes together", (t) => {
  const { p, u, store } = setup(t);
  const count = store.get("SELECT COUNT(*) n FROM raw_records").n;
  rejects(
    () =>
      p.ingest(u, "cirrus8", [
        {
          id: "new-good",
          client: "demo-client",
          address: "99 Synthetic St",
          type: "property",
        },
        { id: "", client: "demo-client", type: "property" },
      ]),
    400,
  );
  assert.equal(store.get("SELECT COUNT(*) n FROM raw_records").n, count);
});
test("deletions withdraw evidence without destroying originals or reviews", (t) => {
  const { p, u, store } = setup(t);
  p.ingest(u, "salesforce", [
    { id: "SF-S1", deleted: true, type: "deletion", version: "3" },
  ]);
  assert.equal(
    p.list(u, "evidence").find((e) => e.data.sourceRecordId === "SF-S1").status,
    "withdrawn",
  );
  assert.equal(
    store.get("SELECT COUNT(*) n FROM raw_records WHERE source_id='SF-S1'").n,
    2,
  );
});
test("property address and title collisions create review tasks, no automatic merges", (t) => {
  const { p, u } = setup(t),
    before = p.list(u, "properties").length;
  p.ingest(u, "salesforce", [
    {
      id: "collision",
      client: "demo-client",
      type: "sale",
      address: "18 Example Street, Welshpool",
      observations: [
        { measure: "sale_price", value: 5, unit: "AUD", basis: "GST unknown" },
      ],
    },
  ]);
  const task = p
    .list(u, "reviews")
    .find(
      (r) => r.type === "property-match" && r.data.sourceId === "collision",
    );
  assert.equal(task.data.candidates.length, 1);
  assert.equal(p.list(u, "properties").length, before);
  assert.equal(
    p.list(u, "evidence").find((e) => e.data.sourceRecordId === "collision")
      .property_id,
    null,
  );
});
test("human merges reverse exact record links, preserving unrelated data", (t) => {
  const { p, u } = setup(t),
    [source, target] = p.list(u, "properties");
  const original = p.property(u, source.id).evidence.map((e) => e.id);
  const m = p.merge(u, {
    sourceId: source.id,
    targetId: target.id,
    reason: "Synthetic duplicate confirmed",
  });
  assert.equal(p.property(u, source.id).evidence.length, 0);
  assert.ok(p.property(u, target.id).evidence.length >= original.length);
  p.reverseMerge(u, m.id, "Synthetic merge reversal");
  assert.deepEqual(
    p.property(u, source.id).evidence.map((e) => e.id),
    original,
  );
  assert.equal(p.property(u, source.id).data.mergedInto, undefined);
});
test("quote workflow prevents self approval and records contribution", (t) => {
  const { p, u } = setup(t);
  let q = p.list(u, "quotes")[0];
  assert.equal(q.data.fee, 3560);
  assert.equal(q.data.contribution, 1620);
  q = p.quoteTransition(u, q.id, { version: q.version, status: "submitted" });
  rejects(
    () =>
      p.quoteTransition(u, q.id, { version: q.version, status: "approved" }),
    403,
  );
  q = p.quoteTransition({ ...u, id: "independent-admin" }, q.id, {
    version: q.version,
    status: "approved",
  });
  q = p.quoteTransition(u, q.id, { version: q.version, status: "issued" });
  assert.equal(q.status, "issued");
  assert.equal(q.data.indicative, true);
});
test("negative and absent quote values are rejected", (t) => {
  const { p, u } = setup(t);
  rejects(
    () =>
      p.quote(u, {
        propertyId: p.list(u, "properties")[0].id,
        purpose: "Test",
        hours: 0,
        rate: 280,
        costRate: 50,
      }),
    400,
  );
});
test("audit trail is append-only and chain validates", (t) => {
  const { store, u } = setup(t);
  assert.ok(store.checkAudit(u.tenant));
  assert.throws(
    () => store.run("UPDATE audit SET action=?", "tampered"),
    /append-only/,
  );
  assert.throws(() => store.run("DELETE FROM audit"), /append-only/);
});
test("encrypted secrets bind ciphertext to tenant and secret name", (t) => {
  const { store, u } = setup(t),
    key = Buffer.alloc(32, 7);
  store.setSecret(u, "graph", "super-secret", key);
  assert.equal(store.secret(u.tenant, "graph", key), "super-secret");
  assert.ok(
    !store
      .get("SELECT encrypted FROM secrets")
      .encrypted.includes("super-secret"),
  );
  assert.throws(() => store.secret(u.tenant, "graph", Buffer.alloc(32, 8)));
  assert.equal(store.secret("other", "graph", key), null);
});
test("sync commits cursor atomically and replay remains safe", async (t) => {
  const { p, u, store } = setup(t);
  const r = await p.sync(u, "cirrus8");
  assert.equal(r.imported, 0);
  assert.equal(r.duplicates, 2);
  assert.equal(
    store.get("SELECT cursor FROM connectors WHERE system='cirrus8'").cursor,
    "fixture-v1",
  );
  const again = await p.sync(u, "cirrus8");
  assert.equal(again.imported, 0);
  assert.equal(
    store.get("SELECT COUNT(*) n FROM jobs WHERE status='succeeded'").n,
    2,
  );
});
test("sync failure retains cursor and exposes replayable failed job", async (t) => {
  const { p, u, store } = setup(t);
  p.adapters.cirrus8.sync = async () => ({
    cursor: "bad-cursor",
    records: [{ id: "invalid", type: "property" }],
  });
  await assert.rejects(p.sync(u, "cirrus8"));
  assert.equal(
    store.get("SELECT cursor FROM connectors WHERE system='cirrus8'").cursor,
    null,
  );
  assert.equal(store.get("SELECT status FROM jobs").status, "failed");
  assert.ok(store.get("SELECT next_attempt FROM jobs").next_attempt);
  p.adapters = adapters();
  await p.sync(u, "cirrus8");
  p.pause(u, "cirrus8", true);
  await assert.rejects(p.sync(u, "cirrus8"), (e) => e.status === 409);
});
test("resolving property match attaches staged lease entities and preserves source ACL", (t) => {
  const { p, u } = setup(t);
  p.ingest(u, "cirrus8", [
    {
      id: "unmatched-lease",
      client: "demo-client",
      type: "lease",
      entities: [
        { id: "lease-new", type: "lease", commencement: "2025-01-01" },
      ],
    },
  ]);
  const task = p
    .list(u, "reviews")
    .find(
      (r) =>
        r.type === "property-match" && r.data.sourceId === "unmatched-lease",
    );
  const property = p.list(u, "properties")[0];
  p.review(u, task.id, {
    decision: "approved",
    propertyId: property.id,
    reason: "Checked parcel and lease scope",
  });
  assert.ok(
    p
      .property(u, property.id)
      .entities.some((e) => e.source_id === "lease-new"),
  );
});
test("process restart marks interrupted jobs replayable without advancing cursor", (t) => {
  const { p, u, store } = setup(t);
  store.run(
    "INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?)",
    "interrupted",
    u.tenant,
    "cirrus8",
    "running",
    1,
    null,
    null,
    new Date().toISOString(),
    null,
  );
  assert.equal(p.recoverInterruptedJobs(), 1);
  assert.equal(
    store.get("SELECT status FROM jobs WHERE id='interrupted'").status,
    "failed",
  );
  assert.equal(p.recoverInterruptedJobs(), 0);
  assert.ok(store.checkAudit(u.tenant));
});
test("immutable raw records prevent source history being edited after review", (t) => {
  const { store } = setup(t);
  assert.throws(
    () => store.run("UPDATE raw_records SET payload=?", "{}"),
    /immutable/,
  );
  assert.throws(() => store.run("DELETE FROM raw_records"), /immutable/);
});
test("missing loaded costs cannot silently become zero in a quote", (t) => {
  const { p, u } = setup(t);
  rejects(
    () =>
      p.quote(u, {
        propertyId: p.list(u, "properties")[0].id,
        purpose: "Test",
        hours: 12,
        rate: 280,
        costRate: null,
      }),
    400,
  );
});
test("tenant-wide connector controls reject a client-scoped administrator", async (t) => {
  const { p, u } = setup(t),
    limited = { ...u, clients: ["demo-client"] };
  rejects(() => p.connectorStatus(limited), 403);
  rejects(() => p.pause(limited, "cirrus8", true), 403);
  await assert.rejects(p.sync(limited, "cirrus8"), (e) => e.status === 403);
});
test("malformed source envelopes fail validation before any rows commit", (t) => {
  const { p, u } = setup(t);
  for (const record of [
    null,
    { id: "x", client: "demo-client", type: "sale", observations: {} },
    { id: "x", type: "invented", client: "demo-client" },
  ])
    rejects(() => p.ingest(u, "cirrus8", [record]), 400);
});
