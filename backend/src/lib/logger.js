/**
 * Diagnostic logger — structured JSON lines on stdout/stderr.
 *
 * Kept deliberately SEPARATE from the business audit log (`lib/audit.js`):
 * this stream is for operators and troubleshooting, the audit log is evidence.
 * Sensitive-looking keys are redacted so secrets never reach the log files.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const configuredLevel = LEVELS[(process.env.LOG_LEVEL || "").toLowerCase()] ?? LEVELS.info;

const SENSITIVE_KEY = /password|passphrase|token|secret|authorization|cookie|api[-_]?key/i;
const MAX_DEPTH = 4;

function redact(value, depth = 0) {
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return "[truncated]";
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = SENSITIVE_KEY.test(key) ? "[redacted]" : redact(item, depth + 1);
  }
  return output;
}

function emit(level, message, context) {
  if (LEVELS[level] < configuredLevel) return;
  const record = { ts: new Date().toISOString(), level, message };
  if (context !== undefined) record.context = redact(context);
  const line = `${JSON.stringify(record)}\n`;
  if (level === "error") process.stderr.write(line);
  else process.stdout.write(line);
}

export const logger = {
  debug: (message, context) => emit("debug", message, context),
  info: (message, context) => emit("info", message, context),
  warn: (message, context) => emit("warn", message, context),
  error: (message, context) => emit("error", message, context),
};
