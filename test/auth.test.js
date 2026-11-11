"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { generateKeyPairSync, sign } = require("node:crypto");
const { Auth } = require("../src/auth");
const tenant = "11111111-1111-1111-1111-111111111111",
  client = "test-client";
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const jwk = {
  ...publicKey.export({ format: "jwk" }),
  kid: "test-key",
  use: "sig",
};
const encode = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
function token(changes = {}, header = { alg: "RS256", kid: "test-key" }) {
  const payload = {
    iss: `https://login.microsoftonline.com/${tenant}/v2.0`,
    tid: tenant,
    aud: client,
    exp: Math.floor(Date.now() / 1000) + 3600,
    nbf: Math.floor(Date.now() / 1000) - 60,
    oid: "user-oid",
    nonce: "expected",
    ...changes,
  };
  const unsigned = encode(header) + "." + encode(payload);
  return (
    unsigned +
    "." +
    sign("RSA-SHA256", Buffer.from(unsigned), privateKey).toString("base64url")
  );
}
function auth() {
  const a = new Auth({
    mode: "entra",
    origin: "https://brwa.example",
    tenantId: tenant,
    clientId: client,
    clientSecret: "synthetic",
    access: { "user-oid": { role: "reader", clients: ["synthetic"] } },
  });
  a.keys = [jwk];
  a.keysUntil = Date.now() + 3600000;
  return a;
}
test("Entra verifier accepts a signed token from the pinned issuer and audience", async () => {
  assert.equal((await auth().validate(token(), "expected")).oid, "user-oid");
});
for (const [name, changes] of Object.entries({
  tenant: { tid: "other" },
  issuer: { iss: "https://evil.example" },
  audience: { aud: "other" },
  expiry: { exp: 0 },
  future: { nbf: Math.floor(Date.now() / 1000) + 3600 },
  nonce: { nonce: "other" },
}))
  test("Entra rejects wrong " + name, async () => {
    await assert.rejects(
      auth().validate(token(changes), "expected"),
      (e) => e.status === 401,
    );
  });
test("Entra rejects tampered signatures and algorithm confusion", async () => {
  await assert.rejects(
    auth().validate(token().slice(0, -10) + "abcdefghij", "expected"),
    (e) => e.status === 401,
  );
  await assert.rejects(
    auth().validate(token({}, { alg: "none", kid: "test-key" }), "expected"),
    (e) => e.status === 401,
  );
});
test("authentication fails closed without explicit configuration", () => {
  assert.throws(
    () => new Auth({ mode: "entra", origin: "https://brwa.example" }),
  );
  assert.throws(
    () => new Auth({ mode: "demo", origin: "https://public.example" }),
    /loopback/,
  );
});
