// Shared TypeScript types for the AssetFlow application.
// These are derived from the database schema (supabase/schema.sql) and
// mirror the Database['public']['Enums'] / Tables types in src/lib/database.types.ts.

// ─── Enum Types ──────────────────────────────────────────────────────────────

export type UserRole = 'Employee' | 'Department Head' | 'Asset Manager' | 'Admin'

export type ActiveStatus = 'Active' | 'Inactive'

// ─── Domain Types ─────────────────────────────────────────────────────────────

export interface Profile {
  id: string              // UUID — matches auth.users.id
  full_name: string | null
  email: string
  role: UserRole
  department_id: string | null   // UUID FK → departments.id
  status: ActiveStatus
  created_at: string             // ISO 8601 timestamp
}

export interface Department {
  id: string                        // UUID
  name: string
  head_id: string | null            // UUID FK → profiles.id
  parent_department_id: string | null  // UUID FK → departments.id (self-ref)
  status: ActiveStatus
}

export interface AssetCategory {
  id: string                               // UUID
  name: string
  attributes: Record<string, unknown> | null  // JSONB
  created_at: string                       // ISO 8601 timestamp
}
