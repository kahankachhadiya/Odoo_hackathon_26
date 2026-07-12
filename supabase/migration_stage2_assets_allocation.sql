-- =============================================================================
-- AssetFlow Stage 2 — Additive Migration: Assets & Allocation Engine
-- File:    supabase/migration_stage2_assets_allocation.sql
-- Apply:   Supabase Dashboard → SQL Editor → paste → Run
--          (or via supabase db push against a linked project)
--
-- IMPORTANT: This file is ADDITIVE ONLY.
--            It never modifies schema.sql or any Stage 1 objects.
--            Safe to re-run: sequences use IF NOT EXISTS, enums use DO $$
--            blocks, tables use IF NOT EXISTS, indexes use IF NOT EXISTS,
--            functions use CREATE OR REPLACE, policies are guarded by
--            DROP IF EXISTS before recreation.
--
-- Dependency: Stage 1 schema must already be applied (profiles, departments,
--             asset_categories, is_admin()).
-- =============================================================================


-- =============================================================================
-- SECTION 0 — Prerequisite Guard
-- Verify that the three Stage 1 tables this migration depends on exist.
-- Raises an exception (aborting the entire script) if any are missing.
-- =============================================================================
DO $$
BEGIN
  -- Check profiles
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'profiles'
  ) THEN
    RAISE EXCEPTION
      'Migration prerequisite failed: table "profiles" does not exist. '
      'Apply the Stage 1 schema (schema.sql) before running this migration.';
  END IF;

  -- Check departments
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'departments'
  ) THEN
    RAISE EXCEPTION
      'Migration prerequisite failed: table "departments" does not exist. '
      'Apply the Stage 1 schema (schema.sql) before running this migration.';
  END IF;

  -- Check asset_categories
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'asset_categories'
  ) THEN
    RAISE EXCEPTION
      'Migration prerequisite failed: table "asset_categories" does not exist. '
      'Apply the Stage 1 schema (schema.sql) before running this migration.';
  END IF;
END;
$$;


-- =============================================================================
-- SECTION 1 — Sequence: asset_tag_seq
-- Drives the human-readable AF-XXXX asset tag auto-generation.
-- Requirements: 1.1, 1.2, 1.3, 1.4, 17.1, 17.2
-- =============================================================================
CREATE SEQUENCE IF NOT EXISTS asset_tag_seq
  START 1
  INCREMENT 1;


-- =============================================================================
-- SECTION 2 — Enum Types
-- Using the DO $$ … EXCEPTION WHEN duplicate_object THEN null pattern so
-- the migration is idempotent (safe to run more than once).
-- Requirements: 2.3, 4.2
-- =============================================================================

