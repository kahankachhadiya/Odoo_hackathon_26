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
  created_at: string
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

// ─── Stage 3 Enum Types ────────────────────────────────────────────────────

export type BookingStatus = 'Upcoming' | 'Ongoing' | 'Completed' | 'Cancelled'
export type MaintenancePriority = 'Low' | 'Medium' | 'High'
export type MaintenanceStatus = 'Pending' | 'Approved' | 'In Progress' | 'Resolved' | 'Rejected'

// ─── Stage 3 Domain Types ──────────────────────────────────────────────────

export interface Booking {
  id: string
  asset_id: string
  booked_by: string
  title: string
  start_time: string      // ISO 8601 timestamptz
  end_time: string        // ISO 8601 timestamptz
  status: BookingStatus
}

export interface BookingWithAsset extends Booking {
  asset_name: string
  asset_tag: string
}

export interface MaintenanceRequest {
  id: string
  asset_id: string
  requested_by: string
  issue_description: string
  priority: MaintenancePriority
  status: MaintenanceStatus
  technician_name: string | null
  created_at: string
}

export interface MaintenanceRequestWithDetails extends MaintenanceRequest {
  asset_tag: string
  requested_by_name: string | null
}

// ─── Stage 3 Service Input Types ──────────────────────────────────────────

export interface CreateBookingInput {
  asset_id: string
  title: string
  start_time: string
  end_time: string
}

export interface CreateMaintenanceRequestInput {
  asset_id: string
  issue_description: string
  priority: MaintenancePriority
}

// ─── Stage 3 Error Types ──────────────────────────────────────────────────

export class BookingOverlapError extends Error {
  constructor(message = 'This time slot is already booked.') {
    super(message)
    this.name = 'BookingOverlapError'
  }
}
