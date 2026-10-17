/**
 * Application errors carry an HTTP status and a stable machine-readable `code`.
 * The error handler serialises only these fields, so internal details (stack
 * traces, SQL messages, file paths) never reach the browser.
 */
export class AppError extends Error {
  constructor(code, status, message, details) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (message = "The request is invalid.", details) =>
  new AppError("BAD_REQUEST", 400, message, details);

export const unauthorized = (message = "Authentication required.") =>
  new AppError("UNAUTHORIZED", 401, message);

export const forbidden = (message = "You do not have permission to perform this action.") =>
  new AppError("FORBIDDEN", 403, message);

export const notFound = (message = "Resource not found.") =>
  new AppError("NOT_FOUND", 404, message);

export const conflict = (message = "The request conflicts with existing data.") =>
  new AppError("CONFLICT", 409, message);

export const tooManyRequests = (message = "Too many attempts. Please wait and try again.") =>
  new AppError("TOO_MANY_REQUESTS", 429, message);

export const serviceUnavailable = (message = "The service is temporarily unavailable.") =>
  new AppError("SERVICE_UNAVAILABLE", 503, message);
