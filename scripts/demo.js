"use strict";
process.umask(0o077);
const { createApp } = require("../src/server");
const portIndex = process.argv.indexOf("--port");
const port =
  portIndex >= 0
    ? Number(process.argv[portIndex + 1])
    : Number(process.env.PORT || 3000);
const origin = process.env.APP_ORIGIN || "http://127.0.0.1:" + port;
const app = createApp({ mode: "demo", origin });
app.server.listen(Number(new URL(origin).port || 3000), "127.0.0.1", () => {
  console.log(
    "Synthetic BRWA application: " +
      origin +
      "\nLocal access code: " +
      app.auth.demoCode +
      "\nNo source systems are contacted.",
  );
});
const shutdown = () =>
  app.server.close(() => {
    app.store.close();
    process.exit(0);
  });
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
