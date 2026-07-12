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
 * Uses UTC day boundaries with .gte() and .lt() for accurate date filtering.
 * Requirements: 16.2
 */
export async function getTodaysBookings(assetId: string): Promise<Booking[]> {
  // Use local calendar day boundaries, not UTC, so "today" matches the user's clock.
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

// ─── createBooking ────────────────────────────────────────────────────────────

/**
 * Creates a new booking for an asset.
 * The booked_by field is automatically set to auth.uid() via RLS context.
 * On overlap conflict (trigger raises exception with specific message),
 * re-throws BookingOverlapError.
 * Requirements: 16.3
 */
export async function createBooking(input: CreateBookingInput): Promise<Booking> {
  const { data: { user } } = await supabase.auth.getUser()

  const { data, error } = await supabase
    .from('bookings')
    .insert({
      asset_id: input.asset_id,
      title: input.title,
      start_time: input.start_time,
      end_time: input.end_time,
      booked_by: user?.id,
    })
    .select()
    .single()

  if (error) {
    // Check if the error message contains the overlap text from the trigger
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
