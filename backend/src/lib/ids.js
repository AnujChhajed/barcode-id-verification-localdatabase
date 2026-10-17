import { createHash, randomBytes, randomUUID } from "node:crypto";

/** Opaque primary key used by every table (never a database-generated rowid). */
export function newId() {
  return randomUUID();
}

/** High-entropy secret handed to the client (session token, one-time link, ...). */
export function newToken() {
  return randomBytes(32).toString("base64url");
}

/**
 * The database stores only a HASH of a session token, so a leaked database
 * snapshot cannot be replayed as a live session.
 */
export function hashToken(token) {
  return createHash("sha256").update(String(token)).digest("hex");
}
