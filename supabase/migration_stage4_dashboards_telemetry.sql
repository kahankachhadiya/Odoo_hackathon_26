-- =============================================================================
-- AssetFlow Stage 4 — Additive Migration: Dashboards & Telemetry
-- File:    supabase/migration_stage4_dashboards_telemetry.sql
-- Apply:   Supabase Dashboard → SQL Editor → paste → Run
--          (or via supabase db push against a linked project)
--
-- IMPORTANT: This file is ADDITIVE ONLY.
--            It NEVER modifies schema.sql, migration_stage2_assets_allocation.sql,
--            or migration_stage3_booking_maintenance.sql.
--            Safe to re-run: enum uses DO $$ block, table uses IF NOT EXISTS,
--            triggers use DROP IF EXISTS before recreation, policies use
--            DROP IF EXISTS before recreation, functions use CREATE OR REPLACE.
--
-- Dependency: Stages 1, 2 & 3 must already be applied (profiles, assets,
--             allocations, bookings, maintenance_requests must exist).
-- Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 3.5,
--               4.1, 4.2, 4.3, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 6.1, 6.2,
--               6.3, 6.4, 6.5
-- =============================================================================


-- =============================================================================
-- SECTION 0 — Prerequisite Guard
-- Verify that all Stage 1–3 objects this migration depends on exist.
-- Raises an exception (aborting the entire script) if any are missing.
-- =============================================================================
DO $$
BEGIN
  -- Check profiles (Stage 1)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'profiles'
  ) THEN
    RAISE EXCEPTION
      'Migration prerequisite failed: table "profiles" does not exist. '
      'Apply the Stage 1 schema (schema.sql) before running this migration.';
  END IF;

  -- Check assets (Stage 2)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'assets'
  ) THEN
    RAISE EXCEPTION
      'Migration prerequisite failed: table "assets" does not exist. '
      'Apply the Stage 2 migration (migration_stage2_assets_allocation.sql) '
      'before running this migration.';
  END IF;

  -- Check allocations (Stage 2)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'allocations'
  ) THEN
    RAISE EXCEPTION
      'Migration prerequisite failed: table "allocations" does not exist. '
      'Apply the Stage 2 migration (migration_stage2_assets_allocation.sql) '
      'before running this migration.';
  END IF;

  -- Check bookings (Stage 3)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'bookings'
  ) THEN
    RAISE EXCEPTION
      'Migration prerequisite failed: table "bookings" does not exist. '
      'Apply the Stage 3 migration (migration_stage3_booking_maintenance.sql) '
      'before running this migration.';
  END IF;

  -- Check maintenance_requests (Stage 3)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'maintenance_requests'
  ) THEN
    RAISE EXCEPTION
      'Migration prerequisite failed: table "maintenance_requests" does not exist. '
      'Apply the Stage 3 migration (migration_stage3_booking_maintenance.sql) '
      'before running this migration.';
  END IF;
END;
$$;


