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

// ─── Stage 2 Enum Types ───────────────────────────────────────────────────────

export type AssetStatus =
  | 'Available'
  | 'Allocated'
  | 'Reserved'
  | 'Under Maintenance'
  | 'Lost'
  | 'Retired'
  | 'Disposed'

export type TransferRequestStatus = 'Pending' | 'Approved' | 'Rejected'

// ─── Stage 2 Domain Types ─────────────────────────────────────────────────────

export interface Asset {
  id: string
  tag: string
  name: string
  category_id: string
  serial_number: string | null
  status: AssetStatus
  condition: string | null
  location: string | null
  is_bookable: boolean
  created_at: string
}

export interface AssetWithCategory extends Asset {
  category_name: string
}

export interface Allocation {
  id: string
  asset_id: string
  assigned_to: string
  assigned_by: string
  expected_return_date: string | null
  returned_at: string | null
  return_condition: string | null
}

export interface AllocationWithProfiles extends Allocation {
  assigned_to_name: string | null
  assigned_by_name: string | null
}

export interface TransferRequest {
  id: string
  asset_id: string
  requested_by: string
  current_holder: string
  reason: string
  status: TransferRequestStatus
  created_at: string
}

// ─── Stage 2 Service Input Types ─────────────────────────────────────────────

export interface CreateAssetInput {
  name: string
  category_id: string
  serial_number?: string | null
  condition?: string | null
  location?: string | null
}

export interface CreateAllocationInput {
  asset_id: string
  assigned_to: string
  assigned_by: string
  expected_return_date?: string | null
}

export interface CreateTransferRequestInput {
  asset_id: string
  requested_by: string
  current_holder: string
  reason: string
}

// ─── Stage 2 Service Error Types ─────────────────────────────────────────────

export class AllocationConflictError extends Error {
  constructor(message = 'Asset is already allocated. Please refresh and try again.') {
    super(message)
    this.name = 'AllocationConflictError'
  }
}

export class DuplicateSerialError extends Error {
  constructor(message = 'Serial number already exists.') {
    super(message)
    this.name = 'DuplicateSerialError'
  }
}
