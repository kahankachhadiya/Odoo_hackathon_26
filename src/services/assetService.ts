// Asset service for AssetFlow Stage 2.
// Provides asset listing, search, and creation operations.
// Requirements: 10.6, 10.7, 11, 12.1, 12.2

import { supabase } from '../lib/supabaseClient'
import type { Asset, AssetWithCategory, CreateAssetInput } from '../types/index'
import { DuplicateSerialError } from '../types/index'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Maps a raw Supabase row (assets JOIN asset_categories) to AssetWithCategory.
 * The joined shape from `.select('*, asset_categories(name)')` nests the
 * category under an `asset_categories` object; we flatten it here.
 */
function mapRowToAssetWithCategory(row: {
  id: string
  tag: string
  name: string
  category_id: string
  serial_number: string | null
  status: 'Available' | 'Allocated' | 'Reserved' | 'Under Maintenance' | 'Lost' | 'Retired' | 'Disposed'
  condition: string | null
  location: string | null
  is_bookable: boolean
  created_at: string
  asset_categories: { name: string } | null
}): AssetWithCategory {
  return {
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
    category_name: row.asset_categories?.name ?? '',
  }
}

// ─── listAssets ───────────────────────────────────────────────────────────────

/**
 * Fetches all assets joined with their category name.
 * Uses Supabase's embedded resource syntax to JOIN asset_categories.
 * Requirements: 10.6, 11
 */
export async function listAssets(): Promise<AssetWithCategory[]> {
  const { data, error } = await supabase
    .from('assets')
    .select('*, asset_categories(name)')
    .order('created_at', { ascending: false })

  if (error) {
    throw error
  }

  return (data ?? []).map(mapRowToAssetWithCategory)
}

// ─── searchAssets ─────────────────────────────────────────────────────────────

/**
 * Searches assets by tag or name using a case-insensitive ILIKE filter.
 * The 2-character minimum is enforced by the caller (AllocationTransfer page).
 * Also joins asset_categories for category_name.
 * Requirements: 12.1, 12.2
 */
export async function searchAssets(query: string): Promise<AssetWithCategory[]> {
  const pattern = `%${query}%`

  const { data, error } = await supabase
    .from('assets')
    .select('*, asset_categories(name)')
    .or(`tag.ilike.${pattern},name.ilike.${pattern}`)
    .order('name', { ascending: true })

  if (error) {
    throw error
  }

  return (data ?? []).map(mapRowToAssetWithCategory)
}

// ─── createAsset ──────────────────────────────────────────────────────────────

/**
 * Inserts a new asset record, omitting `tag` so the DB default
 * ('AF-' || LPAD(nextval('asset_tag_seq')::TEXT, 4, '0')) fires automatically.
 *
 * On unique constraint violation (code 23505) for serial_number, re-throws
 * DuplicateSerialError. All other errors are re-thrown as-is.
 * Requirements: 10.7, 17
 */
export async function createAsset(input: CreateAssetInput): Promise<Asset> {
  const { data, error } = await supabase
    .from('assets')
    .insert({
      name: input.name,
      category_id: input.category_id,
      serial_number: input.serial_number ?? null,
      condition: input.condition ?? null,
      location: input.location ?? null,
      // tag is intentionally omitted — DB default fires
    })
    .select()
    .single()

  if (error) {
    // Unique constraint violation
    if (
      error.code === '23505' &&
      typeof error.details === 'string' &&
      error.details.includes('serial_number')
    ) {
      throw new DuplicateSerialError()
    }
    throw error
  }

  const row = data
  const asset: Asset = {
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
  }

  return asset
}
