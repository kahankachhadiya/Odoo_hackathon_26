// Maintenance Kanban Board — Screen 7.
// Displays maintenance requests grouped by status in a 4-column grid.
// Requirements: 11.1–11.5, 13.1–13.6

import { useEffect, useState } from 'react'
import KanbanColumn from '../components/KanbanColumn'
import RaiseRequestModal from '../components/RaiseRequestModal'
import { listMaintenanceRequests, updateMaintenanceStatus } from '../services/maintenanceService'
import { getCurrentUserRole } from '../services/authService'
import { listAssets } from '../services/assetService'
import type {
  Asset,
  AssetWithCategory,
  MaintenanceRequest,
  MaintenanceRequestWithDetails,
  MaintenanceStatus,
  UserRole,
} from '../types/index'

// ─── Component ────────────────────────────────────────────────────────────────

export default function MaintenanceBoard() {
  const [requests, setRequests] = useState<MaintenanceRequestWithDetails[]>([])
  const [currentUserRole, setCurrentUserRole] = useState<UserRole | null>(null)
  const [assets, setAssets] = useState<Asset[]>([])
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // ── Initial data fetch ──────────────────────────────────────────────────────

  useEffect(() => {
    async function fetchData() {
      setLoading(true)
      setError(null)
      try {
        const [fetchedRequests, fetchedRole, fetchedAssets] = await Promise.all([
          listMaintenanceRequests(),
          getCurrentUserRole(),
          listAssets() as Promise<AssetWithCategory[]>,
        ])
        setRequests(fetchedRequests)
        setCurrentUserRole(fetchedRole)
        setAssets(fetchedAssets)
      } catch {
        setError('Failed to load maintenance requests. Please refresh and try again.')
      } finally {
        setLoading(false)
      }
    }

    void fetchData()
  }, [])

  // ── Derived columns (filter from local state) ────────────────────────────────

  const pendingRequests = requests.filter((r) => r.status === 'Pending')
  const approvedRequests = requests.filter((r) => r.status === 'Approved')
  const inProgressRequests = requests.filter((r) => r.status === 'In Progress')
  const resolvedRequests = requests.filter((r) => r.status === 'Resolved')

  // ── Status change handler ────────────────────────────────────────────────────

  async function handleStatusChange(
    id: string,
    status: MaintenanceStatus,
    technicianName?: string
  ): Promise<void> {
    try {
      await updateMaintenanceStatus(id, status, technicianName)
      const updated = await listMaintenanceRequests()
      setRequests(updated)
    } catch {
      // Silently fail — card will remain in its current position
    }
  }

  // ── Modal success handler ────────────────────────────────────────────────────

  async function handleRaiseSuccess(_newRequest: MaintenanceRequest): Promise<void> {
    // Re-fetch so the join populates asset_tag and requested_by_name correctly
    setIsModalOpen(false)
    try {
      const updated = await listMaintenanceRequests()
      setRequests(updated)
    } catch {
      // Silently ignore — board still shows existing requests
    }
  }

  // ── Effective role (never null for KanbanColumn) ─────────────────────────────

  const effectiveRole: UserRole = currentUserRole ?? 'Employee'

  // ── Render ───────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <main style={styles.page}>
        <p style={styles.statusMessage}>Loading maintenance board…</p>
      </main>
    )
  }

  if (error) {
    return (
      <main style={styles.page}>
        <p role="alert" style={styles.errorMessage}>
          {error}
        </p>
      </main>
    )
  }

  return (
    <main style={styles.page}>
      {/* Page header */}
      <div style={styles.header}>
        <h1 style={styles.title}>Maintenance Board</h1>
        <button
          type="button"
          style={styles.raiseBtn}
          onClick={() => setIsModalOpen(true)}
        >
          + Raise Request
        </button>
      </div>

      {/* Kanban grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '1rem',
        }}
      >
        <KanbanColumn
          title="Pending"
          requests={pendingRequests}
          currentUserRole={effectiveRole}
          onStatusChange={handleStatusChange}
        />
        <KanbanColumn
          title="Approved"
          requests={approvedRequests}
          currentUserRole={effectiveRole}
          onStatusChange={handleStatusChange}
        />
        <KanbanColumn
          title="In Progress"
          requests={inProgressRequests}
          currentUserRole={effectiveRole}
          onStatusChange={handleStatusChange}
        />
        <KanbanColumn
          title="Resolved"
          requests={resolvedRequests}
          currentUserRole={effectiveRole}
          onStatusChange={handleStatusChange}
        />
      </div>

      {/* Raise Request modal */}
      <RaiseRequestModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={handleRaiseSuccess}
        assets={assets}
      />
    </main>
  )
}

// ─── Inline Styles ────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  page: {
    padding: '1.5rem 2rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '1.25rem',
    minHeight: '100vh',
    backgroundColor: 'transparent',
    color: 'var(--text-primary)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: '0.75rem',
  },
  title: {
    margin: 0,
    fontSize: '1.4rem',
    fontWeight: 700,
    color: 'var(--text-primary)',
  },
  raiseBtn: {
    padding: '0.6rem 1.25rem',
    fontSize: '0.9rem',
    fontWeight: 600,
    backgroundColor: 'transparent',
    color: 'var(--text-primary)',
    border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-pill)',
    cursor: 'pointer',
    transition: 'var(--transition-all)',
  },
  statusMessage: {
    margin: 0,
    fontSize: '0.95rem',
    color: 'var(--text-secondary)',
  },
  errorMessage: {
    margin: 0,
    padding: '0.75rem 1rem',
    fontSize: '0.9rem',
    color: 'var(--error)',
    backgroundColor: 'var(--error-bg)',
    border: '1px solid var(--error)',
    borderRadius: 'var(--radius-card)',
  },
}
