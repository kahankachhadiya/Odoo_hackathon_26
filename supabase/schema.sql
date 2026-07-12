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