-- =============================================================================
-- SECTION 1 — Enum Type: activity_log_event_type
-- Using the DO $$ … EXCEPTION WHEN duplicate_object THEN null pattern so
-- the migration is idempotent (safe to run more than once).
-- Requirements: 1.2
-- =============================================================================
DO $$ BEGIN
  CREATE TYPE activity_log_event_type AS ENUM (
    'Asset Registered',
    'Allocation',
    'Transfer',
    'Booking',
    'Maintenance',
    'Audit'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- =============================================================================
-- SECTION 2 — Table: activity_logs
-- Append-only audit ledger written exclusively by SECURITY DEFINER triggers.
-- actor_id uses ON DELETE SET NULL so log rows survive profile deletion.
-- reference_id is intentionally unconstrained — referenced rows may be deleted
-- while the log entry must remain.
-- Requirements: 1.1, 1.3
-- =============================================================================
CREATE TABLE IF NOT EXISTS activity_logs (
  id           UUID                    PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type   activity_log_event_type NOT NULL,
  message      TEXT                    NOT NULL
               CHECK (char_length(message) BETWEEN 1 AND 1000),
  actor_id     UUID                    REFERENCES profiles(id) ON DELETE SET NULL,
  reference_id UUID,
  created_at   TIMESTAMPTZ             NOT NULL DEFAULT now()
);


-- =============================================================================
-- SECTION 3 — Trigger Function: log_new_allocation()
-- AFTER INSERT on allocations FOR EACH ROW.
-- Looks up asset tag and both profile full_names; falls back to 'Unknown'.
-- Entire body wrapped in EXCEPTION WHEN OTHERS THEN NULL — core allocation
-- INSERT must never be blocked by a telemetry failure.
-- Requirements: 2.1, 2.2, 2.3, 2.4
-- =============================================================================
CREATE OR REPLACE FUNCTION log_new_allocation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_asset_tag        TEXT;
  v_assigned_by_name TEXT;
  v_assigned_to_name TEXT;
  v_message          TEXT;
BEGIN
  BEGIN
    SELECT tag INTO v_asset_tag
      FROM public.assets WHERE id = NEW.asset_id;
    v_asset_tag := COALESCE(v_asset_tag, 'Unknown');

    SELECT full_name INTO v_assigned_by_name
      FROM public.profiles WHERE id = NEW.assigned_by;
    v_assigned_by_name := COALESCE(v_assigned_by_name, 'Unknown');

    SELECT full_name INTO v_assigned_to_name
      FROM public.profiles WHERE id = NEW.assigned_to;
    v_assigned_to_name := COALESCE(v_assigned_to_name, 'Unknown');

    v_message := 'Asset ' || v_asset_tag
              || ' allocated by ' || v_assigned_by_name
              || ' to ' || v_assigned_to_name;

    INSERT INTO public.activity_logs (event_type, message, actor_id, reference_id)
    VALUES ('Allocation', v_message, NEW.assigned_by, NEW.id);

  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN NEW;
END;
$$;

-- Attach trigger (idempotent)
DROP TRIGGER IF EXISTS on_allocation_logged ON allocations;
CREATE TRIGGER on_allocation_logged
  AFTER INSERT ON allocations
  FOR EACH ROW EXECUTE FUNCTION log_new_allocation();


-- =============================================================================
-- SECTION 4 — Trigger Function: log_maintenance_update()
-- AFTER UPDATE on maintenance_requests FOR EACH ROW.
-- Only fires when status transitions to 'Approved' or 'Resolved' from a
-- different prior status — the OLD.status guard prevents duplicate log entries
-- on idempotent re-updates.
-- Requirements: 3.1, 3.2, 3.3, 3.4, 3.5
-- =============================================================================
CREATE OR REPLACE FUNCTION log_maintenance_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_asset_tag TEXT;
  v_message   TEXT;
BEGIN
  IF (NEW.status = 'Approved'  AND OLD.status != 'Approved')
  OR (NEW.status = 'Resolved'  AND OLD.status != 'Resolved')
  THEN
    BEGIN
      SELECT tag INTO v_asset_tag
        FROM public.assets WHERE id = NEW.asset_id;
      v_asset_tag := COALESCE(v_asset_tag, 'Unknown');

      v_message := 'Maintenance request for ' || v_asset_tag || ' ' || NEW.status;

      INSERT INTO public.activity_logs (event_type, message, actor_id, reference_id)
      VALUES ('Maintenance', v_message, NEW.requested_by, NEW.id);

    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  RETURN NEW;
END;
$$;

-- Attach trigger (idempotent)
DROP TRIGGER IF EXISTS on_maintenance_logged ON maintenance_requests;
CREATE TRIGGER on_maintenance_logged
  AFTER UPDATE ON maintenance_requests
  FOR EACH ROW EXECUTE FUNCTION log_maintenance_update();


-- =============================================================================
-- SECTION 5 — Trigger Function: log_booking_created()
-- AFTER INSERT on bookings FOR EACH ROW.
-- Message uses NEW.title and NEW.start_time::DATE for a human-readable entry.
-- Requirements: 4.1, 4.2, 4.3
-- =============================================================================
CREATE OR REPLACE FUNCTION log_booking_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_message TEXT;
BEGIN
  BEGIN
    v_message := 'Resource ' || NEW.title
              || ' booked for ' || NEW.start_time::DATE;

    INSERT INTO public.activity_logs (event_type, message, actor_id, reference_id)
    VALUES ('Booking', v_message, NEW.booked_by, NEW.id);

  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN NEW;
END;
$$;

-- Attach trigger (idempotent)
DROP TRIGGER IF EXISTS on_booking_logged ON bookings;
CREATE TRIGGER on_booking_logged
  AFTER INSERT ON bookings
  FOR EACH ROW EXECUTE FUNCTION log_booking_created();


-- =============================================================================
-- SECTION 6 — Row Level Security: activity_logs
-- Four-tier visibility model enforced entirely at the DB level.
-- SECURITY DEFINER trigger functions bypass RLS and remain the sole write path.
-- Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7
-- =============================================================================
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;

-- Drop before recreate (idempotency)
DROP POLICY IF EXISTS "activity_logs_select_admin_asset_manager" ON activity_logs;
DROP POLICY IF EXISTS "activity_logs_select_dept_head"           ON activity_logs;
DROP POLICY IF EXISTS "activity_logs_select_employee"            ON activity_logs;
DROP POLICY IF EXISTS "activity_logs_insert_denied"              ON activity_logs;
DROP POLICY IF EXISTS "activity_logs_update_denied"              ON activity_logs;
DROP POLICY IF EXISTS "activity_logs_delete_denied"              ON activity_logs;

-- Tier 1: Admin / Asset Manager — see all rows
-- Requirements: 5.2
CREATE POLICY "activity_logs_select_admin_asset_manager"
  ON activity_logs FOR SELECT
  USING (
    auth.role() = 'authenticated'
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('Admin', 'Asset Manager')
    )
  );

