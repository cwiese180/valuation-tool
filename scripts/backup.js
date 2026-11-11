"use strict";
process.umask(0o077);
const { DatabaseSync, backup } = require("node:sqlite");
const { resolve } = require("node:path");
const { existsSync } = require("node:fs");
async function main() {
  const source = resolve(process.env.DATABASE_PATH || "data/brwa.sqlite"),
    destination = resolve(
      process.argv[2] ||
        "data/backup-" +
          new Date().toISOString().replaceAll(":", "-") +
          ".sqlite",
    );
  if (source === destination || existsSync(destination))
    throw Error("Choose a new backup destination");
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    await backup(db, destination);
    const check = new DatabaseSync(destination, { readOnly: true });
    try {
      if (
        check.prepare("PRAGMA integrity_check").get().integrity_check !== "ok"
      )
        throw Error("Backup integrity failed");
    } finally {
      check.close();
    }
    console.log("Verified SQLite backup: " + destination);
  } finally {
    db.close();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
