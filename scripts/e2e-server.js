"use strict";
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const directory = mkdtempSync(join(tmpdir(), "brwa-browser-"));
process.env.DATABASE_PATH = join(directory, "test.sqlite");
const { createApp } = require("../src/server");
const app = createApp({
  mode: "demo",
  origin: "http://127.0.0.1:4174",
  demoCode: "synthetic-browser-fixture",
});
app.server.listen(4174, "127.0.0.1", () =>
  console.log("Disposable synthetic browser-test server ready"),
);
const close = () =>
  app.server.close(() => {
    app.store.close();
    rmSync(directory, { recursive: true, force: true });
    process.exit(0);
  });
process.on("SIGTERM", close);
process.on("SIGINT", close);
