-- =============================================================================
-- ABB Plant 3 — Migration 0002 — reference data (PROPOSAL — not yet applied)
-- =============================================================================
-- Seeds the single in-scope site and gate, plus default settings.
-- Ids are plain opaque strings here because this is reference data, not
-- user-generated records.
--
-- NOTE: no user rows are seeded. The first administrator must be created by a
-- one-time bootstrap command that hashes the password properly — never as a
-- plaintext value in a migration.
-- =============================================================================

-- Plant 3 is the ONLY site in scope. More plants can be added later without a
-- rewrite; they simply must not be exposed in the UI until approved.
INSERT INTO plants (id, code, name, created_at)
VALUES ('plant-p3', 'P3', 'ABB Plant 3', '2026-10-16T00:00:00Z');

-- The requirements document states there is exactly ONE gate in Plant 3.
INSERT INTO gates (id, plant_id, code, name, is_active, created_at)
VALUES ('gate-p3-main', 'plant-p3', 'P3-MAIN', 'Plant 3 - Main Gate', 1,
        '2026-10-16T00:00:00Z');

-- Default settings. Values are strings and are validated by the backend.
INSERT INTO settings (key, value, updated_at) VALUES
  ('site.timezone',                  'Asia/Kolkata', '2026-10-16T00:00:00Z'),
  ('expiry.reminder_days',           '7',            '2026-10-16T00:00:00Z'),
  ('canteen.entries_per_person_day', '1',            '2026-10-16T00:00:00Z'),
  ('session.timeout_minutes',        '30',           '2026-10-16T00:00:00Z'),
  ('scan.duplicate_window_seconds',  '5',            '2026-10-16T00:00:00Z');
