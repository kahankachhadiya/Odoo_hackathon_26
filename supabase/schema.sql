-- =============================================================================
-- AssetFlow Stage 1 — Full Database Schema
-- Apply via: Supabase Dashboard → SQL Editor → paste → Run
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Enum types
-- ---------------------------------------------------------------------------
CREATE TYPE user_role AS ENUM ('Employee', 'Department Head', 'Asset Manager', 'Admin');
CREATE TYPE active_status AS ENUM ('Active', 'Inactive');

-- ---------------------------------------------------------------------------
-- Step 1: Create departments WITHOUT the head_id FK
-- (profiles doesn't exist yet; FK is added below after profiles is created)
-- ---------------------------------------------------------------------------
CREATE TABLE departments (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 TEXT NOT NULL UNIQUE CHECK (char_length(name) BETWEEN 1 AND 100),
  head_id              UUID,  -- FK constraint added below after profiles is created
  parent_department_id UUID REFERENCES departments(id) ON DELETE RESTRICT,
  status               active_status NOT NULL DEFAULT 'Active'
);

-- ---------------------------------------------------------------------------
-- Step 2: Create profiles (references departments, which now exists)
-- ---------------------------------------------------------------------------
CREATE TABLE profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name     TEXT CHECK (char_length(full_name) <= 255),
  email         TEXT NOT NULL CHECK (char_length(email) <= 254),
  role          user_role NOT NULL DEFAULT 'Employee',
  department_id UUID REFERENCES departments(id),
  status        active_status NOT NULL DEFAULT 'Active',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Step 3: Now that profiles exists, add the head_id FK to departments
-- ---------------------------------------------------------------------------
ALTER TABLE departments
  ADD CONSTRAINT departments_head_id_fkey
  FOREIGN KEY (head_id) REFERENCES profiles(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- Asset Categories (no circular dependency)
-- ---------------------------------------------------------------------------
CREATE TABLE asset_categories (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL UNIQUE CHECK (char_length(name) BETWEEN 1 AND 100),
  attributes JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- is_admin() — SECURITY DEFINER helper
-- Reads the caller's role bypassing RLS to prevent infinite recursion.
-- All RLS policies that need to check for Admin MUST use this function,
-- never an inline subquery against profiles.
-- Must be created BEFORE any RLS policy that calls it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'Admin'
  );
$$;

-- ---------------------------------------------------------------------------
-- Profile auto-creation trigger
-- Fires AFTER INSERT ON auth.users and creates the matching profiles row.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role, status)
  VALUES (
    NEW.id,
    NEW.email,
    NULLIF(TRIM((NEW.raw_user_meta_data->>'full_name')::TEXT), ''),
    'Employee',
    'Active'
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ---------------------------------------------------------------------------
-- RLS: profiles
-- ---------------------------------------------------------------------------
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read all profiles
CREATE POLICY "profiles_select_authenticated"
  ON profiles FOR SELECT
  USING (auth.role() = 'authenticated');

-- Direct INSERT is always denied — inserts only happen via the trigger
CREATE POLICY "profiles_insert_denied"
  ON profiles FOR INSERT
  WITH CHECK (false);

-- Any authenticated user can update their own full_name
CREATE POLICY "profiles_update_own_fullname"
  ON profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Admin can update any profile field (role, department_id, status, etc.)
-- Uses is_admin() to avoid the RLS infinite recursion trap
CREATE POLICY "profiles_update_admin_fields"
  ON profiles FOR UPDATE
  USING (is_admin())
  WITH CHECK (is_admin());

-- DELETE is always denied for all authenticated users
CREATE POLICY "profiles_delete_denied"
  ON profiles FOR DELETE
  USING (false);

-- ---------------------------------------------------------------------------
-- RLS: departments
-- ---------------------------------------------------------------------------
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read all departments
CREATE POLICY "departments_select_authenticated"
  ON departments FOR SELECT
  USING (auth.role() = 'authenticated');

-- Only Admins can insert departments
CREATE POLICY "departments_admin_insert"
  ON departments FOR INSERT
  WITH CHECK (is_admin());

-- Only Admins can update departments
CREATE POLICY "departments_admin_update"
  ON departments FOR UPDATE
  USING (is_admin());

-- Only Admins can delete departments
CREATE POLICY "departments_admin_delete"
  ON departments FOR DELETE
  USING (is_admin());

-- ---------------------------------------------------------------------------
-- RLS: asset_categories
-- ---------------------------------------------------------------------------
ALTER TABLE asset_categories ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read all asset categories
CREATE POLICY "asset_categories_select_authenticated"
  ON asset_categories FOR SELECT
  USING (auth.role() = 'authenticated');

-- Only Admins can insert asset categories
CREATE POLICY "asset_categories_admin_insert"
  ON asset_categories FOR INSERT
  WITH CHECK (is_admin());

-- Only Admins can update asset categories
CREATE POLICY "asset_categories_admin_update"
  ON asset_categories FOR UPDATE
  USING (is_admin());

-- Only Admins can delete asset categories
CREATE POLICY "asset_categories_admin_delete"
  ON asset_categories FOR DELETE
  USING (is_admin());


-- =============================================================================
-- AssetFlow Stage 2 — Asset Core & Allocation Engine
-- All objects below are additive — they extend Stage 1 without modifying it.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Sequence: asset_tag_seq
-- Drives human-readable asset tag auto-generation (AF-0001, AF-0002, …).
-- ---------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS asset_tag_seq
  START 1
  INCREMENT 1;

-- ---------------------------------------------------------------------------
-- Enum types (Stage 2)
-- ---------------------------------------------------------------------------
CREATE TYPE asset_status AS ENUM (
  'Available',
  'Allocated',
  'Reserved',
  'Under Maintenance',
  'Lost',
  'Retired',
  'Disposed'
);

CREATE TYPE transfer_request_status AS ENUM (
  'Pending',
  'Approved',
  'Rejected'
);

-- ---------------------------------------------------------------------------
-- Table: assets
-- Central inventory table. Tag is auto-generated from asset_tag_seq.
-- Deletion of a referenced asset_category is blocked (ON DELETE RESTRICT).
-- ---------------------------------------------------------------------------
CREATE TABLE assets (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tag             TEXT         NOT NULL UNIQUE
                               DEFAULT 'AF-' || LPAD(nextval('asset_tag_seq')::TEXT, 4, '0'),
  name            TEXT         NOT NULL CHECK (char_length(name) BETWEEN 1 AND 255),
  category_id     UUID         NOT NULL REFERENCES asset_categories(id) ON DELETE RESTRICT,
  serial_number   TEXT         UNIQUE,
  status          asset_status NOT NULL DEFAULT 'Available',
  condition       TEXT         CHECK (condition IS NULL OR char_length(condition) <= 255),
  location        TEXT         CHECK (location IS NULL OR char_length(location) <= 255),
  is_bookable     BOOLEAN      NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Table: allocations
-- Records every asset assignment — both active (returned_at IS NULL) and
-- historical (returned_at IS NOT NULL). ON DELETE RESTRICT on all FKs
-- preserves the full audit trail.
-- Foreign key constraints are explicitly named to support Supabase's
-- multi-FK join syntax (profiles!allocations_assigned_to_fkey).
-- ---------------------------------------------------------------------------
CREATE TABLE allocations (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id             UUID        NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  assigned_to          UUID        NOT NULL,
  assigned_by          UUID        NOT NULL,
  expected_return_date DATE,
  returned_at          TIMESTAMPTZ,  -- NULL = active allocation
  return_condition     TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  CONSTRAINT allocations_assigned_to_fkey
    FOREIGN KEY (assigned_to) REFERENCES profiles(id) ON DELETE RESTRICT,
  CONSTRAINT allocations_assigned_by_fkey
    FOREIGN KEY (assigned_by) REFERENCES profiles(id) ON DELETE RESTRICT
);

-- ---------------------------------------------------------------------------
-- Table: transfer_requests
-- Tracks requests to reassign an allocated asset. ON DELETE CASCADE on
-- asset_id, requested_by, and current_holder keeps referential integrity
-- when assets or users are removed.
-- ---------------------------------------------------------------------------
CREATE TABLE transfer_requests (
  id             UUID                    PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id       UUID                    NOT NULL REFERENCES assets(id)   ON DELETE CASCADE,
  requested_by   UUID                    NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  current_holder UUID                    NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reason         TEXT                    NOT NULL
                 CHECK (char_length(TRIM(reason)) > 0 AND char_length(reason) <= 1000),
  status         transfer_request_status NOT NULL DEFAULT 'Pending',
  created_at     TIMESTAMPTZ             NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Partial unique index — the Conflict Rule
-- Enforces at most one active allocation per asset at the database level.
-- Historical allocations (returned_at IS NOT NULL) are unconstrained.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX only_one_active_allocation
  ON allocations (asset_id)
  WHERE returned_at IS NULL;

-- ---------------------------------------------------------------------------
-- is_asset_manager() — SECURITY DEFINER helper
-- Mirrors is_admin(). Returns TRUE for role 'Admin' OR 'Asset Manager'.
-- Must be created BEFORE any RLS policy that calls it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION is_asset_manager()
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('Admin', 'Asset Manager')
  );
$$;

-- ---------------------------------------------------------------------------
-- sync_asset_status() — SECURITY DEFINER trigger function
-- Keeps assets.status in sync with the allocations table:
--   • INSERT with returned_at IS NULL     → status = 'Allocated'
--   • UPDATE setting returned_at non-NULL → status = 'Available'
-- Being an AFTER trigger, any failure rolls back the originating statement.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_asset_status()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.returned_at IS NULL THEN
    UPDATE public.assets SET status = 'Allocated' WHERE id = NEW.asset_id;
  ELSIF TG_OP = 'UPDATE' AND OLD.returned_at IS NULL AND NEW.returned_at IS NOT NULL THEN
    UPDATE public.assets SET status = 'Available' WHERE id = NEW.asset_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_allocation_change
  AFTER INSERT OR UPDATE ON allocations
  FOR EACH ROW EXECUTE FUNCTION sync_asset_status();

-- ---------------------------------------------------------------------------
-- RLS: assets
-- ---------------------------------------------------------------------------
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "assets_select_authenticated"
  ON assets FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "assets_insert_asset_manager"
  ON assets FOR INSERT
  WITH CHECK (is_asset_manager());

CREATE POLICY "assets_update_asset_manager"
  ON assets FOR UPDATE
  USING (is_asset_manager())
  WITH CHECK (is_asset_manager());

CREATE POLICY "assets_delete_asset_manager"
  ON assets FOR DELETE
  USING (is_asset_manager());

-- ---------------------------------------------------------------------------
-- RLS: allocations
-- ---------------------------------------------------------------------------
ALTER TABLE allocations ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read all allocation records
CREATE POLICY "allocations_select_authenticated"
  ON allocations FOR SELECT
  USING (auth.role() = 'authenticated');

-- Admin, Asset Manager, and Department Head can create allocations
CREATE POLICY "allocations_insert_privileged_roles"
  ON allocations FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('Admin', 'Asset Manager', 'Department Head')
    )
  );

-- Admin, Asset Manager, and Department Head can update allocation records
-- (primarily used to set returned_at when an asset is returned)
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

-- DELETE is permanently denied to preserve the audit trail
CREATE POLICY "allocations_delete_denied"
  ON allocations FOR DELETE
  USING (false);

-- ---------------------------------------------------------------------------
-- RLS: transfer_requests
-- ---------------------------------------------------------------------------
ALTER TABLE transfer_requests ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can view transfer requests
CREATE POLICY "transfer_requests_select_authenticated"
  ON transfer_requests FOR SELECT
  USING (auth.role() = 'authenticated');

-- Any authenticated user can submit a transfer request
CREATE POLICY "transfer_requests_insert_authenticated"
  ON transfer_requests FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- Admin and Asset Manager can approve/reject any transfer request
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

-- Department Head can approve/reject requests scoped to their department
-- (only where the current_holder belongs to the dept they lead)
CREATE POLICY "transfer_requests_update_dept_head_scoped"
  ON transfer_requests FOR UPDATE
  USING (
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
-- AssetFlow Stage 3 — Resource Booking & Maintenance Workflows
-- All objects below are additive — they extend Stages 1 & 2 without modifying them.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Enum types (Stage 3)
-- ---------------------------------------------------------------------------
CREATE TYPE booking_status AS ENUM (
  'Upcoming',
  'Ongoing',
  'Completed',
  'Cancelled'
);

CREATE TYPE maintenance_priority AS ENUM (
  'Low',
  'Medium',
  'High'
);

CREATE TYPE maintenance_status AS ENUM (
  'Pending',
  'Approved',
  'In Progress',
  'Resolved',
  'Rejected'
);

-- ---------------------------------------------------------------------------
-- Table: bookings
-- Records every time-slot reservation on a bookable asset.
-- ON DELETE CASCADE on both FKs: deleting an asset or profile automatically
-- removes all associated bookings (no audit-trail requirement per PRD).
-- ---------------------------------------------------------------------------
CREATE TABLE bookings (
  id         UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id   UUID           NOT NULL REFERENCES assets(id)   ON DELETE CASCADE,
  booked_by  UUID           NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title      TEXT           NOT NULL,
  start_time TIMESTAMPTZ    NOT NULL,
  end_time   TIMESTAMPTZ    NOT NULL,
  status     booking_status NOT NULL DEFAULT 'Upcoming',
  
  CONSTRAINT bookings_time_order CHECK (start_time < end_time)
);

-- ---------------------------------------------------------------------------
-- Table: maintenance_requests
-- Records repair / maintenance tickets raised against specific assets.
-- ON DELETE CASCADE on both FKs matches the bookings pattern.
-- ---------------------------------------------------------------------------
CREATE TABLE maintenance_requests (
  id                UUID                 PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id          UUID                 NOT NULL REFERENCES assets(id)   ON DELETE CASCADE,
  requested_by      UUID                 NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  issue_description TEXT                 NOT NULL,
  priority          maintenance_priority NOT NULL DEFAULT 'Medium',
  status            maintenance_status   NOT NULL DEFAULT 'Pending',
  technician_name   TEXT,
  created_at        TIMESTAMPTZ          NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- prevent_booking_overlap() — SECURITY DEFINER trigger function
-- BEFORE trigger on bookings — abort INSERT/UPDATE if any non-cancelled
-- booking on the same asset has an overlapping time interval.
-- Overlap condition (half-open interval check):
--   NEW.start_time < existing.end_time  AND  NEW.end_time > existing.start_time
-- The `id != NEW.id` guard prevents a row from conflicting with itself
-- on UPDATE (e.g., changing only the title leaves times unchanged).
-- Adjacent bookings (b1.end_time == b2.start_time) are PERMITTED because
-- the strict-inequality check means touching intervals are not overlapping.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION prevent_booking_overlap()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.bookings
    WHERE  asset_id       = NEW.asset_id
      AND  id            != NEW.id
      AND  status        != 'Cancelled'
      AND  NEW.start_time < end_time
      AND  NEW.end_time   > start_time
  ) THEN
    RAISE EXCEPTION 'Booking time slot overlaps with an existing reservation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_booking_overlap_check
  BEFORE INSERT OR UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION prevent_booking_overlap();

-- ---------------------------------------------------------------------------
-- sync_maintenance_status() — SECURITY DEFINER trigger function
-- AFTER trigger on maintenance_requests — keeps assets.status in sync
-- whenever a maintenance ticket transitions to a significant state.
-- Transition rules:
--   Approved  → assets.status = 'Under Maintenance'
--   Resolved  → assets.status = 'Available'
--   Rejected  → assets.status = 'Available' (only when asset is currently Under Maintenance)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_maintenance_status()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'Approved' AND OLD.status != 'Approved' THEN
    UPDATE public.assets SET status = 'Under Maintenance' WHERE id = NEW.asset_id;
  ELSIF NEW.status = 'Resolved' AND OLD.status != 'Resolved' THEN
    UPDATE public.assets SET status = 'Available' WHERE id = NEW.asset_id;
  ELSIF NEW.status = 'Rejected' THEN
    UPDATE public.assets
    SET status = 'Available'
    WHERE id = NEW.asset_id AND status = 'Under Maintenance';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_maintenance_status_change
  AFTER UPDATE ON maintenance_requests
  FOR EACH ROW EXECUTE FUNCTION sync_maintenance_status();

-- ---------------------------------------------------------------------------
-- RLS: bookings
-- ---------------------------------------------------------------------------
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bookings_select_authenticated"
  ON bookings FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "bookings_insert_bookable_asset"
  ON bookings FOR INSERT
  WITH CHECK (
    auth.role() = 'authenticated'
    AND EXISTS (
      SELECT 1 FROM public.assets
      WHERE id = bookings.asset_id AND is_bookable = true
    )
  );

CREATE POLICY "bookings_update_owner_or_admin"
  ON bookings FOR UPDATE
  USING (booked_by = auth.uid() OR is_admin())
  WITH CHECK (booked_by = auth.uid() OR is_admin());

CREATE POLICY "bookings_delete_denied"
  ON bookings FOR DELETE
  USING (false);

-- ---------------------------------------------------------------------------
-- RLS: maintenance_requests
-- ---------------------------------------------------------------------------
ALTER TABLE maintenance_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "maintenance_requests_select_authenticated"
  ON maintenance_requests FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "maintenance_requests_insert_authenticated"
  ON maintenance_requests FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "maintenance_requests_update_asset_manager"
  ON maintenance_requests FOR UPDATE
  USING (is_asset_manager())
  WITH CHECK (is_asset_manager());

CREATE POLICY "maintenance_requests_delete_denied"
  ON maintenance_requests FOR DELETE
  USING (false);


-- =============================================================================
-- AssetFlow Stage 4 — Dashboards & Telemetry
-- All objects below are additive — they extend Stages 1–3 without modifying them.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Enum type (Stage 4)
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Table: activity_logs
-- Append-only audit ledger written exclusively by SECURITY DEFINER triggers.
-- actor_id uses ON DELETE SET NULL so log rows survive profile deletion (Req 1.3).
-- reference_id carries no FK constraint — referenced rows may be deleted while
-- the log entry must be preserved (Req 1.1).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS activity_logs (
  id           UUID                    PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type   activity_log_event_type NOT NULL,
  message      TEXT                    NOT NULL
               CHECK (char_length(message) BETWEEN 1 AND 1000),
  actor_id     UUID                    REFERENCES profiles(id) ON DELETE SET NULL,
  reference_id UUID,
  created_at   TIMESTAMPTZ             NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- log_new_allocation() — SECURITY DEFINER trigger function
-- AFTER INSERT on allocations FOR EACH ROW.
-- Looks up asset tag and both profile full_names with 'Unknown' fallback.
-- Entire body wrapped in EXCEPTION WHEN OTHERS THEN NULL so the core
-- allocation INSERT is never blocked by a telemetry failure (Req 2.4).
-- ---------------------------------------------------------------------------
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

DROP TRIGGER IF EXISTS on_allocation_logged ON allocations;
CREATE TRIGGER on_allocation_logged
  AFTER INSERT ON allocations
  FOR EACH ROW EXECUTE FUNCTION log_new_allocation();

-- ---------------------------------------------------------------------------
-- log_maintenance_update() — SECURITY DEFINER trigger function
-- AFTER UPDATE on maintenance_requests FOR EACH ROW.
-- Only fires when status transitions to 'Approved' or 'Resolved' from a
-- different prior status — OLD.status guard prevents duplicate log entries
-- on idempotent re-updates (Reqs 3.2, 3.3, 3.4).
-- ---------------------------------------------------------------------------
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

DROP TRIGGER IF EXISTS on_maintenance_logged ON maintenance_requests;
CREATE TRIGGER on_maintenance_logged
  AFTER UPDATE ON maintenance_requests
  FOR EACH ROW EXECUTE FUNCTION log_maintenance_update();

-- ---------------------------------------------------------------------------
-- log_booking_created() — SECURITY DEFINER trigger function
-- AFTER INSERT on bookings FOR EACH ROW.
-- Message uses NEW.title and NEW.start_time::DATE for a human-readable entry.
-- Wrapped in EXCEPTION WHEN OTHERS THEN NULL — core booking INSERT must never
-- be blocked by a telemetry failure (Req 4.3).
-- ---------------------------------------------------------------------------
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

DROP TRIGGER IF EXISTS on_booking_logged ON bookings;
CREATE TRIGGER on_booking_logged
  AFTER INSERT ON bookings
  FOR EACH ROW EXECUTE FUNCTION log_booking_created();

-- ---------------------------------------------------------------------------
-- RLS: activity_logs
-- Four-tier visibility model enforced entirely at the DB level.
-- SECURITY DEFINER trigger functions bypass RLS and are the sole write path.
-- ---------------------------------------------------------------------------
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "activity_logs_select_admin_asset_manager" ON activity_logs;
DROP POLICY IF EXISTS "activity_logs_select_dept_head"           ON activity_logs;
DROP POLICY IF EXISTS "activity_logs_select_employee"            ON activity_logs;
DROP POLICY IF EXISTS "activity_logs_insert_denied"              ON activity_logs;
DROP POLICY IF EXISTS "activity_logs_update_denied"              ON activity_logs;
DROP POLICY IF EXISTS "activity_logs_delete_denied"              ON activity_logs;

-- Tier 1: Admin / Asset Manager — see all rows
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
-- actor_id IS NOT NULL guard ensures NULL-actor rows are never exposed
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
CREATE POLICY "activity_logs_select_employee"
  ON activity_logs FOR SELECT
  USING (
    auth.role() = 'authenticated'
    AND activity_logs.actor_id = auth.uid()
  );

-- INSERT denied — SECURITY DEFINER triggers are the sole insert path
CREATE POLICY "activity_logs_insert_denied"
  ON activity_logs FOR INSERT
  WITH CHECK (false);

-- UPDATE denied — append-only ledger
CREATE POLICY "activity_logs_update_denied"
  ON activity_logs FOR UPDATE
  USING (false);

-- DELETE denied — append-only ledger
CREATE POLICY "activity_logs_delete_denied"
  ON activity_logs FOR DELETE
  USING (false);
