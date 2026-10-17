import { config } from "../config.js";

/**
 * Cross-origin allowance for the browser app.
 *
 * In development the frontend runs on a different origin from the API (Vite on
 * :8080, Express on :4000), so the browser needs explicit permission to read the
 * responses. Because sessions are carried in an `HttpOnly` cookie, the request
 * must be credentialed and therefore the wildcard `*` is illegal — the exact
 * origin has to be echoed back.
 *
 * This is NOT an authorization control. Every route still enforces its own
 * access declaration; CORS only decides whether the browser is allowed to read
 * the reply. An origin that is not on the allowlist receives no CORS headers at
 * all, so the browser discards the response. The allowlist is empty in
 * production by default (`src/config.js`), where the app is served same-origin.
 */
export function createCors({ origins = config.corsOrigins } = {}) {
  const allowed = new Set(origins);

  return function cors(req, res, next) {
    const origin = req.headers.origin;

    if (origin && allowed.has(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "content-type");
      res.setHeader("Access-Control-Max-Age", "600");
      // The response varies by origin, so a shared cache must not reuse it.
      res.setHeader("Vary", "Origin");
    }

    // Preflight never reaches the router, so it can never require a session.
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }

    next();
  };
}
