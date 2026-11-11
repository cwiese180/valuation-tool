"use strict";
const http = require("node:http");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { randomUUID } = require("node:crypto");
const { Store } = require("./store");
const {
  Platform,
  HttpError,
  access,
  parse,
  requireText,
  tenantAdmin,
} = require("./service");
const { Auth } = require("./auth");
const { loadConnectors } = require("./runtime-connectors");
const { adapters, seed } = require("./fixtures");
const staticFiles = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/style.css": ["style.css", "text/css; charset=utf-8"],
};
async function body(req) {
  let size = 0,
    chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2 * 1024 * 1024)
      throw new HttpError(413, "Request exceeds 2 MB");
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString() || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw Error();
    return value;
  } catch {
    throw new HttpError(400, "JSON object required");
  }
}
function createApp(options = {}) {
  const mode = options.mode || process.env.AUTH_MODE || "entra",
    origin =
      options.origin || process.env.APP_ORIGIN || "http://127.0.0.1:3000";
  const store =
    options.store ||
    new Store(
      process.env.DATABASE_PATH || join(__dirname, "../data/brwa.sqlite"),
    );
  const runtime =
    mode === "entra"
      ? loadConnectors({
          store,
          tenant: process.env.ENTRA_TENANT_ID,
          key: Buffer.from(process.env.SECRET_ENCRYPTION_KEY || "", "base64"),
          configPath: process.env.CONNECTORS_CONFIG_PATH,
          enabled: process.env.ENABLE_SOURCE_NETWORK === "true",
          paidAI: process.env.ENABLE_PAID_AI === "true",
        })
      : { adapters: adapters(), vault: null };
  const platform = options.platform || new Platform(store, runtime.adapters);
  const auth =
    options.auth ||
    new Auth({
      mode,
      origin,
      demoCode: options.demoCode || process.env.DEMO_ACCESS_CODE,
      tenantId: process.env.ENTRA_TENANT_ID,
      clientId: process.env.ENTRA_CLIENT_ID,
      clientSecret: process.env.ENTRA_CLIENT_SECRET,
      access: process.env.USER_ACCESS_JSON
        ? JSON.parse(process.env.USER_ACCESS_JSON)
        : null,
    });
  platform.recoverInterruptedJobs();
  if (mode === "demo" && options.seed !== false) seed(platform);
  const limits = new Map();
  const respond = (res, status, data) => {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
    });
    res.end(JSON.stringify(data));
  };
  const server = http.createServer(async (req, res) => {
    const requestId = randomUUID();
    res.setHeader("X-Request-Id", requestId);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    if (mode === "entra")
      res.setHeader("Strict-Transport-Security", "max-age=31536000");
    try {
      const url = new URL(req.url, origin),
        path = url.pathname,
        method = req.method;
      if (req.headers.host !== new URL(origin).host)
        throw new HttpError(400, "Invalid host");
      const remote = req.socket.remoteAddress,
        minute = Math.floor(Date.now() / 60000),
        limitKey = remote + ":" + (path.startsWith("/auth") ? "auth" : "api");
      if (limits.size > 10000)
        for (const [k, v] of limits) if (v.minute !== minute) limits.delete(k);
      const quota = limits.get(limitKey) || { minute, count: 0 };
      if (quota.minute !== minute) {
        quota.minute = minute;
        quota.count = 0;
      }
      quota.count++;
      limits.set(limitKey, quota);
      if (quota.count > (path.startsWith("/auth") ? 30 : 600))
        throw new HttpError(429, "Too many requests");
      if (!["GET", "HEAD", "POST", "PATCH"].includes(method))
        throw new HttpError(405, "Method not allowed");
      if (["POST", "PATCH"].includes(method)) {
        if (req.headers.origin !== origin)
          throw new HttpError(403, "Origin not allowed");
        if (!req.headers["content-type"]?.startsWith("application/json"))
          throw new HttpError(415, "JSON required");
      }
      if (path === "/health" && method === "GET") {
        store.get("SELECT 1");
        return respond(res, 200, { ok: true });
      }
      if (path === "/auth/config" && method === "GET")
        return respond(res, 200, { mode });
      if (path === "/auth/demo" && method === "POST")
        return respond(res, 200, auth.loginDemo(res, (await body(req)).code));
      if (path === "/auth/login" && method === "GET") {
        res.writeHead(302, { Location: auth.authorize(res) });
        return res.end();
      }
      if (path === "/auth/callback" && method === "GET") {
        await auth.callback(req, res, url);
        res.writeHead(302, { Location: "/" });
        return res.end();
      }
      if (path === "/auth/session" && method === "GET")
        return respond(res, 200, auth.user(req));
      if (path === "/auth/logout" && method === "POST") {
        auth.csrf(req);
        auth.logout(req, res);
        return respond(res, 200, { ok: true });
      }
      if (path.startsWith("/api/")) {
        const user = auth.user(req).user;
        if (method !== "GET") auth.csrf(req);
        let result;
        if (path === "/api/properties" && method === "GET")
          result = platform.list(user, "properties");
        else if (path === "/api/properties" && method === "POST")
          result = platform.createProperty(user, await body(req));
        else if (/^\/api\/properties\/[^/]+$/.test(path) && method === "GET")
          result = platform.property(user, path.split("/")[3]);
        else if (path === "/api/evidence" && method === "GET") {
          let rows = platform.list(user, "evidence");
          const q = (url.searchParams.get("q") || "").toLowerCase();
          for (const field of [
            "status",
            "kind",
            "transaction_status",
            "property_id",
          ])
            if (url.searchParams.has(field))
              rows = rows.filter(
                (r) => r[field] === url.searchParams.get(field),
              );
          result = rows.filter((r) =>
            JSON.stringify(r).toLowerCase().includes(q),
          );
        } else if (/^\/api\/evidence\/[^/]+$/.test(path) && method === "PATCH")
          result = platform.correctEvidence(
            user,
            path.split("/")[3],
            await body(req),
          );
        else if (path === "/api/reviews" && method === "GET")
          result = platform.list(user, "reviews");
        else if (/^\/api\/reviews\/[^/]+$/.test(path) && method === "POST")
          result = platform.review(user, path.split("/")[3], await body(req));
        else if (/^\/api\/documents\/[^/]+$/.test(path) && method === "GET")
          result = platform.document(user, path.split("/")[3]);
        else if (
          /^\/api\/documents\/[^/]+\/file$/.test(path) &&
          method === "GET"
        ) {
          const doc = platform.document(user, path.split("/")[3]);
          const raw = JSON.parse(
            store.get("SELECT payload FROM raw_records WHERE id=?", doc.raw_id)
              .payload,
          );
          if (!runtime.vault || !raw.originalRef)
            throw new HttpError(
              404,
              "Original file unavailable for this synthetic document",
            );
          const bytes = runtime.vault.read(user.tenant, raw.originalRef);
          res.writeHead(200, {
            "Content-Type": raw.mime || "application/octet-stream",
            "Content-Disposition":
              'attachment; filename="valuation-source.' +
              (raw.mime === "application/pdf" ? "pdf" : "docx") +
              '"',
          });
          return res.end(bytes);
        } else if (path === "/api/quotes" && method === "GET")
          result = platform.list(user, "quotes");
        else if (path === "/api/quotes" && method === "POST")
          result = platform.quote(user, await body(req));
        else if (/^\/api\/quotes\/[^/]+$/.test(path) && method === "POST")
          result = platform.quoteTransition(
            user,
            path.split("/")[3],
            await body(req),
          );
        else if (path === "/api/admin/connectors" && method === "GET")
          result = platform.connectorStatus(user);
        else if (
          /^\/api\/admin\/connectors\/[^/]+\/sync$/.test(path) &&
          method === "POST"
        )
          result = await platform.sync(user, path.split("/")[4]);
        else if (
          /^\/api\/admin\/connectors\/[^/]+\/pause$/.test(path) &&
          method === "POST"
        )
          result = platform.pause(
            user,
            path.split("/")[4],
            (await body(req)).paused,
          );
        else if (
          /^\/api\/admin\/connectors\/[^/]+\/(test|schema|preview)$/.test(
            path,
          ) &&
          method === "GET"
        ) {
          tenantAdmin(user);
          const a = platform.adapters[path.split("/")[4]];
          if (!a) throw new HttpError(422, "Connector not configured");
          const action = path.split("/")[5];
          result =
            await a[
              action === "test"
                ? "testConnection"
                : action === "schema"
                  ? "discoverSchema"
                  : "preview"
            ]();
        } else if (path === "/api/admin/import" && method === "POST") {
          const input = await body(req);
          result = platform.ingest(user, input.system, input.records);
        } else if (path === "/api/admin/mappings" && method === "POST") {
          platform.mapSource(user, await body(req));
          result = { ok: true };
        } else if (path === "/api/admin/merges" && method === "POST")
          result = platform.merge(user, await body(req));
        else if (path === "/api/admin/merges" && method === "GET") {
          tenantAdmin(user);
          result = store
            .all("SELECT * FROM merges WHERE tenant=?", user.tenant)
            .filter((r) => {
              try {
                platform.property(user, r.source_id);
                platform.property(user, r.target_id);
                return true;
              } catch {
                return false;
              }
            })
            .map(parse);
        } else if (
          /^\/api\/admin\/merges\/[^/]+\/reverse$/.test(path) &&
          method === "POST"
        )
          result = platform.reverseMerge(
            user,
            path.split("/")[4],
            (await body(req)).reason,
          );
        else if (path === "/api/admin/jobs" && method === "GET") {
          tenantAdmin(user);
          result = store.all(
            "SELECT * FROM jobs WHERE tenant=? ORDER BY created_at DESC",
            user.tenant,
          );
        } else if (path === "/api/admin/audit" && method === "GET") {
          tenantAdmin(user);
          if (!user.clients.includes("*"))
            throw new HttpError(
              403,
              "Tenant-wide audit requires full client scope",
            );
          result = {
            integrity: store.checkAudit(user.tenant),
            events: store.all(
              "SELECT * FROM audit WHERE tenant=? ORDER BY rowid DESC LIMIT 200",
              user.tenant,
            ),
          };
        } else if (path === "/api/admin/secrets" && method === "POST") {
          tenantAdmin(user);
          const input = await body(req),
            key = Buffer.from(
              process.env.SECRET_ENCRYPTION_KEY || "",
              "base64",
            );
          if (key.length !== 32)
            throw new HttpError(
              422,
              "Configure the external 32-byte encryption key before adding credentials",
            );
          store.setSecret(
            user,
            requireText(input.name, "secret name", 100),
            requireText(input.value, "secret value", 10000),
            key,
          );
          result = { ok: true };
        } else throw new HttpError(404, "Route not found");
        return respond(res, 200, result);
      }
      if (staticFiles[path] && (method === "GET" || method === "HEAD")) {
        const [file, type] = staticFiles[path];
        res.writeHead(200, { "Content-Type": type });
        return res.end(
          method === "HEAD"
            ? undefined
            : readFileSync(join(__dirname, "../public", file)),
        );
      }
      throw new HttpError(404, "Route not found");
    } catch (error) {
      const status = error.status || 500;
      if (status >= 500)
        console.error(
          JSON.stringify({
            requestId,
            error: "Internal request failure",
            type: error.name,
          }),
        );
      respond(res, status, {
        error: status >= 500 ? "Internal request failure" : error.message,
        requestId,
      });
    }
  });
  server.requestTimeout = 35000;
  server.headersTimeout = 10000;
  return { server, store, platform, auth };
}
if (require.main === module) {
  process.umask(0o077);
  const app = createApp();
  app.server.listen(
    Number(process.env.PORT || 3000),
    process.env.HOST || "127.0.0.1",
    () =>
      console.log(
        "BRWA listening at " +
          (process.env.APP_ORIGIN || "http://127.0.0.1:3000"),
      ),
  );
  const shutdown = () =>
    app.server.close(() => {
      app.store.close();
      process.exit(0);
    });
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
module.exports = { createApp };
