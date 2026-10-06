-- =============================================================================
-- CivicLink — APPEND to the end of the first migration (after Prisma's DDL).
-- Everything here is something Prisma's schema language cannot express:
-- spatial indexes, partial unique indexes, CHECK constraints, append-only audit.
-- Keep this file idempotent-friendly: each statement is safe to read on review.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Spatial indexes (GiST) — required for point-in-polygon at lookup time
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS jurisdictions_boundary_gist
  ON jurisdictions USING GIST (boundary)
  WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS saved_locations_point_gist
  ON saved_locations USING GIST (point);

CREATE INDEX IF NOT EXISTS lookups_geom_gist
  ON lookups USING GIST (geom);

-- Boundaries must be valid polygons so ST_Contains/ST_Intersects are reliable.
-- The pipeline runs ST_MakeValid() before insert; this guards against bad writes.
ALTER TABLE jurisdictions
  ADD CONSTRAINT jurisdictions_boundary_valid
  CHECK (boundary IS NULL OR ST_IsValid(boundary));

-- ---------------------------------------------------------------------------
-- 2. Business invariants as partial unique indexes
-- ---------------------------------------------------------------------------

-- One current officeholder per office.
CREATE UNIQUE INDEX IF NOT EXISTS office_terms_one_current_per_office
  ON office_terms (office_id)
  WHERE is_current;

-- One default saved location per resident.
CREATE UNIQUE INDEX IF NOT EXISTS saved_locations_one_default_per_user
  ON saved_locations (user_id)
  WHERE is_default;

-- HOME and WORK labels at most once per resident (OTHER may repeat).
CREATE UNIQUE INDEX IF NOT EXISTS saved_locations_home_work_once
  ON saved_locations (user_id, label)
  WHERE label IN ('HOME', 'WORK');

-- A resident cannot open the same correction twice while one is still open.
CREATE UNIQUE INDEX IF NOT EXISTS corrections_one_open_per_user_field
  ON corrections (user_id, entity_type, entity_id, field)
  WHERE status IN ('SUBMITTED', 'IN_REVIEW') AND user_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. CHECK constraints
-- ---------------------------------------------------------------------------

-- Service link targets exactly one of jurisdiction / office.
ALTER TABLE service_links
  ADD CONSTRAINT service_links_exactly_one_target
  CHECK (num_nonnulls(jurisdiction_id, office_id) = 1);

-- Alert targets exactly one of office / official.
ALTER TABLE alerts
  ADD CONSTRAINT alerts_exactly_one_target
  CHECK (num_nonnulls(target_office_id, target_official_id) = 1);

-- A sent alert has a sender, a timestamp and a recipient count.
ALTER TABLE alerts
  ADD CONSTRAINT alerts_sent_fields
  CHECK (status <> 'SENT' OR (sent_by IS NOT NULL AND sent_at IS NOT NULL AND recipient_count IS NOT NULL));

-- Dismissed corrections always carry a reason; resolved ones a timestamp.
ALTER TABLE corrections
  ADD CONSTRAINT corrections_dismiss_reason
  CHECK (status <> 'DISMISSED' OR dismiss_reason IS NOT NULL);
ALTER TABLE corrections
  ADD CONSTRAINT corrections_resolved_at
  CHECK (status NOT IN ('APPLIED', 'DISMISSED') OR resolved_at IS NOT NULL);

-- "Other" saved locations need a name.
ALTER TABLE saved_locations
  ADD CONSTRAINT saved_locations_other_named
  CHECK (label <> 'OTHER' OR custom_name IS NOT NULL);

-- Forced freshness must be explained.
ALTER TABLE jurisdictions ADD CONSTRAINT jurisdictions_freshness_note
  CHECK (freshness_override = 'NONE' OR freshness_note IS NOT NULL);
ALTER TABLE offices ADD CONSTRAINT offices_freshness_note
  CHECK (freshness_override = 'NONE' OR freshness_note IS NOT NULL);
ALTER TABLE officials ADD CONSTRAINT officials_freshness_note
  CHECK (freshness_override = 'NONE' OR freshness_note IS NOT NULL);

-- Term dates are ordered.
ALTER TABLE office_terms
  ADD CONSTRAINT office_terms_dates_ordered
  CHECK (term_start IS NULL OR term_end IS NULL OR term_start <= term_end);

-- Sane ranges.
ALTER TABLE sources ADD CONSTRAINT sources_freshness_days_range
  CHECK (freshness_days BETWEEN 1 AND 3650);
ALTER TABLE plans ADD CONSTRAINT plans_amount_non_negative
  CHECK (amount_cents >= 0);
ALTER TABLE jurisdictions ADD CONSTRAINT jurisdictions_state_format
  CHECK (state IS NULL OR state ~ '^[A-Z]{2}$');
ALTER TABLE lookups ADD CONSTRAINT lookups_zip_format
  CHECK (zip IS NULL OR zip ~ '^[0-9]{5}$');

-- ---------------------------------------------------------------------------
-- 4. Append-only change log (audit). Defence in depth on top of DB grants.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION change_log_block_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'change_log is append-only (% blocked)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS change_log_no_update ON change_log;
CREATE TRIGGER change_log_no_update
  BEFORE UPDATE OR DELETE ON change_log
  FOR EACH ROW EXECUTE FUNCTION change_log_block_mutation();

-- Note: change_log stores admin/system/source actor ids only. Resident-originated
-- entries use actor_type RESIDENT with actor_id NULL, so account purge never needs
-- to modify this table (see docs/02-RBAC-PERMISSIONS.md, "Audit").
