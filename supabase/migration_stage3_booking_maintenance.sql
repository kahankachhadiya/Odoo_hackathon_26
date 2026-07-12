-- =============================================================================
-- AssetFlow Stage 3 — Additive Migration: Resource Booking & Maintenance
-- File:    supabase/migration_stage3_booking_maintenance.sql
-- Apply:   Supabase Dashboard → SQL Editor → paste → Run
--          (or via supabase db push against a linked project)
--
-- IMPORTANT: This file is ADDITIVE ONLY.
--            It NEVER modifies schema.sql or migration_stage2_assets_allocation.sql.
--            Safe to re-run: enums use DO $$ blocks, tables use IF NOT EXISTS,
--            triggers use DROP IF EXISTS before recreation, policies use
--            DROP IF EXISTS before recreation.
--
-- Dependency: Stages 1 & 2 must already be applied (assets, profiles,
--             is_admin(), is_asset_manager() must exist).
-- =============================================================================


-- =============================================================================
-- SECTION 0 — Prerequisite Guard
-- Verify that all Stage 1 & 2 objects this migration depends on exist.
-- Raises an exception (aborting the entire script) if any are missing.
-- Requirements: 14.4, 14.5
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

  -- Check is_admin() SECURITY DEFINER helper (Stage 1)
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'is_admin'
  ) THEN
    RAISE EXCEPTION
      'Migration prerequisite failed: function "is_admin()" does not exist. '
      'Apply the Stage 1 schema (schema.sql) before running this migration.';
  END IF;

  -- Check is_asset_manager() SECURITY DEFINER helper (Stage 2)
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'is_asset_manager'
  ) THEN
    RAISE EXCEPTION
      'Migration prerequisite failed: function "is_asset_manager()" does not exist. '
      'Apply the Stage 2 migration (migration_stage2_assets_allocation.sql) '
      'before running this migration.';
  END IF;
END;
$$;


-- =============================================================================
-- SECTION 1 — Enum Types
-- Using the DO $$ … EXCEPTION WHEN duplicate_object THEN null pattern so
-- the migration is idempotent (safe to run more than once).
-- Requirements: 1, 2 (booking_status, maintenance_priority, maintenance_status)
-- =============================================================================

