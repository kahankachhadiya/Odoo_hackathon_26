// Allocation history timeline for a selected asset.
// Displays chronological allocation records (most recent first) and exposes
// inline Approve / Reject actions for pending transfer requests (role-gated).
// Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 19

import { useEffect, useState, useCallback } from 'react'
import {
  getAllocationsForAsset,
  getPendingTransferForAsset,
  approveTransferRequest,
  rejectTransferRequest,
} from '../services/allocationService'
import { supabase } from '../lib/supabaseClient'
import type { AllocationWithProfiles, TransferRequest, UserRole } from '../types/index'

// ─── Props ────────────────────────────────────────────────────────────────────

interface AllocationHistoryProps {
  assetId: string
  currentUserRole: UserRole
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AllocationHistory({
  assetId,
  currentUserRole,
}: AllocationHistoryProps) {
  const [allocations, setAllocations] = useState<AllocationWithProfiles[]>([])
  const [pendingTransfer, setPendingTransfer] = useState<TransferRequest | null>(null)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState(false)

  // ── Data fetching ──────────────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    setFetchError(null)
    try {
      // Get current user ID for the pending transfer query
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (userError) throw new Error(userError.message)

      const userId = user?.id ?? ''

      const [allocationData, transferData] = await Promise.all([
        getAllocationsForAsset(assetId),
        userId ? getPendingTransferForAsset(assetId, userId) : Promise.resolve(null),
      ])

      setAllocations(allocationData)
      setPendingTransfer(transferData)
    } catch (err) {
      setFetchError(
        err instanceof Error ? err.message : 'Failed to load allocation history.'
      )
    }
  }, [assetId])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  // ── Role gate ──────────────────────────────────────────────────────────────

  const canApproveReject =
    currentUserRole === 'Admin' || currentUserRole === 'Asset Manager'

  // ── Actions ────────────────────────────────────────────────────────────────

  async function handleApprove() {
    if (!pendingTransfer) return
    setActionError(null)
    setActionLoading(true)
    try {
      await approveTransferRequest(pendingTransfer.id, pendingTransfer.requested_by)
      await fetchData()
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Failed to approve transfer request.'
      )
    } finally {
      setActionLoading(false)
    }
  }

  async function handleReject() {
    if (!pendingTransfer) return
    setActionError(null)
    setActionLoading(true)
    try {
      await rejectTransferRequest(pendingTransfer.id)
      await fetchData()
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Failed to reject transfer request.'
      )
    } finally {
      setActionLoading(false)
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={styles.container}>
      <h4 style={styles.heading}>Allocation History</h4>

      {/* Fetch error */}
      {fetchError && (
        <p style={styles.errorBanner} role="alert">
          {fetchError}
        </p>
      )}

      {/* Pending transfer request + Approve / Reject (role-gated) */}
      {pendingTransfer && canApproveReject && (
        <div style={styles.pendingCard}>
          <p style={styles.pendingLabel}>Pending Transfer Request</p>
          <p style={styles.pendingReason}>{pendingTransfer.reason}</p>

          {actionError && (
            <p style={styles.errorBanner} role="alert">
              {actionError}
            </p>
          )}

          <div style={styles.actionRow}>
            <button
              style={
                actionLoading
                  ? { ...styles.approveButton, opacity: 0.6 }
                  : styles.approveButton
              }
              onClick={() => void handleApprove()}
              disabled={actionLoading}
            >
              {actionLoading ? 'Processing…' : 'Approve'}
            </button>
            <button
              style={
                actionLoading
                  ? { ...styles.rejectButton, opacity: 0.6 }
                  : styles.rejectButton
              }
              onClick={() => void handleReject()}
              disabled={actionLoading}
            >
              {actionLoading ? 'Processing…' : 'Reject'}
            </button>
          </div>
        </div>
      )}

      {/* Timeline */}
      {allocations.length === 0 && !fetchError ? (
        <p style={styles.emptyText}>No previous allocations</p>
      ) : (
        <ul style={styles.timeline}>
          {allocations.map((entry) => {
            const isActive = entry.returned_at === null
            return (
              <li
                key={entry.id}
                style={isActive ? { ...styles.timelineItem, ...styles.activeItem } : styles.timelineItem}
              >
                {/* Date range */}
                <p style={isActive ? { ...styles.dateRange, fontWeight: 700 } : styles.dateRange}>
                  {formatDate(entry.created_at)} →{' '}
                  {isActive ? 'Current' : formatDate(entry.returned_at as string)}
                </p>

                {/* Assigned to / by */}
                <p style={styles.detail}>
                  <span style={styles.detailLabel}>Assigned to:</span>{' '}
                  {entry.assigned_to_name ?? 'Unknown'}
                </p>
                <p style={styles.detail}>
                  <span style={styles.detailLabel}>Assigned by:</span>{' '}
                  {entry.assigned_by_name ?? 'Unknown'}
                </p>

                {/* Return condition — only when present */}
                {entry.return_condition !== null && (
                  <p style={styles.detail}>
                    <span style={styles.detailLabel}>Return condition:</span>{' '}
                    {entry.return_condition}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// ─── Inline Styles ────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  container: {
    marginTop: '1.5rem',
  },
  heading: {
    margin: '0 0 1rem',
    fontSize: '1rem',
    fontWeight: 700,
    color: '#111827',
  },
  errorBanner: {
    margin: '0 0 0.75rem',
    padding: '0.6rem 0.75rem',
    fontSize: '0.85rem',
    color: '#dc2626',
    backgroundColor: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: '6px',
  },
  emptyText: {
    margin: 0,
    fontSize: '0.875rem',
    color: '#6b7280',
  },
  timeline: {
    listStyle: 'none',
    margin: 0,
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
  },
  timelineItem: {
    padding: '0.875rem 1rem',
    borderRadius: '8px',
    border: '1px solid #e5e7eb',
    backgroundColor: '#f9fafb',
  },
  activeItem: {
    backgroundColor: '#eff6ff',
    borderColor: '#bfdbfe',
  },
  dateRange: {
    margin: '0 0 0.4rem',
    fontSize: '0.9rem',
    color: '#111827',
  },
  detail: {
    margin: '0.15rem 0 0',
    fontSize: '0.85rem',
    color: '#374151',
  },
  detailLabel: {
    fontWeight: 600,
    color: '#6b7280',
  },
  pendingCard: {
    marginBottom: '1rem',
    padding: '0.875rem 1rem',
    borderRadius: '8px',
    border: '1px solid #fde68a',
    backgroundColor: '#fffbeb',
  },
  pendingLabel: {
    margin: '0 0 0.35rem',
    fontSize: '0.8rem',
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    color: '#92400e',
  },
  pendingReason: {
    margin: '0 0 0.75rem',
    fontSize: '0.875rem',
    color: '#374151',
  },
  actionRow: {
    display: 'flex',
    gap: '0.5rem',
  },
  approveButton: {
    padding: '0.4rem 0.9rem',
    fontSize: '0.85rem',
    fontWeight: 600,
    color: '#ffffff',
    backgroundColor: '#16a34a',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  rejectButton: {
    padding: '0.4rem 0.9rem',
    fontSize: '0.85rem',
    fontWeight: 600,
    color: '#ffffff',
    backgroundColor: '#dc2626',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
  },
}