-- Tier 2: Department Head — see rows where actor belongs to their department
-- actor_id IS NOT NULL guard ensures NULL-actor rows are never exposed.
-- Requirements: 5.3
CREATE POLICY "activity_logs_select_dept_head"
  ON activity_logs FOR SELECT
  USING (
    auth.role() = 'authenticated'
    AND activity_logs.actor_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.profiles  AS actor
      JOIN public.departments AS dept ON dept.id = actor.department_id
      WHERE actor.id     = activity_logs.actor_id
        AND dept.head_id = auth.uid()
    )
  );

-- Tier 3: Employee — see only their own rows
-- Requirements: 5.4
CREATE POLICY "activity_logs_select_employee"
  ON activity_logs FOR SELECT
  USING (
    auth.role() = 'authenticated'
    AND activity_logs.actor_id = auth.uid()
  );

-- INSERT denied — SECURITY DEFINER triggers are the sole insert path
-- Requirements: 5.5
CREATE POLICY "activity_logs_insert_denied"
  ON activity_logs FOR INSERT
  WITH CHECK (false);

-- UPDATE denied — append-only ledger
-- Requirements: 5.6
CREATE POLICY "activity_logs_update_denied"
  ON activity_logs FOR UPDATE
  USING (false);

-- DELETE denied — append-only ledger
-- Requirements: 5.7
CREATE POLICY "activity_logs_delete_denied"
  ON activity_logs FOR DELETE
  USING (false);


-- =============================================================================
-- END OF MIGRATION
-- All Stage 4 schema additions applied successfully.
-- Objects created:
--   • activity_log_event_type enum (6 values)
--   • activity_logs table (6 columns, RLS enabled)
--   • log_new_allocation()     trigger → on_allocation_logged      (allocations)
--   • log_maintenance_update() trigger → on_maintenance_logged     (maintenance_requests)
--   • log_booking_created()    trigger → on_booking_logged         (bookings)
--   • 6 RLS policies on activity_logs
-- =============================================================================
