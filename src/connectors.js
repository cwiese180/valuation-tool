"use strict";
const { now } = require("./store");
const SYSTEMS = ["sharepoint", "cirrus8", "salesforce"];
// All network transports must be injected explicitly. Default operation never contacts a source.
class MockConnector {
  constructor(system, records) {
    if (!SYSTEMS.includes(system)) throw Error("Unknown connector");
    this.system = system;
    this.mode = "synthetic";
    this.records = records;
    this.paused = false;
  }
  async testConnection() {
    return {
      ok: true,
      mode: "synthetic",
      scope: "BRWA synthetic fixtures only",
    };
  }
  async discoverSchema() {
    return {
      system: this.system,
      fields: [...new Set(this.records.flatMap(Object.keys))],
      count: this.records.length,
    };
  }
  async preview(limit = 5) {
    return this.records.slice(0, Math.min(limit, 20)).map((r) => ({
      id: r.id,
      type: r.type,
      fields: Object.keys(r),
      redacted: true,
    }));
  }
  async sync(cursor) {
    if (this.paused) throw Error("Connector paused");
    return {
      records: cursor === "fixture-v1" ? [] : this.records,
      cursor: "fixture-v1",
    };
  }
  getStatus() {
    return { mode: "synthetic", paused: this.paused };
  }
  pause() {
    this.paused = true;
  }
  resume() {
    this.paused = false;
  }
}
function safeUrl(value, origin, prefix = "/") {
  const u = new URL(value, origin);
  if (
    u.origin !== origin ||
    !u.pathname.startsWith(prefix) ||
    u.username ||
    u.password ||
    u.protocol !== "https:"
  )
    throw Error("Source URL outside approved scope");
  return u.href;
}
function makeTransport({
  origin,
  token,
  fetcher = fetch,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  prefix = "/",
}) {
  return async function request(path) {
    const url = safeUrl(path, origin, prefix);
    for (let attempt = 0; attempt < 4; attempt++) {
      const r = await fetcher(url, {
        headers: {
          Authorization: "Bearer " + (await token()),
          Accept: "application/json",
        },
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      });
      if (r.ok) return r.json();
      if (![429, 502, 503, 504].includes(r.status) || attempt === 3)
        throw Error("Source request failed HTTP " + r.status);
      const seconds = Number(r.headers.get("retry-after"));
      await sleep(
        Math.min(
          Number.isFinite(seconds) && seconds > 0
            ? seconds * 1000
            : 500 * 2 ** attempt,
          10000,
        ),
      );
    }
  };
}
class SharePointAdapter {
  constructor({ driveId, request, mapItem }) {
    if (!driveId || !request || !mapItem)
      throw Error(
        "SharePoint requires scope, transport and reviewed item mapping",
      );
    this.driveId = driveId;
    this.request = request;
    this.mapItem = mapItem;
  }
  async testConnection() {
    const r = await this.request(
      "/v1.0/drives/" + encodeURIComponent(this.driveId),
    );
    return { ok: !!r.id, scope: r.id };
  }
  async discoverSchema() {
    return {
      system: "sharepoint",
      fields: [
        "id",
        "name",
        "eTag",
        "lastModifiedDateTime",
        "file",
        "deleted",
        "webUrl",
      ],
    };
  }
  async preview(limit = 5) {
    const r = await this.request(this.initial());
    return r.value
      .slice(0, Math.min(limit, 20))
      .map((v) => ({ id: v.id, deleted: !!v.deleted, redacted: true }));
  }
  initial() {
    return "/v1.0/drives/" + encodeURIComponent(this.driveId) + "/root/delta";
  }
  async sync(cursor) {
    let path = cursor || this.initial(),
      records = [],
      delta = null;
    const seen = new Set();
    while (path) {
      const checked = safeUrl(
        path,
        "https://graph.microsoft.com",
        "/v1.0/drives/" + encodeURIComponent(this.driveId) + "/",
      );
      if (seen.has(checked) || seen.size >= 10000)
        throw Error("Invalid Graph pagination");
      seen.add(checked);
      const page = await this.request(checked);
      if (!Array.isArray(page.value)) throw Error("Invalid Graph response");
      for (const item of page.value) {
        if (item.deleted)
          records.push({
            id: item.id,
            type: "deletion",
            deleted: true,
            version: item.eTag || "deleted",
          });
        else if (item.file) records.push(await this.mapItem(item));
      }
      path = page["@odata.nextLink"] || null;
      delta = page["@odata.deltaLink"] || delta;
    }
    if (!delta) throw Error("Missing Graph delta cursor");
    safeUrl(
      delta,
      "https://graph.microsoft.com",
      "/v1.0/drives/" + encodeURIComponent(this.driveId) + "/",
    );
    return { records, cursor: delta };
  }
}
class SalesforceAdapter {
  constructor({
    origin,
    object,
    fields,
    request,
    mapRecord,
    overlapMs = 86400000,
  }) {
    if (
      !/^https:\/\/[a-z0-9.-]+\.(salesforce|force)\.com$/.test(origin) ||
      ![object, ...fields].every((f) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(f))
    )
      throw Error("Invalid Salesforce mapping");
    Object.assign(this, {
      origin,
      object,
      fields,
      request,
      mapRecord,
      overlapMs,
    });
  }
  async testConnection() {
    const r = await this.request(
      "/services/data/v62.0/sobjects/" + this.object + "/describe",
    );
    return { ok: r.queryable === true, scope: this.object };
  }
  async discoverSchema() {
    return this.request(
      "/services/data/v62.0/sobjects/" + this.object + "/describe",
    );
  }
  async preview(limit = 5) {
    const q =
      "SELECT " +
      this.fields.join(",") +
      " FROM " +
      this.object +
      " LIMIT " +
      Math.min(Math.max(Number(limit) || 5, 1), 20);
    const r = await this.request(
      "/services/data/v62.0/queryAll?q=" + encodeURIComponent(q),
    );
    return r.records.map((r) => ({
      id: r.Id,
      fields: Object.keys(r),
      redacted: true,
    }));
  }
  async sync(cursor) {
    const started = now();
    let where = "";
    if (cursor) {
      if (!Number.isFinite(Date.parse(cursor)))
        throw Error("Invalid watermark");
      where =
        " WHERE SystemModstamp >= " +
        new Date(Date.parse(cursor) - this.overlapMs).toISOString();
    }
    const fields = [
      ...new Set(["Id", "SystemModstamp", "IsDeleted", ...this.fields]),
    ];
    let path =
        "/services/data/v62.0/queryAll?q=" +
        encodeURIComponent(
          "SELECT " +
            fields.join(",") +
            " FROM " +
            this.object +
            where +
            " ORDER BY SystemModstamp, Id",
        ),
      records = [];
    const seen = new Set();
    while (path) {
      const checked = safeUrl(path, this.origin, "/services/data/");
      if (seen.has(checked) || seen.size >= 10000)
        throw Error("Invalid Salesforce pagination");
      seen.add(checked);
      const page = await this.request(checked);
      if (!Array.isArray(page.records))
        throw Error("Invalid Salesforce response");
      for (const r of page.records)
        records.push(
          r.IsDeleted
            ? {
                id: r.Id,
                type: "deletion",
                deleted: true,
                version: r.SystemModstamp,
              }
            : await this.mapRecord(r),
        );
      if (!page.done && !page.nextRecordsUrl)
        throw Error("Missing Salesforce continuation");
      path = page.done ? null : page.nextRecordsUrl;
    }
    return { records, cursor: started };
  }
}
class Cirrus8Adapter {
  constructor({ readFeed, mapRecord }) {
    this.readFeed = readFeed;
    this.mapRecord = mapRecord;
  }
  async testConnection() {
    const r = await this.readFeed({ limit: 1 });
    return { ok: Array.isArray(r.records), scope: "approved existing feed" };
  }
  async discoverSchema() {
    const r = await this.readFeed({ limit: 1 });
    return { fields: Object.keys(r.records[0] || {}) };
  }
  async preview(limit = 5) {
    const r = await this.readFeed({ limit: Math.min(limit, 20) });
    return r.records.map((r) => ({ fields: Object.keys(r), redacted: true }));
  }
  async sync(cursor) {
    const r = await this.readFeed({ cursor });
    if (!Array.isArray(r.records) || typeof r.cursor !== "string")
      throw Error("Invalid Cirrus8 feed");
    return {
      records: await Promise.all(r.records.map(this.mapRecord)),
      cursor: r.cursor,
    };
  }
}
module.exports = {
  SYSTEMS,
  MockConnector,
  SharePointAdapter,
  SalesforceAdapter,
  Cirrus8Adapter,
  makeTransport,
  safeUrl,
};
