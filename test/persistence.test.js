"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { spawnSync } = require("node:child_process");
const { Store } = require("../src/store");
const { Platform } = require("../src/service");
const { seed, demoUser } = require("../src/fixtures");
test("migrations survive restart and verified online backup can restore records", (t) => {
  const folder = mkdtempSync(join(tmpdir(), "brwa-test-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const path = join(folder, "db.sqlite"),
    backup = join(folder, "backup.sqlite");
  let s = new Store(path);
  seed(new Platform(s));
  const count = s.get("SELECT COUNT(*) n FROM evidence").n;
  s.close();
  s = new Store(path);
  assert.equal(s.get("SELECT COUNT(*) n FROM evidence").n, count);
  s.close();
  const result = spawnSync(process.execPath, ["scripts/backup.js", backup], {
    cwd: join(__dirname, ".."),
    env: { ...process.env, DATABASE_PATH: path },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const restored = new Store(backup);
  assert.equal(restored.get("SELECT COUNT(*) n FROM evidence").n, count);
  assert.ok(restored.checkAudit(demoUser.tenant));
  restored.close();
});
