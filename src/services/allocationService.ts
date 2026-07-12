// Allocation service for AssetFlow Stage 2.
// Handles asset allocations, returns, and transfer requests.
// Requirements: 13, 14, 15, 16

import { supabase } from '../lib/supabaseClient'
import type {
  Allocation,
  AllocationWithProfiles,
  TransferRequest,
  CreateAllocationInput,
  CreateTransferRequestInput,
} from '../types/index'
import { AllocationConflictError } from '../types/index'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Raw row shape returned by the double-join select on allocations.
 * Supabase nests the joined profile rows under the alias keys.
 */
interface AllocationJoinRow {
  id: string
  asset_id: string
  assigned_to: string
  assigned_by: string
  expected_return_date: string | null
  returned_at: string | null
  return_condition: string | null
  created_at: string
  assigned_to_profile: { full_name: string | null } | null
  assigned_by_profile: { full_name: string | null } | null
}

/** Flattens the nested profile objects into AllocationWithProfiles. */
function mapRowToAllocationWithProfiles(row: AllocationJoinRow): AllocationWithProfiles {
  return {
    id: row.id,
    asset_id: row.asset_id,
    assigned_to: row.assigned_to,
    assigned_by: row.assigned_by,
    expected_return_date: row.expected_return_date,
    returned_at: row.returned_at,
    return_condition: row.return_condition,
    created_at: row.created_at,
    assigned_to_name: row.assigned_to_profile?.full_name ?? null,
    assigned_by_name: row.assigned_by_profile?.full_name ?? null,
  }
}

/** The Supabase select string used for all double-profile joins. */
const ALLOCATION_WITH_PROFILES_SELECT = `
  *,
  assigned_to_profile:profiles!assigned_to(full_name),
  assigned_by_profile:profiles!assigned_by(full_name)
` as const

// ─── getAllocationsForAsset ───────────────────────────────────────────────────

/**
 * Returns all allocation history for an asset, newest first.
 * Each row includes the full_name of both the assigned_to and assigned_by profiles.
 */
export async function getAllocationsForAsset(assetId: string): Promise<AllocationWithProfiles[]> {
  const { data, error } = await supabase
    .from('allocations')
    .select(ALLOCATION_WITH_PROFILES_SELECT)
    .eq('asset_id', assetId)
    .order('created_at', { ascending: false })
    .returns<AllocationJoinRow[]>()

  if (error) throw new Error(error.message)

  return (data ?? []).map(mapRowToAllocationWithProfiles)
}

// ─── getActiveAllocation ──────────────────────────────────────────────────────

/**
 * Returns the current active allocation for an asset (returned_at IS NULL),
 * or null if the asset is not currently allocated.
 */
export async function getActiveAllocation(assetId: string): Promise<AllocationWithProfiles | null> {
  const { data, error } = await supabase
    .from('allocations')
    .select(ALLOCATION_WITH_PROFILES_SELECT)
    .eq('asset_id', assetId)
    .is('returned_at', null)
    .returns<AllocationJoinRow[]>()
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) return null

  return mapRowToAllocationWithProfiles(data)
}

// ─── createAllocation ─────────────────────────────────────────────────────────

/**
 * Inserts a new allocation row. The returned_at column is left NULL (DB default).
 * Throws AllocationConflictError if a unique constraint violation (23505) occurs,
 * which signals that the asset is already actively allocated.
 */
export async function createAllocation(input: CreateAllocationInput): Promise<Allocation> {
  const { data, error } = await supabase
    .from('allocations')
    .insert({
      asset_id: input.asset_id,
      assigned_to: input.assigned_to,
      assigned_by: input.assigned_by,
      expected_return_date: input.expected_return_date ?? null,
      // returned_at intentionally omitted — defaults to NULL in the DB
    })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      throw new AllocationConflictError()
    }
    throw new Error(error.message)
  }

  const row = data
  const allocation: Allocation = {
    id: row.id,
    asset_id: row.asset_id,
    assigned_to: row.assigned_to,
    assigned_by: row.assigned_by,
    expected_return_date: row.expected_return_date,
    returned_at: row.returned_at,
    return_condition: row.return_condition,
    created_at: row.created_at,
  }

  return allocation
}

// ─── returnAllocation ─────────────────────────────────────────────────────────

/**
 * Marks an allocation as returned by setting returned_at to the current timestamp.
 */
export async function returnAllocation(allocationId: string): Promise<void> {
  const { error } = await supabase
    .from('allocations')
    .update({ returned_at: new Date().toISOString() })
    .eq('id', allocationId)

  if (error) throw new Error(error.message)
}

