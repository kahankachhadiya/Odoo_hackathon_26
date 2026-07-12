// Booking service for AssetFlow Stage 3.
// Provides booking listing, retrieval, creation, and cancellation operations.
// Requirements: 16.1, 16.2, 16.3, 16.4

import { supabase } from '../lib/supabaseClient'
import type { Asset, Booking, CreateBookingInput } from '../types/index'
import { BookingOverlapError } from '../types/index'

// ─── listBookableAssets ───────────────────────────────────────────────────────

/**
 * Fetches all assets that can be booked (is_bookable = true).
 * Requirements: 16.1
 */
export async function listBookableAssets(): Promise<Asset[]> {
  const { data, error } = await supabase
    .from('assets')
    .select('*')
    .eq('is_bookable', true)
    .order('name', { ascending: true })

  if (error) {
    throw error
  }

  const assets: Asset[] = (data ?? []).map((row) => ({
    id: row.id,
    tag: row.tag,
    name: row.name,
    category_id: row.category_id,
    serial_number: row.serial_number,
    status: row.status,
    condition: row.condition,
    location: row.location,
    is_bookable: row.is_bookable,
    created_at: row.created_at,
  }))

  return assets
}

// ─── getTodaysBookings ────────────────────────────────────────────────────────

/**
 * Fetches all bookings for a specific asset that start today.
 * Uses local calendar day boundaries so "today" matches the user's clock.
 * Requirements: 16.2
 */
export async function getTodaysBookings(assetId: string): Promise<Booking[]> {
  const now = new Date()
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
  const endOfDay   = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0)

  const { data, error } = await supabase
    .from('bookings')
    .select('*')
    .eq('asset_id', assetId)
    .gte('start_time', startOfDay.toISOString())
    .lt('start_time', endOfDay.toISOString())
    .order('start_time', { ascending: true })

  if (error) {
    throw error
  }

  const bookings: Booking[] = (data ?? []).map((row) => ({
    id: row.id,
    asset_id: row.asset_id,
    booked_by: row.booked_by,
    title: row.title,
    start_time: row.start_time,
    end_time: row.end_time,
    status: row.status,
  }))

  return bookings
}

// ─── getActiveBookingForAsset ─────────────────────────────────────────────────

/**
 * Returns the currently active (Ongoing) or next upcoming booking for an asset,
 * or null if none exists.
 * Used to block allocation when a booking is in effect.
 */
export async function getActiveBookingForAsset(assetId: string): Promise<Booking | null> {
  const now = new Date().toISOString()

  const { data, error } = await supabase
    .from('bookings')
    .select('*')
    .eq('asset_id', assetId)
    .in('status', ['Upcoming', 'Ongoing'])
    .gte('end_time', now)          // booking hasn't ended yet
    .order('start_time', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  return {
    id: data.id,
    asset_id: data.asset_id,
    booked_by: data.booked_by,
    title: data.title,
    start_time: data.start_time,
    end_time: data.end_time,
    status: data.status,
  }
}

// ─── syncBookingStatuses ──────────────────────────────────────────────────────

/**
 * Syncs booking statuses based on current time:
 *   - Upcoming → Ongoing  when now >= start_time
 *   - Ongoing  → Completed when now >= end_time  (also reverts asset to Available)
 *
 * Also updates asset.status:
 *   - 'Reserved'  when a booking is Ongoing
 *   - 'Available' when the last Ongoing booking completes
 *
 * Called on page load for the selected asset.
 */
export async function syncBookingStatuses(assetId: string): Promise<void> {
  const now = new Date().toISOString()

  // Transition Upcoming → Ongoing (start_time has passed, end_time hasn't)
  await supabase
    .from('bookings')
    .update({ status: 'Ongoing' })
    .eq('asset_id', assetId)
    .eq('status', 'Upcoming')
    .lte('start_time', now)
    .gte('end_time', now)

  // Transition Ongoing → Completed (end_time has passed)
  await supabase
    .from('bookings')
    .update({ status: 'Completed' })
    .eq('asset_id', assetId)
    .eq('status', 'Ongoing')
    .lt('end_time', now)

  // Check if there's still an active booking after syncing
  const { data: activeBooking } = await supabase
    .from('bookings')
    .select('id')
    .eq('asset_id', assetId)
    .eq('status', 'Ongoing')
    .limit(1)
    .maybeSingle()

  // Update asset status to reflect current booking state
  if (activeBooking) {
    // A booking is in progress — mark asset as Reserved
    await supabase
      .from('assets')
      .update({ status: 'Reserved' })
      .eq('id', assetId)
      .in('status', ['Available', 'Reserved'])   // only update if not Allocated/Maintenance
  } else {
    // No active booking — revert Reserved back to Available
    await supabase
      .from('assets')
      .update({ status: 'Available' })
      .eq('id', assetId)
      .eq('status', 'Reserved')                  // only revert if it was set Reserved by a booking
  }
}

// ─── createBooking ────────────────────────────────────────────────────────────

/**
 * Creates a new booking for an asset.
 * Checks that the asset is not currently Allocated before inserting.
 * On overlap conflict (trigger raises exception), re-throws BookingOverlapError.
 * Requirements: 16.3
 */
export async function createBooking(input: CreateBookingInput): Promise<Booking> {
  // Check asset is not Allocated — allocated assets cannot be booked
  const { data: asset } = await supabase
    .from('assets')
    .select('status')
    .eq('id', input.asset_id)
    .single()

  if (asset?.status === 'Allocated') {
    throw new BookingOverlapError('This asset is currently allocated and cannot be booked.')
  }

  const { data: { user } } = await supabase.auth.getUser()

  const { data, error } = await supabase
    .from('bookings')
    .insert({
      asset_id: input.asset_id,
      title: input.title,
      start_time: input.start_time,
      end_time: input.end_time,
      booked_by: user?.id ?? '',
    })
    .select()
    .single()

  if (error) {
    if (
      error.message &&
      error.message.includes('Booking time slot overlaps with an existing reservation')
    ) {
      throw new BookingOverlapError()
    }
    throw error
  }

  const row = data
  const booking: Booking = {
    id: row.id,
    asset_id: row.asset_id,
    booked_by: row.booked_by,
    title: row.title,
    start_time: row.start_time,
    end_time: row.end_time,
    status: row.status,
  }

  return booking
}

// ─── cancelBooking ────────────────────────────────────────────────────────────

/**
 * Cancels an existing booking by setting its status to 'Cancelled'.
 * RLS policy ensures only the booking creator or an Admin can perform this update.
 * Requirements: 16.4
 */
export async function cancelBooking(bookingId: string): Promise<void> {
  const { error } = await supabase
    .from('bookings')
    .update({ status: 'Cancelled' })
    .eq('id', bookingId)

  if (error) {
    throw error
  }
}
