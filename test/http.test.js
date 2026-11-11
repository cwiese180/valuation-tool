"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { createApp } = require("../src/server");
const { Store } = require("../src/store");
async function setup(t) {
  const app = createApp({
    mode: "demo",
    origin: "http://127.0.0.1:3000",
    store: new Store(),
    demoCode: "test-only-code",
  });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const origin = "http://127.0.0.1:" + app.server.address().port; // The transport uses an ephemeral port and an explicitly configured Host header.
  t.after(async () => {
    await new Promise((r) => app.server.close(r));
    app.store.close();
  });
  const call = (path, { method = "GET", data, headers = {} } = {}) =>
    new Promise((resolve, reject) => {
      const req = require("node:http").request(
        origin + path,
        {
          method,
          headers: {
            Host: "127.0.0.1:3000",
            ...(method !== "GET"
              ? {
                  Origin: "http://127.0.0.1:3000",
                  "Content-Type": "application/json",
                }
              : {}),
            ...headers,
          },
        },
        (res) => {
          let text = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => (text += chunk));
          res.on("end", () => {
            const responseHeaders = new Headers();
            for (const [key, value] of Object.entries(res.headers))
              responseHeaders.set(
                key,
                Array.isArray(value) ? value.join(",") : value,
              );
            resolve({
              status: res.statusCode,
              headers: responseHeaders,
              data: res.headers["content-type"]?.includes("application/json")
                ? JSON.parse(text)
                : text,
            });
          });
        },
      );
      req.on("error", reject);
      if (data) req.write(JSON.stringify(data));
      req.end();
    });
  const login = await call("/auth/demo", {
      method: "POST",
      data: { code: "test-only-code" },
    }),
    cookie = login.headers.get("set-cookie").split(";")[0],
    csrf = login.data.csrf;
  return {
    ...app,
    call,
    cookie,
    csrf,
    headers: { Cookie: cookie, "X-CSRF-Token": csrf },
  };
}
test("HTTP API rejects anonymous reads and serves a real login screen", async (t) => {
  const { call } = await setup(t);
  assert.equal((await call("/api/properties")).status, 401);
  const page = await call("/");
  assert.equal(page.status, 200);
  assert.match(page.data, /Property Intelligence/);
  assert.match(
    page.headers.get("content-security-policy"),
    /frame-ancestors 'none'/,
  );
});
test("session cookies are HTTP-only; logout invalidates authenticated access", async (t) => {
  const { call, cookie, headers } = await setup(t);
  const session = await call("/auth/session", { headers: { Cookie: cookie } });
  assert.equal(session.status, 200);
  assert.equal(session.data.user.tenant, "brwa-demo");
  assert.equal(
    (await call("/auth/logout", { method: "POST", headers, data: {} })).status,
    200,
  );
  assert.equal((await call("/api/properties", { headers })).status, 401);
});
test("CSRF token and exact origin required for writes", async (t) => {
  const { call, cookie, headers } = await setup(t);
  assert.equal(
    (
      await call("/api/admin/connectors/cirrus8/sync", {
        method: "POST",
        headers: { Cookie: cookie },
        data: {},
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call("/api/admin/connectors/cirrus8/sync", {
        method: "POST",
        headers: { ...headers, Origin: "https://hostile.example" },
        data: {},
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call("/api/admin/connectors/cirrus8/sync", {
        method: "POST",
        headers,
        data: {},
      })
    ).status,
    200,
  );
});
test("authenticated property, evidence search and source-page routes work end to end", async (t) => {
  const { call, headers } = await setup(t);
  const properties = await call("/api/properties", { headers });
  assert.equal(properties.data.length, 2);
  const property = await call("/api/properties/" + properties.data[0].id, {
    headers,
  });
  assert.ok(property.data.entities.length);
  const evidence = await call("/api/evidence?status=verified", { headers });
  assert.ok(evidence.data.every((e) => e.status === "verified"));
  const all = await call("/api/evidence", { headers }),
    doc = all.data.find((e) => e.document_id);
  const source = await call("/api/documents/" + doc.document_id, { headers });
  assert.equal(source.status, 200);
  assert.ok(source.data.pages[doc.page - 1]);
});
test("malformed JSON and unknown routes produce controlled errors", async (t) => {
  const { call, headers } = await setup(t);
  assert.equal((await call("/api/missing", { headers })).status, 404);
  assert.equal(
    (
      await call("/api/admin/connectors/unknown/sync", {
        method: "POST",
        headers,
        data: {},
      })
    ).status,
    422,
  );
});
test("server rejects spoofed host and unsafe methods", async (t) => {
  const { call } = await setup(t);
  assert.equal(
    (await call("/health", { headers: { Host: "evil.example" } })).status,
    400,
  );
  assert.equal((await call("/health", { method: "DELETE" })).status, 405);
});
test("role and client restrictions are enforced through actual HTTP requests", async (t) => {
  const { call, auth, headers, cookie } = await setup(t);
  const token = cookie.split("=")[1];
  auth.sessions.get(token).user = {
    id: "limited-reader",
    tenant: "brwa-demo",
    role: "reader",
    clients: ["other-client"],
  };
  assert.deepEqual((await call("/api/evidence", { headers })).data, []);
  assert.equal((await call("/api/admin/connectors", { headers })).status, 403);
  assert.equal(
    (await call("/api/quotes", { method: "POST", headers, data: {} })).status,
    403,
  );
});