-- asset_status: lifecycle states for physical assets
DO $$ BEGIN
  CREATE TYPE asset_status AS ENUM (
    'Available',
    'Allocated',
    'Reserved',
    'Under Maintenance',
    'Lost',
    'Retired',
    'Disposed'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- transfer_request_status: approval workflow states
DO $$ BEGIN
  CREATE TYPE transfer_request_status AS ENUM (
    'Pending',
    'Approved',
    'Rejected'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;


-- =============================================================================
-- SECTION 3 — Table: assets
-- Central inventory table. The tag column auto-generates from asset_tag_seq.
-- Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 17.1, 17.2, 17.4, 17.5, 18.1
-- =============================================================================
CREATE TABLE IF NOT EXISTS assets (
  -- Primary key: randomly generated UUID
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Human-readable unique identifier, auto-generated from sequence.
  -- Format: AF-0001, AF-0002, … AF-9999, AF-10000, …
  -- The LPAD ensures 4-digit zero-padding; once the sequence exceeds 9999
  -- the tag naturally expands (AF-10000) — no truncation or error.
  tag             TEXT        NOT NULL UNIQUE
                              DEFAULT 'AF-' || LPAD(nextval('asset_tag_seq')::TEXT, 4, '0'),

  -- Descriptive name, required, capped at 255 characters
  name            TEXT        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 255),

  -- Category assignment; deletion of a category that still has assets is blocked
  category_id     UUID        NOT NULL REFERENCES asset_categories(id) ON DELETE RESTRICT,

  -- Optional manufacturer/vendor serial number; unique when provided, NULL when not
  serial_number   TEXT        UNIQUE,

  -- Lifecycle status, defaults to Available on registration
  status          asset_status NOT NULL DEFAULT 'Available',

  -- Optional free-text physical condition description
  condition       TEXT        CHECK (condition IS NULL OR char_length(condition) <= 255),

  -- Optional free-text physical location description
  location        TEXT        CHECK (location IS NULL OR char_length(location) <= 255),

  -- Whether the asset participates in the booking/reservation system
  is_bookable     BOOLEAN     NOT NULL DEFAULT false,

  -- Creation timestamp, immutable after insert
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- =============================================================================
-- SECTION 4 — Table: allocations
-- Records every asset assignment (active and historical).
-- ON DELETE RESTRICT on all FKs preserves the audit trail.
-- Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 20.3, 20.4
-- =============================================================================
CREATE TABLE IF NOT EXISTS allocations (
  -- Primary key
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The asset being allocated; deletion blocked while allocations exist
  asset_id              UUID        NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,

  -- The employee receiving the asset; deletion blocked while allocations exist
  assigned_to           UUID        NOT NULL,
  CONSTRAINT allocations_assigned_to_fkey
    FOREIGN KEY (assigned_to) REFERENCES profiles(id) ON DELETE RESTRICT,

  -- The manager/admin who performed the allocation
  assigned_by           UUID        NOT NULL,
  CONSTRAINT allocations_assigned_by_fkey
    FOREIGN KEY (assigned_by) REFERENCES profiles(id) ON DELETE RESTRICT,

  -- Optional planned return date (date only, no time component)
  expected_return_date  DATE,

  -- NULL means the allocation is currently active.
  -- A non-NULL timestamp means the asset was returned at that time.
  returned_at           TIMESTAMPTZ,

  -- Optional description of asset condition upon return
  return_condition      TEXT,

  -- Creation timestamp, immutable after insert
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- =============================================================================
-- SECTION 5 — Table: transfer_requests
-- Tracks requests to reassign an allocated asset to a different user.
-- ON DELETE CASCADE: if the asset or either user is deleted the request is removed.
-- Requirements: 4.1, 4.2, 4.3, 4.4
-- =============================================================================
CREATE TABLE IF NOT EXISTS transfer_requests (
  -- Primary key
  id              UUID                     PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The asset targeted for transfer; cascades on asset deletion
  asset_id        UUID                     NOT NULL REFERENCES assets(id) ON DELETE CASCADE,

  -- The user requesting the transfer; cascades on user deletion
  requested_by    UUID                     NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- The user who currently holds the asset; cascades on user deletion
  current_holder  UUID                     NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- Business justification; must not be empty or whitespace-only, max 1000 chars
  reason          TEXT                     NOT NULL
                  CHECK (char_length(TRIM(reason)) > 0 AND char_length(reason) <= 1000),

  -- Approval workflow state, defaults to Pending on creation
  status          transfer_request_status  NOT NULL DEFAULT 'Pending',

  -- Creation timestamp, immutable after insert
  created_at      TIMESTAMPTZ              NOT NULL DEFAULT now()
);


-- =============================================================================
-- SECTION 6 — Partial Unique Index: only_one_active_allocation
-- The Conflict Rule: enforces at most one active allocation per asset at the
-- database level, making double-allocation mathematically impossible regardless
-- of application-layer behavior.
-- An active allocation is any row where returned_at IS NULL.
-- Historical allocations (returned_at IS NOT NULL) are not constrained by
-- this index, so an asset may have unlimited historical records.
-- Requirements: 5.1, 5.2, 5.3, 5.4, 20.2
-- =============================================================================
CREATE UNIQUE INDEX IF NOT EXISTS only_one_active_allocation
  ON allocations (asset_id)
  WHERE returned_at IS NULL;


-- =============================================================================
-- SECTION 7 — Helper Function: is_asset_manager()
-- Mirrors the existing is_admin() SECURITY DEFINER pattern.
-- Returns TRUE if the calling user has role 'Admin' OR 'Asset Manager'.
-- SECURITY DEFINER + SET search_path = public bypasses RLS when reading
-- profiles, preventing the infinite-recursion trap that would occur if RLS
-- policies used an inline subquery against profiles.
-- Requirements: 7.2, 7.3, 7.4
-- =============================================================================
CREATE OR REPLACE FUNCTION is_asset_manager()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role IN ('Admin', 'Asset Manager')
  );
$$;


-- =============================================================================
-- SECTION 8 — Trigger Function: sync_asset_status()
-- Automatically keeps assets.status in sync with the allocations table:
--   • AFTER INSERT with returned_at IS NULL  → asset becomes 'Allocated'
--   • AFTER UPDATE that sets returned_at to a non-NULL value → asset becomes 'Available'
-- Being an AFTER trigger in PostgreSQL, if this UPDATE fails the originating
-- INSERT/UPDATE on allocations is rolled back atomically (Req 6.5).
-- SECURITY DEFINER ensures the function can UPDATE assets even if the
-- triggering session does not have direct UPDATE permission on assets.
-- Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 18.2, 18.3
-- =============================================================================
CREATE OR REPLACE FUNCTION sync_asset_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- New allocation inserted and it is currently active (not pre-returned)
  IF TG_OP = 'INSERT' AND NEW.returned_at IS NULL THEN
    UPDATE public.assets
    SET status = 'Allocated'
    WHERE id = NEW.asset_id;

  -- Existing allocation just marked as returned
  ELSIF TG_OP = 'UPDATE'
    AND OLD.returned_at IS NULL
    AND NEW.returned_at IS NOT NULL
  THEN
    UPDATE public.assets
    SET status = 'Available'
    WHERE id = NEW.asset_id;
  END IF;

  RETURN NEW;
END;
$$;

-- Attach the trigger to the allocations table.
-- DROP + CREATE ensures idempotency on re-run.
DROP TRIGGER IF EXISTS on_allocation_change ON allocations;
CREATE TRIGGER on_allocation_change
  AFTER INSERT OR UPDATE ON allocations
  FOR EACH ROW EXECUTE FUNCTION sync_asset_status();


-- =============================================================================
-- SECTION 9 — Row Level Security: assets table
-- Requirements: 7.1, 7.2, 7.3, 7.4, 7.5
-- =============================================================================
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;

-- Drop existing policies before recreating (idempotency)
DROP POLICY IF EXISTS "assets_select_authenticated"  ON assets;
DROP POLICY IF EXISTS "assets_insert_asset_manager"  ON assets;
DROP POLICY IF EXISTS "assets_update_asset_manager"  ON assets;
DROP POLICY IF EXISTS "assets_delete_asset_manager"  ON assets;

-- Any authenticated user may read all assets (inventory visibility)
CREATE POLICY "assets_select_authenticated"
  ON assets FOR SELECT
  USING (auth.role() = 'authenticated');

-- Only Admin or Asset Manager may register new assets
CREATE POLICY "assets_insert_asset_manager"
  ON assets FOR INSERT
  WITH CHECK (is_asset_manager());

-- Only Admin or Asset Manager may update asset records
CREATE POLICY "assets_update_asset_manager"
  ON assets FOR UPDATE
  USING (is_asset_manager())
  WITH CHECK (is_asset_manager());

-- Only Admin or Asset Manager may delete assets
CREATE POLICY "assets_delete_asset_manager"
  ON assets FOR DELETE
  USING (is_asset_manager());


-- =============================================================================
-- SECTION 10 — Row Level Security: allocations table
-- Requirements: 8.1, 8.2, 8.3, 8.4, 8.5
-- =============================================================================
ALTER TABLE allocations ENABLE ROW LEVEL SECURITY;

-- Drop existing policies before recreating (idempotency)
DROP POLICY IF EXISTS "allocations_select_authenticated"        ON allocations;
DROP POLICY IF EXISTS "allocations_insert_privileged_roles"     ON allocations;
DROP POLICY IF EXISTS "allocations_update_privileged_roles"     ON allocations;
DROP POLICY IF EXISTS "allocations_delete_denied"               ON allocations;

-- Any authenticated user may read all allocation records
CREATE POLICY "allocations_select_authenticated"
  ON allocations FOR SELECT
  USING (auth.role() = 'authenticated');

-- Admin, Asset Manager, and Department Head may create allocations
-- (Department Head can allocate assets to their own team members)
CREATE POLICY "allocations_insert_privileged_roles"
  ON allocations FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('Admin', 'Asset Manager', 'Department Head')
    )
  );

