-- =============================================================================
-- ABB Plant 3 — Security Gate Verification & ID Management System
-- Migration 0004 — short readable person ID (W101, I101, V101, GRP101)
-- =============================================================================
--
-- Adds a human-readable display ID (W101 for workers, I101 for interns,
-- V101 for visitors, GRP101 for group visitor passes) distinct from internal UUIDs.
-- The column is indexed uniquely per plant so scans and manual entries can
-- resolve directly to the person and their active credential.
-- =============================================================================

ALTER TABLE people ADD COLUMN short_id TEXT;

CREATE UNIQUE INDEX ux_people_short_id
  ON people (plant_id, short_id) WHERE short_id IS NOT NULL;

-- Backfill existing seed/local records
UPDATE people SET short_id = 'W101' WHERE id = 'c10bbe2f-d9a0-4b46-9262-7cf3ff414238' AND short_id IS NULL;
UPDATE people SET short_id = 'I101' WHERE id = '6e4abc88-ecac-41d3-a799-4740a38c26a8' AND short_id IS NULL;
UPDATE people SET short_id = 'I102' WHERE id = '900c2b47-938f-4d5a-a0ef-5466ef1f8a5b' AND short_id IS NULL;
UPDATE people SET short_id = 'I103' WHERE id = '3196b0de-6e5d-4742-a874-4a6aab6441c6' AND short_id IS NULL;
