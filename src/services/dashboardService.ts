// Dashboard service for AssetFlow Stage 4.
// Provides KPI counts and overdue allocation count for the Dashboard page.
// Requirements: 9.2, 9.3, 9.4, 9.5, 9.6, 10.1, 10.4

import { supabase } from '../lib/supabaseClient'
import type { DashboardKPIs } from '../types'

// ─── getDashboardKPIs ─────────────────────────────────────────────────────────

/**
 * Runs four count queries concurrently via Promise.all.
 * Each query uses { count: 'exact', head: true } so no rows are fetched.
 *
 * Individual query errors propagate as rejected promises — the caller
 * (Dashboard page) handles per-card failure isolation via Promise.allSettled
 * or per-card try/catch wrappers.
 */
export async function getDashboardKPIs(): Promise<DashboardKPIs> {
  // Query 3 time boundaries — computed at call time in UTC
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const todayISO = today.toISOString()

  const tomorrow = new Date(today)
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
  const tomorrowISO = tomorrow.toISOString()

  const [
    availableResult,
    allocatedResult,
    bookingsTodayResult,
    pendingMaintenanceResult,
  ] = await Promise.all([
    // Query 1: Available assets
    supabase
      .from('assets')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'Available'),

    // Query 2: Allocated assets
    supabase
      .from('assets')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'Allocated'),

    // Query 3: Active bookings today (Upcoming or Ongoing, starting today UTC)
    supabase
      .from('bookings')
      .select('*', { count: 'exact', head: true })
      .in('status', ['Upcoming', 'Ongoing'])
      .gte('start_time', todayISO)
      .lt('start_time', tomorrowISO),

    // Query 4: Pending maintenance requests
    supabase
      .from('maintenance_requests')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'Pending'),
  ])

  // Propagate errors as rejections — the Dashboard page handles isolation
  if (availableResult.error) throw new Error(availableResult.error.message)
  if (allocatedResult.error) throw new Error(allocatedResult.error.message)
  if (bookingsTodayResult.error) throw new Error(bookingsTodayResult.error.message)
  if (pendingMaintenanceResult.error) throw new Error(pendingMaintenanceResult.error.message)

  return {
    totalAvailableAssets: availableResult.count ?? 0,
    totalAllocatedAssets: allocatedResult.count ?? 0,
    activeBookingsToday: bookingsTodayResult.count ?? 0,
    pendingMaintenance: pendingMaintenanceResult.count ?? 0,
  }
}

// ─── getOverdueCount ──────────────────────────────────────────────────────────

/**
 * Returns the number of allocations that are overdue (not yet returned and
 * past their expected return date).
 *
 * Silently returns 0 on any error — the overdue banner must not appear when
 * this query fails (Req 10.4).
 */
export async function getOverdueCount(): Promise<number> {
  try {
    const today = new Date().toISOString().split('T')[0]

    const { count, error } = await supabase
      .from('allocations')
      .select('*', { count: 'exact', head: true })
      .is('returned_at', null)
      .lt('expected_return_date', today)

    if (error) return 0

    return count ?? 0
  } catch {
    return 0
  }
}