-- Admin, Asset Manager, and Department Head may update allocation records
-- (used primarily to set returned_at when an asset is returned)
CREATE POLICY "allocations_update_privileged_roles"
  ON allocations FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('Admin', 'Asset Manager', 'Department Head')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('Admin', 'Asset Manager', 'Department Head')
    )
  );

-- DELETE is permanently denied for all users to preserve the audit trail
-- WITH CHECK (false) ensures even BYPASSRLS users cannot delete via this policy
CREATE POLICY "allocations_delete_denied"
  ON allocations FOR DELETE
  USING (false);


-- =============================================================================
-- SECTION 11 — Row Level Security: transfer_requests table
-- Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6
-- =============================================================================
ALTER TABLE transfer_requests ENABLE ROW LEVEL SECURITY;

-- Drop existing policies before recreating (idempotency)
DROP POLICY IF EXISTS "transfer_requests_select_authenticated"       ON transfer_requests;
DROP POLICY IF EXISTS "transfer_requests_insert_authenticated"       ON transfer_requests;
DROP POLICY IF EXISTS "transfer_requests_update_admin_asset_mgr"     ON transfer_requests;
DROP POLICY IF EXISTS "transfer_requests_update_dept_head_scoped"    ON transfer_requests;
DROP POLICY IF EXISTS "transfer_requests_delete_denied"              ON transfer_requests;

