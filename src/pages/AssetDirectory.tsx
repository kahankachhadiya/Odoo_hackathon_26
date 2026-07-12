// Screen 4: Asset Directory — viewable by all roles, "Register New Asset" for Admin/Asset Manager.
// Requirements: 10.4, 10.5, 10.6, 10.7, 11, 12

import { useEffect, useState } from 'react'
import { listAssets } from '../services/assetService'
import { getCurrentUserRole } from '../services/authService'
import { supabase } from '../lib/supabaseClient'
import RegisterAssetModal from '../components/RegisterAssetModal'
import type { Asset, AssetCategory, AssetStatus, AssetWithCategory, UserRole } from '../types/index'

// ─── Status badge colors ──────────────────────────────────────────────────────

const STATUS_COLORS: Record<AssetStatus, { background: string; color: string }> = {
  Available:         { background: '#dcfce7', color: '#166534' },
  Allocated:         { background: '#dbeafe', color: '#1e40af' },
  Reserved:          { background: '#fef9c3', color: '#854d0e' },
  'Under Maintenance': { background: '#ffedd5', color: '#9a3412' },
  Lost:              { background: '#f3f4f6', color: '#4b5563' },
  Retired:           { background: '#f3f4f6', color: '#4b5563' },
  Disposed:          { background: '#f3f4f6', color: '#4b5563' },
}

const ALL_STATUSES: AssetStatus[] = [
  'Available',
  'Allocated',
  'Reserved',
  'Under Maintenance',
  'Lost',
  'Retired',
  'Disposed',
]

// ─── Component ────────────────────────────────────────────────────────────────

