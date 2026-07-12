// Screen 5: Allocation & Transfer — search assets, allocate or request transfer.
// Requirements: 12, 13, 14, 15

import { useEffect, useRef, useState, useCallback } from 'react'
import { searchAssets, listAssets } from '../services/assetService'
import {
  getActiveAllocation,
  createAllocation,
  createTransferRequest,
  getPendingTransferForAsset,
} from '../services/allocationService'
import { getActiveBookingForAsset } from '../services/bookingService'
import { getCurrentUserRole } from '../services/authService'
import { supabase } from '../lib/supabaseClient'
import AllocationHistory from '../components/AllocationHistory'
import { AllocationConflictError } from '../types/index'
import type { AssetWithCategory, AllocationWithProfiles, Profile, UserRole } from '../types/index'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Debounce a callback by `delay` ms, returns a stable function and a cancel ref. */
function useDebounce<T extends unknown[]>(
  fn: (...args: T) => void,
  delay: number,
): (...args: T) => void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  return useCallback(
    (...args: T) => {
      if (timerRef.current !== null) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => fn(...args), delay)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [delay],
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AllocationTransfer() {
  // ── Auth / role ────────────────────────────────────────────────────────────
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [currentUserRole, setCurrentUserRole] = useState<UserRole | null>(null)

  // ── Typeahead ──────────────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('')
  const [allAssets, setAllAssets] = useState<AssetWithCategory[]>([])
  const [suggestions, setSuggestions] = useState<AssetWithCategory[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)

  // Holds the AbortController for the latest in-flight search request
  const abortControllerRef = useRef<AbortController | null>(null)

  // ── Selected asset ─────────────────────────────────────────────────────────
  const [selectedAsset, setSelectedAsset] = useState<AssetWithCategory | null>(null)
  const [activeAllocation, setActiveAllocation] = useState<AllocationWithProfiles | null>(null)
  const [activeBooking, setActiveBooking] = useState<{ title: string; start_time: string; end_time: string } | null>(null)
  const [assetLoading, setAssetLoading] = useState(false)

  // ── Profiles dropdown (Assign To) ──────────────────────────────────────────
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [profilesLoading, setProfilesLoading] = useState(false)

  // ── Allocation form ────────────────────────────────────────────────────────
  const [assignToId, setAssignToId] = useState('')
  const [expectedReturnDate, setExpectedReturnDate] = useState('')
  const [allocationSubmitting, setAllocationSubmitting] = useState(false)
  const [allocationSuccess, setAllocationSuccess] = useState<string | null>(null)
  const [allocationError, setAllocationError] = useState<string | null>(null)

  // ── Transfer form ──────────────────────────────────────────────────────────
  const [transferReason, setTransferReason] = useState('')
  const [transferSubmitting, setTransferSubmitting] = useState(false)
  const [transferSuccess, setTransferSuccess] = useState<string | null>(null)
  const [transferError, setTransferError] = useState<string | null>(null)

  // ── Show transfer form even when status is Available (conflict fallback) ───
  const [showTransferFallback, setShowTransferFallback] = useState(false)

  // ── Key for re-mounting AllocationHistory after successful actions ─────────
  const [historyKey, setHistoryKey] = useState(0)

  // ── On mount: load current user id and role, then load active profiles ─────
  useEffect(() => {
    void (async () => {
      const [{ data: { user } }, role] = await Promise.all([
        supabase.auth.getUser(),
        getCurrentUserRole(),
      ])
      setCurrentUserId(user?.id ?? null)
      setCurrentUserRole(role)
    })()
  }, [])

  // Load all assets on mount so they're visible without typing
  useEffect(() => {
    void (async () => {
      setSearchLoading(true)
      try {
        const assets = await listAssets()
        setAllAssets(assets)
        setSuggestions(assets)
      } catch {
        // silently ignore
      } finally {
        setSearchLoading(false)
      }
    })()
  }, [])

  // Load active profiles for the "Assign To" dropdown when we know the user
  useEffect(() => {
    if (currentUserId === null) return
    void fetchActiveProfiles()
  }, [currentUserId])

  async function fetchActiveProfiles() {
    setProfilesLoading(true)
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('status', 'Active')
        .order('full_name', { ascending: true })
      if (error) throw new Error(error.message)
      setProfiles(
        (data ?? []).map((row) => ({
          id: row.id,
          full_name: row.full_name,
          email: row.email,
          role: row.role as Profile['role'],
          department_id: row.department_id,
          status: row.status as Profile['status'],
          created_at: row.created_at,
        })),
      )
    } catch {
      // Non-critical — dropdown will be empty; user will see an empty list
    } finally {
      setProfilesLoading(false)
    }
  }

  // ── Typeahead: fire search after debounce ──────────────────────────────────

  const fireSearch = useCallback(async (query: string) => {
    // Cancel any in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }

    if (query.length < 2) {
      // Show all assets when cleared
      setSuggestions(allAssets)
      setSearchLoading(false)
      return
    }

    const controller = new AbortController()
    abortControllerRef.current = controller

    setSearchLoading(true)
    setSearchError(null)

    try {
      const results = await searchAssets(query)
      if (controller.signal.aborted) return
      setSuggestions(results)
    } catch (err) {
      if (controller.signal.aborted) return
      setSearchError(err instanceof Error ? err.message : 'Search failed.')
      setSuggestions([])
    } finally {
      if (!controller.signal.aborted) setSearchLoading(false)
    }
  }, [allAssets])

  const debouncedSearch = useDebounce(fireSearch, 300)

  function handleSearchChange(value: string) {
    setSearchQuery(value)
    if (value.length < 2) {
      setSuggestions(allAssets)
      setSearchLoading(false)
      return
    }
    setSearchLoading(true)
    debouncedSearch(value)
  }

  // ── Asset selection ────────────────────────────────────────────────────────

  async function handleSelectAsset(asset: AssetWithCategory) {
    setSearchQuery('')

    // Reset all form state
    setAllocationSuccess(null)
    setAllocationError(null)
    setTransferSuccess(null)
    setTransferError(null)
    setAssignToId('')
    setExpectedReturnDate('')
    setTransferReason('')
    setShowTransferFallback(false)
    setActiveBooking(null)

    setAssetLoading(true)
    try {
      // Load full asset + active allocation + active booking in parallel
      const [freshResults, alloc, booking] = await Promise.all([
        searchAssets(asset.tag),
        getActiveAllocation(asset.id),
        getActiveBookingForAsset(asset.id),
      ])
      const fresh = freshResults.find((a) => a.id === asset.id) ?? asset
      setSelectedAsset(fresh)
      setActiveAllocation(alloc)
      setActiveBooking(booking)
    } catch {
      // Fall back to the suggestion data if the refresh fails
      setSelectedAsset(asset)
      setActiveAllocation(null)
    } finally {
      setAssetLoading(false)
    }
  }

  // ── Allocation submit ──────────────────────────────────────────────────────

  async function handleAllocationSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedAsset || !currentUserId || !assignToId) return

    setAllocationSubmitting(true)
    setAllocationSuccess(null)
    setAllocationError(null)

    try {
      await createAllocation({
        asset_id: selectedAsset.id,
        assigned_to: assignToId,
        assigned_by: currentUserId,
        expected_return_date: expectedReturnDate || null,
      })

      const employeeName =
        profiles.find((p) => p.id === assignToId)?.full_name ?? assignToId

      setAllocationSuccess(`Asset ${selectedAsset.tag} allocated to ${employeeName}`)
      setAssignToId('')
      setExpectedReturnDate('')

      // Refresh asset state
      const [freshResults, alloc, booking] = await Promise.all([
        searchAssets(selectedAsset.tag),
        getActiveAllocation(selectedAsset.id),
        getActiveBookingForAsset(selectedAsset.id),
      ])
      const fresh = freshResults.find((a) => a.id === selectedAsset.id) ?? selectedAsset
      setSelectedAsset(fresh)
      setActiveAllocation(alloc)
      setActiveBooking(booking)
      setHistoryKey((k) => k + 1)
    } catch (err) {
      if (err instanceof AllocationConflictError) {
        setAllocationError(err.message)
        setShowTransferFallback(true)
        // Refresh so UI correctly shows the Allocated state
        const [freshResults, alloc, booking] = await Promise.all([
          searchAssets(selectedAsset.tag),
          getActiveAllocation(selectedAsset.id),
          getActiveBookingForAsset(selectedAsset.id),
        ])
        const fresh = freshResults.find((a) => a.id === selectedAsset.id) ?? selectedAsset
        setSelectedAsset(fresh)
        setActiveAllocation(alloc)
        setActiveBooking(booking)
      } else {
        setAllocationError(err instanceof Error ? err.message : 'Allocation failed.')
      }
    } finally {
      setAllocationSubmitting(false)
    }
  }

  // ── Transfer submit ────────────────────────────────────────────────────────

  async function handleTransferSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedAsset || !currentUserId || !activeAllocation) return

    setTransferSubmitting(true)
    setTransferSuccess(null)
    setTransferError(null)

    try {
      // Check for existing pending transfer first
      const existing = await getPendingTransferForAsset(selectedAsset.id, currentUserId)
      if (existing) {
        setTransferError('You already have a pending request for this asset')
        return
      }

      await createTransferRequest({
        asset_id: selectedAsset.id,
        requested_by: currentUserId,
        current_holder: activeAllocation.assigned_to,
        reason: transferReason,
      })

      setTransferSuccess(
        'Transfer request submitted. You will be notified when reviewed.',
      )
      setTransferReason('')
      setHistoryKey((k) => k + 1)
    } catch (err) {
      setTransferError(
        err instanceof Error ? err.message : 'Transfer request failed.',
      )
    } finally {
      setTransferSubmitting(false)
    }
  }

  // ── Derived state ──────────────────────────────────────────────────────────

  const showAllocationForm =
    selectedAsset !== null &&
    selectedAsset.status === 'Available' &&
    !showTransferFallback &&
    activeBooking === null

  const showTransferForm =
    selectedAsset !== null &&
    (selectedAsset.status === 'Allocated' || showTransferFallback)

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <main style={styles.page}>
      {/* Page header */}
      <div style={styles.headerRow}>
        <h1 style={styles.heading}>Allocation &amp; Transfer</h1>
      </div>

      <div style={styles.layout}>

      {/* ── Asset list / search ── */}
      <div style={styles.assetListSection}>
        <div style={styles.searchInputWrapper}>
          <input
            type="text"
            placeholder="Filter by asset tag or name…"
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            style={styles.searchInput}
            aria-label="Filter assets"
          />
          {searchLoading && <span style={styles.searchSpinner}>…</span>}
        </div>

        {searchError && <p style={styles.errorText}>{searchError}</p>}

        <div style={styles.assetGrid}>
          {suggestions.length === 0 && !searchLoading && (
            <p style={styles.noResults}>No assets found{searchQuery.length >= 2 ? ` matching "${searchQuery}"` : ''}.</p>
          )}
          {suggestions.map((asset) => (
            <button
              key={asset.id}
              type="button"
              onClick={() => void handleSelectAsset(asset)}
              style={{
                ...styles.assetCard,
                ...(selectedAsset?.id === asset.id ? styles.assetCardSelected : {}),
              }}
            >
              <span style={styles.assetCardTag}>{asset.tag}</span>
              <span style={styles.assetCardName}>{asset.name}</span>
              <span style={{ ...styles.assetCardStatus, ...statusBadgeColor(asset.status) }}>
                {asset.status}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Right panel: asset details ── */}
      <div style={styles.rightPanel}>
      {/* ── Asset loading ── */}
      {assetLoading && <p style={styles.stateText}>Loading asset details…</p>}

      {/* ── No asset selected ── */}
      {!selectedAsset && !assetLoading && (
        <p style={styles.emptyState}>Select an asset on the left to view allocation options</p>
      )}

      {/* ── Asset selected ── */}
      {selectedAsset && !assetLoading && (
        <div style={styles.assetSection}>

          {/* Asset info panel */}
          <div style={styles.infoPanel}>
            <h2 style={styles.infoPanelHeading}>Asset Details</h2>
            <dl style={styles.infoGrid}>
              <dt style={styles.dt}>Tag</dt>
              <dd style={styles.dd}>
                <span style={styles.tagBadge}>{selectedAsset.tag}</span>
              </dd>

              <dt style={styles.dt}>Name</dt>
              <dd style={styles.dd}>{selectedAsset.name}</dd>

              <dt style={styles.dt}>Category</dt>
              <dd style={styles.dd}>{selectedAsset.category_name || <span style={styles.muted}>—</span>}</dd>

              <dt style={styles.dt}>Status</dt>
              <dd style={styles.dd}>
                <span style={{ ...styles.statusBadge, ...statusBadgeColor(selectedAsset.status) }}>
                  {selectedAsset.status}
                </span>
              </dd>

              <dt style={styles.dt}>Location</dt>
              <dd style={styles.dd}>{selectedAsset.location ?? <span style={styles.muted}>—</span>}</dd>

              <dt style={styles.dt}>Serial Number</dt>
              <dd style={styles.dd}>{selectedAsset.serial_number ?? <span style={styles.muted}>—</span>}</dd>
            </dl>
          </div>

          {/* ── Active booking warning (blocks allocation) ── */}
          {activeBooking !== null && selectedAsset?.status !== 'Allocated' && (
            <div style={styles.bookingBlockBanner} role="alert">
              <strong>Allocation blocked:</strong> This asset has an active booking
              &ldquo;{activeBooking.title}&rdquo; from{' '}
              {new Date(activeBooking.start_time).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
              {' '}to{' '}
              {new Date(activeBooking.end_time).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}.
              It cannot be allocated until the booking ends.
            </div>
          )}

          {/* ── Allocate Asset form (status === Available) ── */}
          {showAllocationForm && (
            <div style={styles.formCard}>
              <h3 style={styles.formHeading}>Allocate Asset</h3>

              {allocationSuccess && (
                <p style={styles.successBanner} role="status">{allocationSuccess}</p>
              )}
              {allocationError && (
                <p style={styles.errorBanner} role="alert">{allocationError}</p>
              )}

              <form onSubmit={(e) => void handleAllocationSubmit(e)}>
                <div style={styles.field}>
                  <label style={styles.label} htmlFor="assign-to">
                    Assign To <span style={styles.required}>*</span>
                  </label>
                  <select
                    id="assign-to"
                    value={assignToId}
                    onChange={(e) => setAssignToId(e.target.value)}
                    required
                    style={styles.select}
                    disabled={profilesLoading}
                  >
                    <option value="">
                      {profilesLoading ? 'Loading employees…' : 'Select employee'}
                    </option>
                    {profiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.full_name ?? p.email}
                      </option>
                    ))}
                  </select>
                </div>

                <div style={styles.field}>
                  <label style={styles.label} htmlFor="expected-return-date">
                    Expected Return Date <span style={styles.optional}>(optional)</span>
                  </label>
                  <input
                    id="expected-return-date"
                    type="date"
                    value={expectedReturnDate}
                    onChange={(e) => setExpectedReturnDate(e.target.value)}
                    style={styles.input}
                    min={new Date().toISOString().split('T')[0]}
                  />
                </div>

                <button
                  type="submit"
                  style={allocationSubmitting ? { ...styles.submitButton, opacity: 0.6 } : styles.submitButton}
                  disabled={allocationSubmitting || !assignToId}
                >
                  {allocationSubmitting ? 'Allocating…' : 'Submit Allocation'}
                </button>
              </form>
            </div>
          )}

          {/* ── Transfer Request form (status === Allocated) ── */}
          {showTransferForm && (
            <div style={styles.formCard}>
              {/* Red warning banner */}
              <div style={styles.allocatedBanner} role="alert">
                Asset currently allocated to{' '}
                <strong>
                  {activeAllocation?.assigned_to_name ?? 'Unknown'}
                </strong>
              </div>

              <h3 style={styles.formHeading}>Request Transfer</h3>

              {transferSuccess && (
                <p style={styles.successBanner} role="status">{transferSuccess}</p>
              )}
              {transferError && (
                <p style={styles.errorBanner} role="alert">{transferError}</p>
              )}

              {/* Only show the form when there's no success yet */}
              {!transferSuccess && (
                <form onSubmit={(e) => void handleTransferSubmit(e)}>
                  <div style={styles.field}>
                    <label style={styles.label} htmlFor="transfer-reason">
                      Reason <span style={styles.required}>*</span>
                    </label>
                    <textarea
                      id="transfer-reason"
                      value={transferReason}
                      onChange={(e) => setTransferReason(e.target.value)}
                      required
                      maxLength={1000}
                      rows={4}
                      style={styles.textarea}
                      placeholder="Describe why you need this asset…"
                    />
                    <p style={styles.charCount}>
                      {transferReason.length} / 1000
                    </p>
                  </div>

                  <button
                    type="submit"
                    style={
                      transferSubmitting || !transferReason.trim()
                        ? { ...styles.submitButton, opacity: 0.6 }
                        : styles.submitButton
                    }
                    disabled={transferSubmitting || !transferReason.trim()}
                  >
                    {transferSubmitting ? 'Submitting…' : 'Submit Request'}
                  </button>
                </form>
              )}
            </div>
          )}

          {/* ── Allocation History ── */}
          {currentUserRole !== null && (
            <AllocationHistory
              key={historyKey}
              assetId={selectedAsset.id}
              currentUserRole={currentUserRole}
            />
          )}
        </div>
      )}
      </div> {/* rightPanel */}
      </div> {/* layout */}
    </main>
  )
}

