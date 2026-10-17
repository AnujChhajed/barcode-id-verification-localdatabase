import path from "node:path";
import { fileURLToPath } from "node:url";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// The single project root. The built frontend lives in `<root>/dist`, so one
// Node process can serve both the API and the user interface.
const projectRoot = path.resolve(backendRoot, "..");

function intFromEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer, received: ${JSON.stringify(raw)}`);
  }
  return parsed;
}

function boolFromEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

function listFromEnv(name, fallback) {
  const raw = process.env[name] ?? fallback;
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

const nodeEnv = process.env.NODE_ENV || "development";
const dbPathSetting = process.env.DB_PATH || "./data/abb-plant3.db";

// In development the browser app runs on a different origin from the API
// (Vite on :8080, Express on :4000). Nothing is allowed by default in
// production, because there the frontend is served from the same origin.
const defaultCorsOrigins =
  nodeEnv === "production" ? "" : "http://localhost:8080,http://127.0.0.1:8080";

export const config = {
  backendRoot,
  projectRoot,
  staticDir: path.join(projectRoot, "dist"),
  nodeEnv,
  isProduction: nodeEnv === "production",
  host: process.env.HOST || "127.0.0.1",
  port: intFromEnv("PORT", 4000),
  dbPath: path.isAbsolute(dbPathSetting) ? dbPathSetting : path.resolve(backendRoot, dbPathSetting),
  migrationsDir: path.join(backendRoot, "migrations"),

  /**
   * The first administrator, created only while the `users` table is empty.
   * Without it a fresh install would have no account and nobody could sign in.
   * An existing row is never overwritten, so changing the password survives a
   * restart. Override the defaults before any real deployment.
   */
  localAdmin: {
    username: process.env.ABB_LOCAL_ADMIN_USERNAME || "admin",
    password: process.env.ABB_LOCAL_ADMIN_PASSWORD || "abb-plant3",
    fullName: process.env.ABB_LOCAL_ADMIN_NAME || "Gate Administrator",
    email: process.env.ABB_LOCAL_ADMIN_EMAIL || null,
  },

  sessionCookieName: "abb_session",
  sessionTimeoutMinutes: intFromEnv("SESSION_TIMEOUT_MINUTES", 30),
  sessionCookieSecure: boolFromEnv("SESSION_COOKIE_SECURE", nodeEnv === "production"),
  trustProxy: boolFromEnv("TRUST_PROXY", false),
  corsOrigins: listFromEnv("CORS_ORIGINS", defaultCorsOrigins),
  loginRateLimit: {
    windowMs: intFromEnv("LOGIN_RATE_WINDOW_MS", 15 * 60 * 1000),
    max: intFromEnv("LOGIN_RATE_MAX", 5),
  },
};