export default function AssetDirectory() {
  const [assets, setAssets] = useState<AssetWithCategory[]>([])
  const [categories, setCategories] = useState<AssetCategory[]>([])
  const [currentUserRole, setCurrentUserRole] = useState<UserRole | null>(null)
  const [filters, setFilters] = useState<{ search: string; categoryId: string; status: string }>({
    search: '',
    categoryId: '',
    status: '',
  })
  const [showModal, setShowModal] = useState(false)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)

  // ── Data fetching on mount ─────────────────────────────────────────────────

  useEffect(() => {
    void fetchData()
  }, [])

  async function fetchData() {
    setLoading(true)
    setFetchError(null)

    try {
      const [assetsResult, roleResult, catsResult] = await Promise.all([
        listAssets(),
        getCurrentUserRole(),
        supabase.from('asset_categories').select('*').order('name', { ascending: true }),
      ])

      setAssets(assetsResult)
      setCurrentUserRole(roleResult)

      if (catsResult.error) {
        setFetchError('Failed to load categories. Please try again.')
        setLoading(false)
        return
      }

      setCategories(
        (catsResult.data ?? []).map((row) => ({
          ...row,
          attributes: row.attributes as AssetCategory['attributes'],
        }))
      )
    } catch {
      setFetchError('Failed to load assets. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // ── Modal success handler — optimistic append ──────────────────────────────

  function handleAssetCreated(newAsset: Asset) {
    const cat = categories.find((c) => c.id === newAsset.category_id)
    const assetWithCat: AssetWithCategory = { ...newAsset, category_name: cat?.name ?? '' }
    setAssets((prev) => [assetWithCat, ...prev])
    setShowModal(false)
  }

  // ── Client-side filtering ──────────────────────────────────────────────────

  const filteredAssets = assets.filter((asset) => {
    const searchLower = filters.search.toLowerCase()
    const matchesSearch =
      filters.search === '' ||
      asset.tag.toLowerCase().includes(searchLower) ||
      asset.name.toLowerCase().includes(searchLower) ||
      (asset.serial_number ?? '').toLowerCase().includes(searchLower)

    const matchesCategory =
      filters.categoryId === '' || asset.category_id === filters.categoryId

    const matchesStatus =
      filters.status === '' || asset.status === filters.status

    return matchesSearch && matchesCategory && matchesStatus
  })

  const canRegister =
    currentUserRole === 'Admin' || currentUserRole === 'Asset Manager'

  const hasActiveFilters =
    filters.search !== '' || filters.categoryId !== '' || filters.status !== ''

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <main style={styles.page}>
      {/* Page header */}
      <div style={styles.headerRow}>
        <h1 style={styles.heading}>Asset Directory</h1>
        {canRegister && (
          <button
            type="button"
            style={styles.registerButton}
            onClick={() => setShowModal(true)}
            aria-label="Register new asset"
          >
            + Register New Asset
          </button>
        )}
      </div>

      {/* Filter bar */}
      <div style={styles.filterBar} role="search" aria-label="Asset filters">
        <input
          type="text"
          placeholder="Search by tag, name, or serial…"
          value={filters.search}
          onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
          style={styles.searchInput}
          aria-label="Search assets"
        />

        <select
          value={filters.categoryId}
          onChange={(e) => setFilters((prev) => ({ ...prev, categoryId: e.target.value }))}
          style={styles.filterSelect}
          aria-label="Filter by category"
        >
          <option value="">All Categories</option>
          {categories.map((cat) => (
            <option key={cat.id} value={cat.id}>
              {cat.name}
            </option>
          ))}
        </select>

        <select
          value={filters.status}
          onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}
          style={styles.filterSelect}
          aria-label="Filter by status"
        >
          <option value="">All Statuses</option>
          {ALL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {/* Loading state */}
      {loading && <p style={styles.stateText}>Loading assets…</p>}

      {/* Error state */}
      {!loading && fetchError && <p style={styles.errorText}>{fetchError}</p>}

      {/* Data grid */}
      {!loading && !fetchError && (
        <>
          {/* Empty state — no assets registered at all */}
          {assets.length === 0 && (
            <p style={styles.emptyState}>
              No assets registered yet. Click &lsquo;Register New Asset&rsquo; to get started.
            </p>
          )}

          {/* Empty state — filters active but nothing matches */}
          {assets.length > 0 && filteredAssets.length === 0 && hasActiveFilters && (
            <p style={styles.emptyState}>No assets match the current filters.</p>
          )}

          {/* Table */}
          {filteredAssets.length > 0 && (
            <div style={styles.tableWrapper}>
              <table style={styles.table} aria-label="Asset directory">
                <thead>
                  <tr>
                    <th style={styles.th}>Tag</th>
                    <th style={styles.th}>Name</th>
                    <th style={styles.th}>Category</th>
                    <th style={styles.th}>Status</th>
                    <th style={styles.th}>Serial Number</th>
                    <th style={styles.th}>Location</th>
                    <th style={styles.th}>Created Date</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAssets.map((asset) => {
                    const badge = STATUS_COLORS[asset.status] ?? STATUS_COLORS['Disposed']
                    return (
                      <tr key={asset.id} style={styles.tr}>
                        <td style={styles.td}>
                          <span style={styles.tagBadge}>{asset.tag}</span>
                        </td>
                        <td style={styles.td}>{asset.name}</td>
                        <td style={styles.td}>{asset.category_name || <span style={styles.muted}>—</span>}</td>
                        <td style={styles.td}>
                          <span
                            style={{
                              ...styles.statusBadge,
                              backgroundColor: badge.background,
                              color: badge.color,
                            }}
                          >
                            {asset.status}
                          </span>
                        </td>
                        <td style={styles.td}>
                          {asset.serial_number ? (
                            asset.serial_number
                          ) : (
                            <span style={styles.muted}>—</span>
                          )}
                        </td>
                        <td style={styles.td}>
                          {asset.location ? asset.location : <span style={styles.muted}>—</span>}
                        </td>
                        <td style={styles.td}>
                          {new Date(asset.created_at).toLocaleDateString()}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Register Asset Modal */}
      <RegisterAssetModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onSuccess={handleAssetCreated}
        categories={categories}
      />
    </main>
  )
}

// ─── Inline Styles ────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    backgroundColor: 'transparent',
    padding: '2rem',
    color: 'var(--text-primary)',
  },
  headerRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '1.25rem',
  },
  heading: {
    margin: 0,
    fontSize: '1.75rem',
    fontWeight: 700,
    color: 'var(--text-primary)',
  },
  registerButton: {
    padding: '0.6rem 1.25rem',
    fontSize: '0.875rem',
    fontWeight: 600,
    color: 'var(--text-primary)',
    backgroundColor: 'transparent',
    border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-pill)',
    cursor: 'pointer',
    transition: 'var(--transition-all)',
  },
  filterBar: {
    display: 'flex',
    gap: '0.75rem',
    flexWrap: 'wrap',
    marginBottom: '1.25rem',
    backgroundColor: 'transparent',
    padding: '0.875rem 1rem',
    borderRadius: 'var(--radius-card)',
    border: '1px solid var(--border-color)',
  },
  searchInput: {
    flex: '1 1 220px',
    padding: '0.6rem 1rem',
    fontSize: '0.9rem',
    border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-pill)',
    outline: 'none',
    color: 'var(--text-primary)',
    backgroundColor: 'transparent',
    boxSizing: 'border-box',
  },
  filterSelect: {
    flex: '0 1 180px',
    padding: '0.6rem 1rem',
    fontSize: '0.9rem',
    border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-pill)',
    outline: 'none',
    color: 'var(--text-primary)',
    backgroundColor: 'var(--bg-secondary)',
    boxSizing: 'border-box',
    cursor: 'pointer',
  },
  stateText: {
    color: 'var(--text-secondary)',
    fontSize: '0.9rem',
    padding: '1.5rem 0',
  },
  errorText: {
    color: 'var(--error)',
    fontSize: '0.9rem',
    padding: '1rem 0',
  },
  emptyState: {
    color: 'var(--text-secondary)',
    fontSize: '0.95rem',
    padding: '2rem',
    textAlign: 'center',
    backgroundColor: 'transparent',
    border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-card)',
  },
  tableWrapper: {
    overflowX: 'auto',
    backgroundColor: 'transparent',
    border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-card)',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '0.9rem',
    color: 'var(--text-primary)',
  },
  th: {
    textAlign: 'left',
    padding: '0.8rem 1rem',
    backgroundColor: 'var(--bg-secondary)',
    borderBottom: '1px solid var(--border-color)',
    fontWeight: 600,
    color: 'var(--text-secondary)',
    whiteSpace: 'nowrap',
  },
  tr: {
    borderBottom: '1px solid var(--border-color)',
  },
  td: {
    padding: '0.8rem 1rem',
    color: 'var(--text-primary)',
    verticalAlign: 'middle',
  },
  muted: {
    color: 'var(--text-secondary)',
  },
  tagBadge: {
    fontFamily: 'monospace',
    fontSize: '0.85rem',
    backgroundColor: 'var(--bg-tertiary)',
    color: 'var(--text-primary)',
    padding: '0.2rem 0.45rem',
    borderRadius: 'var(--radius-sm)',
    whiteSpace: 'nowrap',
  },
  statusBadge: {
    display: 'inline-block',
    padding: '0.2rem 0.55rem',
    borderRadius: 'var(--radius-pill)',
    fontSize: '0.8rem',
    fontWeight: 600,
    whiteSpace: 'nowrap',
  },
}
