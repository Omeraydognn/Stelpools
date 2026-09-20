import { app, cfg, log, store, worker } from "./app.js";

/**
 * The anchor process: the HTTP surface and the worker that delivers.
 *
 * Both, always. An anchor that serves requests without a working payout
 * loop is the worst version of itself — it keeps taking deposits it will
 * never honour — so the worker starting is a precondition for the server
 * listening, and `/health` answers 503 the moment the loop stops ticking.
 */
const server = app.listen(cfg.PORT, () => {
  log.info(
    { port: cfg.PORT, asset: cfg.ATRY_CODE, home_domain: cfg.HOME_DOMAIN },
    "anchor listening",
  );
});

await worker.start();

/** Finish what is in flight, then let go of the database cleanly. */
function shutdown(signal: string): void {
  log.info({ signal }, "shutting down");
  worker.stop();
  server.close(() => {
    store.close();
    process.exit(0);
  });
  // Do not hang forever on a stuck connection.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
