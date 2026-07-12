// Activity log service for AssetFlow Stage 4.
// Provides activity log retrieval with filtering and pagination.

import { supabase } from '../lib/supabaseClient'
import type { ActivityLog, GetActivityLogsOptions } from '../types'

// ─── getRecentActivity ────────────────────────────────────────────────────────

/**
 * Returns the most recent activity log entries, newest first.
 * @param limit - Maximum number of records to return.
 */
export async function getRecentActivity(limit: number): Promise<ActivityLog[]> {
  const { data, error } = await supabase
    .from('activity_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw new Error(error.message)

  return (data ?? []).map((row) => ({
    id: row.id,
    event_type: row.event_type,
    message: row.message,
    actor_id: row.actor_id,
    reference_id: row.reference_id,
    created_at: row.created_at,
  }))
}

// ─── getActivityLogs ──────────────────────────────────────────────────────────

/**
 * Returns a paginated, optionally filtered list of activity log entries.
 * Defaults to page 1 with 20 records per page.
 */
export async function getActivityLogs(
  options: GetActivityLogsOptions,
): Promise<{ data: ActivityLog[]; count: number }> {
  const page = options.page ?? 1
  const pageSize = options.pageSize ?? 20
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  let query = supabase
    .from('activity_logs')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to)

  if (options.eventType !== undefined) {
    query = query.eq('event_type', options.eventType)
  }

  const { data, error, count } = await query

  if (error) throw new Error(error.message)

  const logs: ActivityLog[] = (data ?? []).map((row) => ({
    id: row.id,
    event_type: row.event_type,
    message: row.message,
    actor_id: row.actor_id,
    reference_id: row.reference_id,
    created_at: row.created_at,
  }))

  return { data: logs, count: count ?? 0 }
}
