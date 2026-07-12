// Maintenance service for AssetFlow Stage 3.
// Provides maintenance request listing, creation, and status update operations.
// Requirements: 17.1, 17.2, 17.3

import { supabase } from '../lib/supabaseClient'
import type {
  MaintenanceRequest,
  MaintenanceRequestWithDetails,
  CreateMaintenanceRequestInput,
  MaintenanceStatus,
} from '../types/index'

// ─── listMaintenanceRequests ──────────────────────────────────────────────────

/**
 * Fetches all maintenance requests that are not Rejected.
 * Joins assets to get asset_tag and profiles to get requested_by_name.
 * Requirements: 17.1
 */
export async function listMaintenanceRequests(): Promise<MaintenanceRequestWithDetails[]> {
  const { data, error } = await supabase
    .from('maintenance_requests')
    .select(`
      *,
      assets ( tag ),
      profiles!maintenance_requests_requested_by_fkey ( full_name )
    `)
    .neq('status', 'Rejected')
    .order('created_at', { ascending: false })

  if (error) {
    throw error
  }

  const requests: MaintenanceRequestWithDetails[] = (data ?? []).map((row) => ({
    id: row.id,
    asset_id: row.asset_id,
    requested_by: row.requested_by,
    issue_description: row.issue_description,
    priority: row.priority,
    status: row.status,
    technician_name: row.technician_name,
    created_at: row.created_at,
    asset_tag: (row.assets as { tag: string }).tag,
    requested_by_name: (row.profiles as { full_name: string | null }).full_name,
  }))

  return requests
}

// ─── createMaintenanceRequest ─────────────────────────────────────────────────

/**
 * Creates a new maintenance request for an asset.
 * The requested_by field is automatically set to auth.uid() via RLS context.
 * The status defaults to 'Pending' in the database.
 * Requirements: 17.2
 */
export async function createMaintenanceRequest(
  input: CreateMaintenanceRequestInput
): Promise<MaintenanceRequest> {
  const { data: { user } } = await supabase.auth.getUser()

  const { data, error } = await supabase
    .from('maintenance_requests')
    .insert({
      asset_id: input.asset_id,
      issue_description: input.issue_description,
      priority: input.priority,
      requested_by: user?.id ?? '',
      // status defaults to 'Pending' in DB
    })
    .select()
    .single()

  if (error) {
    throw error
  }

  const row = data
  const request: MaintenanceRequest = {
    id: row.id,
    asset_id: row.asset_id,
    requested_by: row.requested_by,
    issue_description: row.issue_description,
    priority: row.priority,
    status: row.status,
    technician_name: row.technician_name,
    created_at: row.created_at,
  }

  return request
}

// ─── updateMaintenanceStatus ──────────────────────────────────────────────────

/**
 * Updates the status of a maintenance request.
 * Optionally updates the technician_name if provided.
 * Requirements: 17.3
 */
export async function updateMaintenanceStatus(
  id: string,
  status: MaintenanceStatus,
  technicianName?: string
): Promise<void> {
  const updateData: { status: MaintenanceStatus; technician_name?: string } = {
    status,
  }

  if (technicianName !== undefined) {
    updateData.technician_name = technicianName
  }

  const { error } = await supabase
    .from('maintenance_requests')
    .update(updateData)
    .eq('id', id)

  if (error) {
    throw error
  }
}