-- Any authenticated user may view all transfer requests
CREATE POLICY "transfer_requests_select_authenticated"
  ON transfer_requests FOR SELECT
  USING (auth.role() = 'authenticated');

-- Any authenticated user may create a transfer request for an allocated asset
-- (The frontend enforces additional business rules; the DB permits the base operation)
CREATE POLICY "transfer_requests_insert_authenticated"
  ON transfer_requests FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- Admin and Asset Manager may update any transfer request (approve / reject)
CREATE POLICY "transfer_requests_update_admin_asset_mgr"
  ON transfer_requests FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('Admin', 'Asset Manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('Admin', 'Asset Manager')
    )
  );

-- Department Head may update the status of transfer requests where the current
-- holder belongs to their department (scoped approval authority)
CREATE POLICY "transfer_requests_update_dept_head_scoped"
  ON transfer_requests FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles  AS dept_head      -- the caller
      JOIN public.profiles  AS holder         -- the current asset holder
        ON holder.id = transfer_requests.current_holder
      JOIN public.departments AS dept
        ON dept.id = holder.department_id
      WHERE dept_head.id   = auth.uid()
        AND dept_head.role = 'Department Head'
        AND dept.head_id   = auth.uid()       -- caller is head of holder's dept
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.profiles  AS dept_head
      JOIN public.profiles  AS holder
        ON holder.id = transfer_requests.current_holder
      JOIN public.departments AS dept
        ON dept.id = holder.department_id
      WHERE dept_head.id   = auth.uid()
        AND dept_head.role = 'Department Head'
        AND dept.head_id   = auth.uid()
    )
  );

-- DELETE is permanently denied on transfer_requests for all users
CREATE POLICY "transfer_requests_delete_denied"
  ON transfer_requests FOR DELETE
  USING (false);


-- =============================================================================
-- END OF MIGRATION
-- All Stage 2 schema additions applied successfully.
-- =============================================================================


-- =============================================================================
-- ROLLBACK STATEMENTS (commented — for manual disaster recovery only)
-- Execute these in order to undo everything added by this migration.
-- WARNING: Dropping tables destroys all data permanently. Only use these
--          statements in a controlled rollback scenario with a verified backup.
-- =============================================================================

/*

-- Step 1: Remove RLS policies (transfer_requests)
DROP POLICY IF EXISTS "transfer_requests_delete_denied"              ON transfer_requests;
DROP POLICY IF EXISTS "transfer_requests_update_dept_head_scoped"    ON transfer_requests;
DROP POLICY IF EXISTS "transfer_requests_update_admin_asset_mgr"     ON transfer_requests;
DROP POLICY IF EXISTS "transfer_requests_insert_authenticated"       ON transfer_requests;
DROP POLICY IF EXISTS "transfer_requests_select_authenticated"       ON transfer_requests;

-- Step 2: Remove RLS policies (allocations)
DROP POLICY IF EXISTS "allocations_delete_denied"               ON allocations;
DROP POLICY IF EXISTS "allocations_update_privileged_roles"     ON allocations;
DROP POLICY IF EXISTS "allocations_insert_privileged_roles"     ON allocations;
DROP POLICY IF EXISTS "allocations_select_authenticated"        ON allocations;

-- Step 3: Remove RLS policies (assets)
DROP POLICY IF EXISTS "assets_delete_asset_manager"  ON assets;
DROP POLICY IF EXISTS "assets_update_asset_manager"  ON assets;
DROP POLICY IF EXISTS "assets_insert_asset_manager"  ON assets;
DROP POLICY IF EXISTS "assets_select_authenticated"  ON assets;

-- Step 4: Drop trigger and trigger function
DROP TRIGGER  IF EXISTS on_allocation_change ON allocations;
DROP FUNCTION IF EXISTS sync_asset_status();

-- Step 5: Drop helper function
DROP FUNCTION IF EXISTS is_asset_manager();

-- Step 6: Drop tables (order matters — FKs go first)
DROP TABLE IF EXISTS transfer_requests;
DROP TABLE IF EXISTS allocations;
DROP TABLE IF EXISTS assets;

-- Step 7: Drop enums
DROP TYPE IF EXISTS transfer_request_status;
DROP TYPE IF EXISTS asset_status;

-- Step 8: Drop sequence
DROP SEQUENCE IF EXISTS asset_tag_seq;

*/
