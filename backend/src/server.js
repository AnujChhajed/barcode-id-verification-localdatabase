import { createApp, spaBuildExists } from "./app.js";
import { ensureFirstAdmin } from "./auth/local-account.js";
import { config } from "./config.js";
import { openDatabase } from "./db/connection.js";
import { pendingMigrations, runMigrations } from "./db/migrate.js";
import { logger } from "./lib/logger.js";

const db = openDatabase();

if (config.isProduction) {
  // Production never migrates itself: a human runs `npm run migrate` first.
  const pending = pendingMigrations(db);
  if (pending.length > 0) {
    logger.warn("pending migrations — run `npm run migrate` before serving traffic", { pending });
  }
} else {
  runMigrations(db);
}

// An empty `users` table means nobody could sign in, so the first administrator
// is created once. An existing account is never overwritten.
ensureFirstAdmin(db);

const serveStatic = spaBuildExists();
if (!serveStatic) {
  logger.warn(
    `no frontend build found in ${config.staticDir} — serving the API only. ` +
      `Run \`npm run build\` first, or use \`npm run dev\` for the live dev server.`,
  );
}

const app = createApp({ db, serveStatic });

const server = app.listen(config.port, config.host, () => {
  logger.info("ABB Plant 3 server listening", {
    url: `http://${config.host === "::" ? "localhost" : config.host}:${config.port}`,
    host: config.host,
    port: config.port,
    nodeEnv: config.nodeEnv,
    servingFrontend: serveStatic,
    routes: app.locals.routeInventory.length,
  });
});

let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("shutting down", { signal });
  server.close(() => {
    try {
      db.close();
    } catch {
      // Already closed — nothing to do.
    }
    process.exit(0);
  });
  // Never hang forever waiting for lingering connections.
  setTimeout(() => process.exit(0), 10_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