-- booking_status: lifecycle states for a time-slot reservation
DO $$ BEGIN
  CREATE TYPE booking_status AS ENUM (
    'Upcoming',
    'Ongoing',
    'Completed',
    'Cancelled'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- maintenance_priority: urgency level for repair tickets
DO $$ BEGIN
  CREATE TYPE maintenance_priority AS ENUM (
    'Low',
    'Medium',
    'High'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- maintenance_status: approval workflow states for repair tickets
-- 'Rejected' rows are filtered out of the Kanban board UI but kept in the DB
DO $$ BEGIN
  CREATE TYPE maintenance_status AS ENUM (
    'Pending',
    'Approved',
    'In Progress',
    'Resolved',
    'Rejected'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;


-- =============================================================================
-- SECTION 2 — Table: bookings
-- Records every time-slot reservation on a bookable asset.
-- ON DELETE CASCADE on both FKs: deleting an asset or profile automatically
-- removes all associated bookings (no audit-trail requirement per PRD).
-- Requirements: 1.1, 1.2, 1.3, 1.4
-- =============================================================================
CREATE TABLE IF NOT EXISTS bookings (
  -- Primary key: randomly generated UUID
  id         UUID           PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The asset being reserved; cascades on asset deletion
  asset_id   UUID           NOT NULL REFERENCES assets(id)   ON DELETE CASCADE,

  -- The user who made the reservation; cascades on profile deletion
  booked_by  UUID           NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- Short descriptive title for the booking (e.g., "Team standup", "Demo session")
  title      TEXT           NOT NULL,

  -- Reservation window — both are required; end must be after start
  start_time TIMESTAMPTZ    NOT NULL,
  end_time   TIMESTAMPTZ    NOT NULL,

  -- Lifecycle status, defaults to Upcoming on creation
  status     booking_status NOT NULL DEFAULT 'Upcoming',

  -- Time-order constraint: every booking must end strictly after it starts
  CONSTRAINT bookings_time_order CHECK (start_time < end_time)
);


-- =============================================================================
-- SECTION 3 — Table: maintenance_requests
-- Records repair / maintenance tickets raised against specific assets.
-- ON DELETE CASCADE on both FKs matches the bookings pattern.
-- Requirements: 2.1, 2.2, 2.3
-- =============================================================================
CREATE TABLE IF NOT EXISTS maintenance_requests (
  -- Primary key: randomly generated UUID
  id                UUID                 PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The asset requiring maintenance; cascades on asset deletion
  asset_id          UUID                 NOT NULL REFERENCES assets(id)   ON DELETE CASCADE,

  -- The user who raised the ticket; cascades on profile deletion
  requested_by      UUID                 NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- Detailed description of the issue; required, free-form text
  issue_description TEXT                 NOT NULL,

  -- Urgency level; defaults to Medium when not explicitly supplied
  priority          maintenance_priority NOT NULL DEFAULT 'Medium',

  -- Approval-workflow state; starts in Pending until an Asset Manager acts
  status            maintenance_status   NOT NULL DEFAULT 'Pending',

  -- Optional name of the technician assigned to resolve the ticket.
  -- Plain TEXT (not a FK to profiles) — avoids requiring a separate
  -- technicians-management UI for the hackathon timeline.
  technician_name   TEXT,

  -- Immutable creation timestamp; used for ordering in the Kanban board
  created_at        TIMESTAMPTZ          NOT NULL DEFAULT now()
);


-- =============================================================================
-- SECTION 4 — Trigger Function: prevent_booking_overlap()
-- BEFORE trigger on bookings — abort INSERT/UPDATE if any non-cancelled
-- booking on the same asset has an overlapping time interval.
--
-- Overlap condition (half-open interval check):
--   NEW.start_time < existing.end_time  AND  NEW.end_time > existing.start_time
--
-- The `id != NEW.id` guard prevents a row from conflicting with itself
-- on UPDATE (e.g., changing only the title leaves times unchanged).
--
-- Adjacent bookings (b1.end_time == b2.start_time) are PERMITTED because
-- the strict-inequality check means touching intervals are not overlapping.
--
-- SECURITY DEFINER + SET search_path = public follows the same safety
-- convention used by all existing Stage 1/2 trigger functions.
-- Requirements: 3.1, 3.2, 3.3, 3.4, 3.5
-- =============================================================================
CREATE OR REPLACE FUNCTION prevent_booking_overlap()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.bookings
    WHERE  asset_id       = NEW.asset_id
      AND  id            != NEW.id          -- exclude the row being updated (self-check)
      AND  status        != 'Cancelled'     -- cancelled bookings vacate their slot
      AND  NEW.start_time < end_time        -- new booking starts before existing ends
      AND  NEW.end_time   > start_time      -- new booking ends after existing starts
  ) THEN
    RAISE EXCEPTION 'Booking time slot overlaps with an existing reservation';
  END IF;

  RETURN NEW;
END;
$$;

-- Attach the overlap-prevention trigger to bookings.
-- DROP + CREATE ensures idempotency on re-run.
DROP TRIGGER IF EXISTS on_booking_overlap_check ON bookings;
CREATE TRIGGER on_booking_overlap_check
  BEFORE INSERT OR UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION prevent_booking_overlap();


-- =============================================================================
-- SECTION 5 — Trigger Function: sync_maintenance_status()
-- AFTER trigger on maintenance_requests — keeps assets.status in sync
-- whenever a maintenance ticket transitions to a significant state.
--
-- Transition rules:
--   Approved  → assets.status = 'Under Maintenance'
--              (OLD.status != 'Approved' guard makes this idempotent)
--   Resolved  → assets.status = 'Available'
--              (does NOT restore prior 'Allocated' state — known simplification)
--   Rejected  → assets.status = 'Available'  ONLY when asset is currently
--               'Under Maintenance', preventing an inadvertent status change
--               when rejecting a Pending ticket whose asset is still Available.
--   All other transitions → no change to assets.status
--
-- Runs AFTER UPDATE (consistent with Stage 2's sync_asset_status() pattern).
-- SECURITY DEFINER allows the function to UPDATE assets regardless of the
-- triggering session's direct permissions.
-- Requirements: 4.1, 4.2, 4.3, 4.4, 4.5
-- =============================================================================
CREATE OR REPLACE FUNCTION sync_maintenance_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Ticket approved: put the asset into maintenance mode
  IF NEW.status = 'Approved' AND OLD.status != 'Approved' THEN
    UPDATE public.assets
    SET status = 'Under Maintenance'
    WHERE id = NEW.asset_id;

  -- Ticket resolved: mark the asset as available again
  ELSIF NEW.status = 'Resolved' AND OLD.status != 'Resolved' THEN
    UPDATE public.assets
    SET status = 'Available'
    WHERE id = NEW.asset_id;

  -- Ticket rejected: only reset to Available if asset is currently Under Maintenance.
  -- This prevents accidentally changing the status when a Pending ticket is rejected
  -- before the asset was ever put into maintenance.
  ELSIF NEW.status = 'Rejected' THEN
    UPDATE public.assets
    SET status = 'Available'
    WHERE id = NEW.asset_id
      AND status = 'Under Maintenance';
  END IF;

  RETURN NEW;
END;
$$;

-- Attach the maintenance-status sync trigger to maintenance_requests.
-- DROP + CREATE ensures idempotency on re-run.
DROP TRIGGER IF EXISTS on_maintenance_status_change ON maintenance_requests;
CREATE TRIGGER on_maintenance_status_change
  AFTER UPDATE ON maintenance_requests
  FOR EACH ROW EXECUTE FUNCTION sync_maintenance_status();


-- =============================================================================
-- SECTION 6 — Row Level Security: bookings table
-- Requirements: 5.1, 5.2, 5.3, 5.4, 5.5
-- =============================================================================
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

-- Drop existing policies before recreating (idempotency)
DROP POLICY IF EXISTS "bookings_select_authenticated"    ON bookings;
DROP POLICY IF EXISTS "bookings_insert_bookable_asset"   ON bookings;
DROP POLICY IF EXISTS "bookings_update_owner_or_admin"   ON bookings;
DROP POLICY IF EXISTS "bookings_delete_denied"           ON bookings;

-- Any authenticated user can read all bookings (visibility for schedule planning)
CREATE POLICY "bookings_select_authenticated"
  ON bookings FOR SELECT
  USING (auth.role() = 'authenticated');

-- Any authenticated user may create a booking, provided the asset is bookable.
-- The WITH CHECK on is_bookable = true enforces Requirement 5.3 at the DB level.
CREATE POLICY "bookings_insert_bookable_asset"
  ON bookings FOR INSERT
  WITH CHECK (
    auth.role() = 'authenticated'
    AND EXISTS (
      SELECT 1 FROM public.assets
      WHERE id = bookings.asset_id
        AND is_bookable = true
    )
  );

-- A booking can be updated (e.g., cancelled) only by:
--   • the user who created it  (booked_by = auth.uid()), OR
--   • an Admin (via the existing is_admin() SECURITY DEFINER helper)
CREATE POLICY "bookings_update_owner_or_admin"
  ON bookings FOR UPDATE
  USING (booked_by = auth.uid() OR is_admin())
  WITH CHECK (booked_by = auth.uid() OR is_admin());

-- DELETE is permanently denied for all users
-- Cancellation is handled by setting status = 'Cancelled' via UPDATE.
CREATE POLICY "bookings_delete_denied"
  ON bookings FOR DELETE
  USING (false);


-- =============================================================================
-- SECTION 7 — Row Level Security: maintenance_requests table
-- Requirements: 6.1, 6.2, 6.3, 6.4, 6.5
-- =============================================================================
ALTER TABLE maintenance_requests ENABLE ROW LEVEL SECURITY;

-- Drop existing policies before recreating (idempotency)
DROP POLICY IF EXISTS "maintenance_requests_select_authenticated"      ON maintenance_requests;
DROP POLICY IF EXISTS "maintenance_requests_insert_authenticated"      ON maintenance_requests;
DROP POLICY IF EXISTS "maintenance_requests_update_asset_manager"     ON maintenance_requests;
DROP POLICY IF EXISTS "maintenance_requests_delete_denied"            ON maintenance_requests;

-- Any authenticated user can read all maintenance requests (board visibility)
CREATE POLICY "maintenance_requests_select_authenticated"
  ON maintenance_requests FOR SELECT
  USING (auth.role() = 'authenticated');

-- Any authenticated user can raise a new maintenance request
CREATE POLICY "maintenance_requests_insert_authenticated"
  ON maintenance_requests FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- Only Admin or Asset Manager can update ticket status / assign technician.
-- Uses is_asset_manager() which returns TRUE for both 'Admin' and 'Asset Manager'.
CREATE POLICY "maintenance_requests_update_asset_manager"
  ON maintenance_requests FOR UPDATE
  USING (is_asset_manager())
  WITH CHECK (is_asset_manager());

-- DELETE is permanently denied for all users
-- Rejected tickets remain in the DB but are filtered out of the UI.
CREATE POLICY "maintenance_requests_delete_denied"
  ON maintenance_requests FOR DELETE
  USING (false);


-- =============================================================================
-- END OF MIGRATION
-- All Stage 3 schema additions applied successfully.
-- =============================================================================


-- =============================================================================
-- ROLLBACK STATEMENTS (commented — for manual disaster recovery only)
-- Execute these statements IN ORDER to undo everything added by this migration.
--
-- WARNING: Dropping tables destroys all data permanently.
-- Only use these statements in a controlled rollback scenario with a
-- verified backup already confirmed good.
-- =============================================================================

/*

-- Step 1: Remove RLS policies (maintenance_requests)
DROP POLICY IF EXISTS "maintenance_requests_delete_denied"            ON maintenance_requests;
DROP POLICY IF EXISTS "maintenance_requests_update_asset_manager"     ON maintenance_requests;
DROP POLICY IF EXISTS "maintenance_requests_insert_authenticated"     ON maintenance_requests;
DROP POLICY IF EXISTS "maintenance_requests_select_authenticated"     ON maintenance_requests;

-- Step 2: Remove RLS policies (bookings)
DROP POLICY IF EXISTS "bookings_delete_denied"           ON bookings;
DROP POLICY IF EXISTS "bookings_update_owner_or_admin"   ON bookings;
DROP POLICY IF EXISTS "bookings_insert_bookable_asset"   ON bookings;
DROP POLICY IF EXISTS "bookings_select_authenticated"    ON bookings;

-- Step 3: Drop triggers
DROP TRIGGER  IF EXISTS on_maintenance_status_change ON maintenance_requests;
DROP TRIGGER  IF EXISTS on_booking_overlap_check     ON bookings;

-- Step 4: Drop trigger functions
DROP FUNCTION IF EXISTS sync_maintenance_status();
DROP FUNCTION IF EXISTS prevent_booking_overlap();

-- Step 5: Drop tables (maintenance_requests first — no dependency on bookings)
DROP TABLE IF EXISTS maintenance_requests;
DROP TABLE IF EXISTS bookings;

-- Step 6: Drop enum types
DROP TYPE IF EXISTS maintenance_status;
DROP TYPE IF EXISTS maintenance_priority;
DROP TYPE IF EXISTS booking_status;

*/
