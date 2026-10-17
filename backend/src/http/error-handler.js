import { config } from "../config.js";
import { AppError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

function errorBody(code, message, details) {
  return { error: { code, message, ...(details ? { details } : {}) } };
}

export function notFoundHandler(req, res) {
  res.status(404).json(errorBody("NOT_FOUND", "Route not found."));
}

/**
 * The single place errors become HTTP responses.
 *
 * Only `AppError` messages are exposed. Anything else becomes a generic 500 so
 * stack traces, SQLite messages and file paths never reach the browser. Full
 * detail is written to the diagnostic log instead.
 */
export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  if (err instanceof AppError) {
    if (err.status >= 500) {
      logger.error("request failed", {
        code: err.code,
        method: req.method,
        path: req.originalUrl,
        message: err.message,
      });
    } else {
      logger.warn("request rejected", {
        code: err.code,
        method: req.method,
        path: req.originalUrl,
      });
    }
    return res.status(err.status).json(errorBody(err.code, err.message, err.details));
  }

  if (err && (err.type === "entity.parse.failed" || err instanceof SyntaxError)) {
    return res.status(400).json(errorBody("BAD_REQUEST", "Request body is not valid JSON."));
  }

  if (err && err.type === "entity.too.large") {
    return res.status(413).json(errorBody("PAYLOAD_TOO_LARGE", "Request body is too large."));
  }

  logger.error("unhandled error", {
    method: req.method,
    path: req.originalUrl,
    message: err?.message,
    stack: config.isProduction ? undefined : err?.stack,
  });
  return res.status(500).json(errorBody("INTERNAL", "An unexpected error occurred."));
}
