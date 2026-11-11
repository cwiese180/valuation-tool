"use strict";
const { DatabaseSync } = require("node:sqlite");
const { readFileSync, mkdirSync } = require("node:fs");
const { dirname, join } = require("node:path");
const {
  randomUUID,
  createHash,
  createCipheriv,
  createDecipheriv,
  randomBytes,
} = require("node:crypto");
const id = () => randomUUID();
const now = () => new Date().toISOString();
const hash = (value) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : stable(value))
    .digest("hex");
function stable(value) {
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + stable(value[k]))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
class Store {
  constructor(path = ":memory:") {
    if (path !== ":memory:")
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
    );
    this.db.exec(
      readFileSync(join(__dirname, "../migrations/001_initial.sql"), "utf8"),
    );
    if (!this.get("SELECT version FROM schema_version WHERE version=2"))
      this.transaction(() =>
        this.db.exec(
          readFileSync(
            join(__dirname, "../migrations/002_immutable_sources.sql"),
            "utf8",
          ),
        ),
      );
  }
  all(sql, ...args) {
    return this.db.prepare(sql).all(...args);
  }
  get(sql, ...args) {
    return this.db.prepare(sql).get(...args);
  }
  run(sql, ...args) {
    return this.db.prepare(sql).run(...args);
  }
  transaction(fn) {
    const nested = !!this.depth,
      savepoint = "sp_" + (this.depth || 0);
    this.db.exec(nested ? "SAVEPOINT " + savepoint : "BEGIN IMMEDIATE");
    this.depth = (this.depth || 0) + 1;
    try {
      const result = fn();
      this.db.exec(nested ? "RELEASE " + savepoint : "COMMIT");
      return result;
    } catch (e) {
      this.db.exec(nested ? "ROLLBACK TO " + savepoint : "ROLLBACK");
      if (nested) this.db.exec("RELEASE " + savepoint);
      throw e;
    } finally {
      this.depth--;
    }
  }
  audit(user, action, entity, detail = {}) {
    const previous =
      this.get(
        "SELECT hash FROM audit WHERE tenant=? ORDER BY rowid DESC LIMIT 1",
        user.tenant,
      )?.hash || "";
    const row = {
      id: id(),
      tenant: user.tenant,
      actor: user.id,
      action,
      entity,
      detail: stable(detail),
      at: now(),
      previous_hash: previous,
    };
    this.run(
      "INSERT INTO audit VALUES(?,?,?,?,?,?,?,?,?)",
      ...Object.values(row),
      hash(row),
    );
  }
  checkAudit(tenant) {
    let previous = "";
    for (const row of this.all(
      "SELECT * FROM audit WHERE tenant=? ORDER BY rowid",
      tenant,
    )) {
      const { hash: actual, ...rest } = row;
      if (row.previous_hash !== previous || hash(rest) !== actual) return false;
      previous = actual;
    }
    return true;
  }
  setSecret(user, name, value, key) {
    return this.transaction(() => {
      if (!Buffer.isBuffer(key) || key.length !== 32)
        throw Error("32-byte encryption key required");
      const iv = randomBytes(12),
        cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(Buffer.from(user.tenant + ":" + name));
      const encrypted = Buffer.concat([
        cipher.update(value, "utf8"),
        cipher.final(),
      ]);
      this.run(
        "INSERT OR REPLACE INTO secrets VALUES(?,?,?)",
        user.tenant,
        name,
        JSON.stringify({
          iv: iv.toString("base64"),
          tag: cipher.getAuthTag().toString("base64"),
          value: encrypted.toString("base64"),
        }),
      );
      this.audit(user, "secret.updated", name);
    });
  }
  secret(tenant, name, key) {
    const row = this.get(
      "SELECT encrypted FROM secrets WHERE tenant=? AND name=?",
      tenant,
      name,
    );
    if (!row) return null;
    const value = JSON.parse(row.encrypted),
      decipher = createDecipheriv(
        "aes-256-gcm",
        key,
        Buffer.from(value.iv, "base64"),
      );
    decipher.setAAD(Buffer.from(tenant + ":" + name));
    decipher.setAuthTag(Buffer.from(value.tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(value.value, "base64")),
      decipher.final(),
    ]).toString("utf8");
  }
  close() {
    this.db.close();
  }
}
module.exports = { Store, id, now, hash, stable };
