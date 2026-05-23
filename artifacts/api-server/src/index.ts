import app from "./app";
import { logger } from "./lib/logger";

const port = Number(process.env.PORT ?? 8080);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${process.env.PORT}"`);
}

// Surface unhandled promise rejections and uncaught exceptions so the
// process doesn't die silently. Several route handlers use fire-and-forget
// async patterns (extraction IIFE, recalculateAfterMutation .catch(() => {}));
// if an inner await rejects we want a log line rather than the default
// Node 22 behavior (warn → eventually terminate).
process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "unhandledRejection");
});
process.on("uncaughtException", (err) => {
  logger.error({ err }, "uncaughtException");
});

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
