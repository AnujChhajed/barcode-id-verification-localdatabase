-- =============================================================================
-- ABB Plant 3 — Security Gate Verification & ID Management System
-- Migration 0003 — watchlist
-- =============================================================================
--
-- A watchlist entry is a person the security office wants flagged at the gate.
-- It is NOT a credential and it never grants or denies access on its own — the
-- gate still runs the normal credential check and the alert is shown alongside
-- the verdict. The guard decides what to do.
--
-- An entry can optionally be linked to a person already on file (`person_id`)
-- or to a known card value (`barcode`). Either match raises the alert.
--
-- Deactivating is soft: `is_active` is set to 0 and the row is kept, so the
-- history of what was flagged, why, and by whom survives.
-- =============================================================================

CREATE TABLE watchlist (
  id          TEXT PRIMARY KEY,
  full_name   TEXT NOT NULL,
  reason      TEXT NOT NULL,
  notes       TEXT,
  level       TEXT NOT NULL CHECK (level IN ('info', 'warn', 'deny', 'detain')),
  person_id   TEXT REFERENCES people(id),
  barcode     TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_by  TEXT REFERENCES users(id),
  created_at  TEXT NOT NULL,
  expires_at  TEXT
);

CREATE INDEX ix_watchlist_active ON watchlist (is_active);
CREATE INDEX ix_watchlist_person ON watchlist (person_id);
CREATE INDEX ix_watchlist_barcode ON watchlist (barcode);