// ─── createTransferRequest ────────────────────────────────────────────────────

/**
 * Inserts a new transfer request row.
 * Status defaults to 'Pending' via the DB default.
 */
export async function createTransferRequest(
  input: CreateTransferRequestInput,
): Promise<TransferRequest> {
  const { data, error } = await supabase
    .from('transfer_requests')
    .insert({
      asset_id: input.asset_id,
      requested_by: input.requested_by,
      current_holder: input.current_holder,
      reason: input.reason,
      // status defaults to 'Pending' in the DB
    })
    .select()
    .single()

  if (error) throw new Error(error.message)

  const row = data
  const transferRequest: TransferRequest = {
    id: row.id,
    asset_id: row.asset_id,
    requested_by: row.requested_by,
    current_holder: row.current_holder,
    reason: row.reason,
    status: row.status,
    created_at: row.created_at,
  }

  return transferRequest
}

// ─── getPendingTransferForAsset ───────────────────────────────────────────────

/**
 * Returns the pending transfer request for a given asset and requester,
 * or null if none exists.
 */
export async function getPendingTransferForAsset(
  assetId: string,
  requestedBy: string,
): Promise<TransferRequest | null> {
  const { data, error } = await supabase
    .from('transfer_requests')
    .select('*')
    .eq('asset_id', assetId)
    .eq('requested_by', requestedBy)
    .eq('status', 'Pending')
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) return null

  const transferRequest: TransferRequest = {
    id: data.id,
    asset_id: data.asset_id,
    requested_by: data.requested_by,
    current_holder: data.current_holder,
    reason: data.reason,
    status: data.status,
    created_at: data.created_at,
  }

  return transferRequest
}

// ─── approveTransferRequest ───────────────────────────────────────────────────

/**
 * Approves a transfer request atomically across three sequential Supabase operations:
 *  1. Fetch the transfer request to get asset_id
 *  2. Find the current active allocation (returned_at IS NULL)
 *  3. Close the current allocation (set returned_at = now)
 *  4. Create a new allocation for newHolderId
 *  5. Mark the transfer request as 'Approved'
 *
 * Supabase does not expose client-side transactions, so failures after step 3
 * will throw and leave the caller responsible for retry / alerting.
 */
export async function approveTransferRequest(
  transferRequestId: string,
  newHolderId: string,
): Promise<void> {
  // Step 1: Fetch the transfer request
  const { data: transferRequest, error: trError } = await supabase
    .from('transfer_requests')
    .select('*')
    .eq('id', transferRequestId)
    .single()

  if (trError) throw new Error(trError.message)
  if (!transferRequest) throw new Error('Transfer request not found.')

  const assetId = transferRequest.asset_id

  // Step 2: Find the current active allocation
  const { data: activeAllocation, error: allocError } = await supabase
    .from('allocations')
    .select('*')
    .eq('asset_id', assetId)
    .is('returned_at', null)
    .maybeSingle()

  if (allocError) throw new Error(allocError.message)
  if (!activeAllocation) throw new Error('No active allocation found for this asset.')

  // Step 3: Close the current allocation
  const { error: returnError } = await supabase
    .from('allocations')
    .update({ returned_at: new Date().toISOString() })
    .eq('id', activeAllocation.id)

  if (returnError) throw new Error(returnError.message)

  // Step 4: Get the current authenticated user to record as assigned_by
  const { data: { user }, error: userError } = await supabase.auth.getUser()

  if (userError) throw new Error(userError.message)
  if (!user) throw new Error('No authenticated user found.')

  const { error: newAllocError } = await supabase
    .from('allocations')
    .insert({
      asset_id: assetId,
      assigned_to: newHolderId,
      assigned_by: user.id,
    })

  if (newAllocError) throw new Error(newAllocError.message)

  // Step 5: Mark the transfer request as Approved
  const { error: approveError } = await supabase
    .from('transfer_requests')
    .update({ status: 'Approved' })
    .eq('id', transferRequestId)

  if (approveError) throw new Error(approveError.message)
}

// ─── rejectTransferRequest ────────────────────────────────────────────────────

/**
 * Marks a transfer request as 'Rejected'.
 */
export async function rejectTransferRequest(transferRequestId: string): Promise<void> {
  const { error } = await supabase
    .from('transfer_requests')
    .update({ status: 'Rejected' })
    .eq('id', transferRequestId)

  if (error) throw new Error(error.message)
}
