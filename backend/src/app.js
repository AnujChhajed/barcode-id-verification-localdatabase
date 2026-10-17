import fs from "node:fs";
import path from "node:path";
import cookieParser from "cookie-parser";
import express from "express";
import { createAuthorize, PUBLIC } from "./auth/middleware.js";
import { createRateLimiter } from "./auth/rate-limit.js";
import { config } from "./config.js";
import { createCors } from "./http/cors.js";
import { errorHandler, notFoundHandler } from "./http/error-handler.js";
import { createRouteRegistrar } from "./http/route.js";
import { registerAnnouncementRoutes } from "./routes/announcements.routes.js";
import { registerAuditRoutes } from "./routes/audit.routes.js";
import { registerAuthRoutes } from "./routes/auth.routes.js";
import { registerCanteenRoutes } from "./routes/canteen.routes.js";
import { registerCheckRoutes } from "./routes/check.routes.js";
import { registerCredentialRoutes } from "./routes/credentials.routes.js";
import { registerDashboardRoutes } from "./routes/dashboard.routes.js";
import { registerGateRoutes } from "./routes/gate.routes.js";
import { registerHealthRoutes } from "./routes/health.routes.js";
import { registerIncidentRoutes } from "./routes/incidents.routes.js";
import { registerPeopleRoutes } from "./routes/people.routes.js";
import { registerReportsRoutes } from "./routes/reports.routes.js";
import { registerSettingsRoutes } from "./routes/settings.routes.js";
import { registerUserRoutes } from "./routes/users.routes.js";
import { registerWatchlistRoutes } from "./routes/watchlist.routes.js";

/**
 * The complete set of unauthenticated routes. Anything public that is not
 * listed here makes the application refuse to start, so "public" can never
 * be widened by accident.
 *
 * The whole public surface is four routes: a health probe, the two ways to
 * obtain an identity (login, and a signup request that is created disabled),
 * and the holder's own card-status lookup.
 */
const BASE_PUBLIC_ROUTES = [
  "GET /api/health",
  "POST /api/auth/login",
  "POST /api/auth/signup",
  "GET /api/check/:code",
];

function assertPublicRoutes(inventory) {
  const allowlist = new Set(BASE_PUBLIC_ROUTES);
  const declared = new Set(
    inventory
      .filter((route) => route.access === PUBLIC)
      .map((route) => `${route.method} ${route.path}`),
  );
  for (const route of declared) {
    if (!allowlist.has(route)) {
      throw new Error(`Public route ${route} is missing from the explicit public allowlist`);
    }
  }
  for (const route of allowlist) {
    if (!declared.has(route)) {
      throw new Error(`Public allowlist entry ${route} does not match a registered public route`);
    }
  }
}

/**
 * Serves the built frontend from `dist`. Unknown non-API GETs fall back to
 * `index.html`, so a client-side route such as `/verify` survives a reload
 * instead of returning 404.
 */
function mountSpa(app) {
  const indexHtml = path.join(config.staticDir, "index.html");
  app.use(express.static(config.staticDir, { index: false }));
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (req.path === "/api" || req.path.startsWith("/api/")) return next();
    res.sendFile(indexHtml, (error) => {
      if (error) next();
    });
  });
}

/** True when a production build is present and can be served. */
export function spaBuildExists() {
  return fs.existsSync(path.join(config.staticDir, "index.html"));
}

export function createApp({
  db,
  sessionTimeoutMinutes = config.sessionTimeoutMinutes,
  rateLimit = config.loginRateLimit,
  corsOrigins = config.corsOrigins,
  serveStatic = false,
} = {}) {
  const app = express();
  app.disable("x-powered-by");
  if (config.trustProxy) app.set("trust proxy", true);

  // Order matters: CORS first (so even a rejected preflight gets the right
  // headers), then JSON parsing and cookie parsing — all infrastructure only.
  app.use(createCors({ origins: corsOrigins }));
  app.use(express.json({ limit: "256kb" }));
  app.use(cookieParser());

  const authorize = createAuthorize({ db });
  const rateLimiter = createRateLimiter(rateLimit);
  const router = express.Router();
  const registrar = createRouteRegistrar({ router, authorize });

  const context = { db, registrar, rateLimiter, sessionTimeoutMinutes };
  registerHealthRoutes(context);
  registerAuthRoutes(context);
  registerCheckRoutes(context);
  registerUserRoutes(context);
  registerSettingsRoutes(context);
  registerPeopleRoutes(context);
  registerCredentialRoutes(context);
  registerGateRoutes(context);
  registerDashboardRoutes(context);
  registerReportsRoutes(context);
  registerIncidentRoutes(context);
  registerCanteenRoutes(context);
  registerAnnouncementRoutes(context);
  registerWatchlistRoutes(context);
  registerAuditRoutes(context);

  assertPublicRoutes(registrar.inventory);

  app.use(router);

  // Serving the built frontend from the same origin as the API is what makes
  // `npm start` a single process on a single port: no CORS, and the session
  // cookie works without cross-origin configuration.
  if (serveStatic) mountSpa(app);

  app.use(notFoundHandler);
  app.use(errorHandler);

  app.locals.routeInventory = registrar.inventory;
  return app;
}