// ─── Status badge color helper ────────────────────────────────────────────────

function statusBadgeColor(status: AssetWithCategory['status']): React.CSSProperties {
  const map: Record<AssetWithCategory['status'], { backgroundColor: string; color: string }> = {
    Available:           { backgroundColor: '#dcfce7', color: '#166534' },
    Allocated:           { backgroundColor: '#dbeafe', color: '#1e40af' },
    Reserved:            { backgroundColor: '#fef9c3', color: '#854d0e' },
    'Under Maintenance': { backgroundColor: '#ffedd5', color: '#9a3412' },
    Lost:                { backgroundColor: '#f3f4f6', color: '#4b5563' },
    Retired:             { backgroundColor: '#f3f4f6', color: '#4b5563' },
    Disposed:            { backgroundColor: '#f3f4f6', color: '#4b5563' },
  }
  return map[status] ?? { backgroundColor: '#f3f4f6', color: '#4b5563' }
}

// ─── Inline Styles ────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    backgroundColor: '#f5f5f5',
    padding: '2rem',
  },
  headerRow: {
    display: 'flex',
    alignItems: 'center',
    marginBottom: '1.25rem',
  },
  heading: {
    margin: 0,
    fontSize: '1.75rem',
    fontWeight: 700,
    color: '#111',
  },
  // ── Two-column layout ──────────────────────────────────────────────────────
  layout: {
    display: 'flex',
    gap: '1.5rem',
    alignItems: 'flex-start',
  },
  // ── Left panel: asset list ─────────────────────────────────────────────────
  assetListSection: {
    flex: '0 0 280px',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
  },
  searchInputWrapper: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
  },
  searchInput: {
    width: '100%',
    padding: '0.6rem 2.5rem 0.6rem 0.875rem',
    fontSize: '0.875rem',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    outline: 'none',
    backgroundColor: '#ffffff',
    color: '#111',
    boxSizing: 'border-box',
  },
  searchSpinner: {
    position: 'absolute',
    right: '0.75rem',
    fontSize: '0.85rem',
    color: '#9ca3af',
  },
  assetGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
    maxHeight: 'calc(100vh - 180px)',
    overflowY: 'auto',
  },
  assetCard: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: '0.25rem',
    padding: '0.75rem 1rem',
    backgroundColor: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    cursor: 'pointer',
    textAlign: 'left',
    width: '100%',
    boxSizing: 'border-box',
    transition: 'border-color 0.15s',
  },
  assetCardSelected: {
    border: '2px solid #2563eb',
    backgroundColor: '#eff6ff',
  },
  assetCardTag: {
    fontFamily: 'monospace',
    fontSize: '0.78rem',
    fontWeight: 700,
    color: '#374151',
    letterSpacing: '0.04em',
  },
  assetCardName: {
    fontSize: '0.875rem',
    fontWeight: 600,
    color: '#111827',
  },
  assetCardStatus: {
    fontSize: '0.72rem',
    fontWeight: 600,
    padding: '0.15rem 0.5rem',
    borderRadius: '999px',
    marginTop: '0.1rem',
  },
  noResults: {
    margin: '0.5rem 0 0',
    fontSize: '0.85rem',
    color: '#6b7280',
  },
  errorText: {
    margin: '0.4rem 0 0',
    fontSize: '0.85rem',
    color: '#dc2626',
  },
  // ── Right panel: asset details ─────────────────────────────────────────────
  rightPanel: {
    flex: 1,
    minWidth: 0,
  },
  stateText: {
    color: '#666',
    fontSize: '0.9rem',
    padding: '1.5rem 0',
  },
  emptyState: {
    padding: '2.5rem 2rem',
    textAlign: 'center',
    fontSize: '0.975rem',
    color: '#6b7280',
    backgroundColor: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
  },
  // ── Asset section ──────────────────────────────────────────────────────────
  assetSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1.25rem',
  },
  // ── Info panel ─────────────────────────────────────────────────────────────
  infoPanel: {
    backgroundColor: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    padding: '1.25rem 1.5rem',
    boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
  },
  infoPanelHeading: {
    margin: '0 0 1rem',
    fontSize: '1rem',
    fontWeight: 700,
    color: '#111827',
  },
  infoGrid: {
    display: 'grid',
    gridTemplateColumns: '140px 1fr',
    gap: '0.4rem 0.75rem',
    margin: 0,
  },
  dt: {
    fontWeight: 600,
    fontSize: '0.85rem',
    color: '#6b7280',
    alignSelf: 'center',
  },
  dd: {
    margin: 0,
    fontSize: '0.875rem',
    color: '#111',
    alignSelf: 'center',
  },
  tagBadge: {
    fontFamily: 'monospace',
    fontSize: '0.85rem',
    backgroundColor: '#f3f4f6',
    color: '#374151',
    padding: '0.2rem 0.45rem',
    borderRadius: '4px',
  },
  statusBadge: {
    display: 'inline-block',
    padding: '0.2rem 0.55rem',
    borderRadius: '9999px',
    fontSize: '0.8rem',
    fontWeight: 600,
  },
  muted: {
    color: '#9ca3af',
  },
  // ── Form card ──────────────────────────────────────────────────────────────
  formCard: {
    backgroundColor: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    padding: '1.25rem 1.5rem',
    boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
  },
  formHeading: {
    margin: '0 0 1rem',
    fontSize: '1rem',
    fontWeight: 700,
    color: '#111827',
  },
  allocatedBanner: {
    marginBottom: '1rem',
    padding: '0.75rem 1rem',
    backgroundColor: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: '6px',
    fontSize: '0.9rem',
    color: '#dc2626',
  },
  successBanner: {
    marginBottom: '0.875rem',
    padding: '0.65rem 0.875rem',
    backgroundColor: '#f0fdf4',
    border: '1px solid #bbf7d0',
    borderRadius: '6px',
    fontSize: '0.875rem',
    color: '#15803d',
  },
  errorBanner: {
    marginBottom: '0.875rem',
    padding: '0.65rem 0.875rem',
    backgroundColor: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: '6px',
    fontSize: '0.875rem',
    color: '#dc2626',
  },
  field: {
    marginBottom: '1rem',
  },
  label: {
    display: 'block',
    marginBottom: '0.35rem',
    fontSize: '0.875rem',
    fontWeight: 600,
    color: '#374151',
  },
  required: {
    color: '#dc2626',
    marginLeft: '2px',
  },
  optional: {
    fontWeight: 400,
    color: '#9ca3af',
    fontSize: '0.8rem',
    marginLeft: '4px',
  },
  select: {
    width: '100%',
    padding: '0.5rem 0.75rem',
    fontSize: '0.9rem',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    backgroundColor: '#ffffff',
    color: '#111',
    boxSizing: 'border-box',
    cursor: 'pointer',
  },
  input: {
    width: '100%',
    padding: '0.5rem 0.75rem',
    fontSize: '0.9rem',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    color: '#111',
    backgroundColor: '#ffffff',
    boxSizing: 'border-box',
  },
  textarea: {
    width: '100%',
    padding: '0.5rem 0.75rem',
    fontSize: '0.9rem',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    color: '#111',
    backgroundColor: '#ffffff',
    boxSizing: 'border-box',
    resize: 'vertical',
  },
  charCount: {
    margin: '0.25rem 0 0',
    fontSize: '0.78rem',
    color: '#9ca3af',
    textAlign: 'right',
  },
  submitButton: {
    padding: '0.575rem 1.25rem',
    fontSize: '0.9rem',
    fontWeight: 600,
    color: '#ffffff',
    backgroundColor: '#2563eb',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  bookingBlockBanner: {
    padding: '0.75rem 1rem',
    backgroundColor: '#fff7ed',
    border: '1px solid #fed7aa',
    borderRadius: '8px',
    fontSize: '0.875rem',
    color: '#9a3412',
  },
}
