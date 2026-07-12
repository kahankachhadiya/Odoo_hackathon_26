// Card component that displays a single maintenance request.
// Shows status-appropriate action buttons only to Asset Managers / Admins.
// Requirements: 11.1, 11.2, 12.1–12.9

import { useState } from 'react'
import type { MaintenanceRequestWithDetails, MaintenanceStatus, UserRole } from '../types/index'
import { isAssetManager } from '../utils/roleUtils'

// ─── Props ────────────────────────────────────────────────────────────────────

interface MaintenanceCardProps {
  request: MaintenanceRequestWithDetails
  currentUserRole: UserRole
  onStatusChange: (id: string, status: MaintenanceStatus, technicianName?: string) => void
}

// ─── Priority badge helpers ───────────────────────────────────────────────────

function priorityBadgeStyle(priority: MaintenanceRequestWithDetails['priority']): React.CSSProperties {
  switch (priority) {
    case 'High':
      return { backgroundColor: '#fef2f2', color: '#b91c1c', border: '1px solid #fca5a5' }
    case 'Medium':
      return { backgroundColor: '#fffbeb', color: '#b45309', border: '1px solid #fcd34d' }
    case 'Low':
    default:
      return { backgroundColor: '#f0fdf4', color: '#166534', border: '1px solid #86efac' }
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function MaintenanceCard({ request, currentUserRole, onStatusChange }: MaintenanceCardProps) {
  const [technicianName, setTechnicianName] = useState('')

  const canManage = isAssetManager(currentUserRole)

  function handleApprove() {
    onStatusChange(request.id, 'Approved')
  }

  function handleReject() {
    onStatusChange(request.id, 'Rejected')
  }

  function handleStartWork() {
    onStatusChange(request.id, 'In Progress', technicianName.trim() || undefined)
    setTechnicianName('')
  }

  function handleResolve() {
    onStatusChange(request.id, 'Resolved')
  }

  return (
    <div style={styles.card}>
      {/* Header row: asset tag + priority badge */}
      <div style={styles.header}>
        <span style={styles.assetTag}>{request.asset_tag}</span>
        <span style={{ ...styles.priorityBadge, ...priorityBadgeStyle(request.priority) }}>
          {request.priority}
        </span>
      </div>

      {/* Issue description */}
      <p style={styles.description}>{request.issue_description}</p>

      {/* Requested by */}
      <p style={styles.meta}>
        Raised by: <strong>{request.requested_by_name ?? 'Unknown'}</strong>
      </p>

      {/* Technician (if assigned) */}
      {request.technician_name && (
        <p style={styles.meta}>
          Technician: <strong>{request.technician_name}</strong>
        </p>
      )}

      {/* Action buttons — visible to Asset Manager / Admin only */}
      {canManage && (
        <div style={styles.actions}>
          {request.status === 'Pending' && (
            <>
              <button
                style={{ ...styles.btn, ...styles.btnApprove }}
                onClick={handleApprove}
                type="button"
              >
                Approve
              </button>
              <button
                style={{ ...styles.btn, ...styles.btnReject }}
                onClick={handleReject}
                type="button"
              >
                Reject
              </button>
            </>
          )}

          {request.status === 'Approved' && (
            <div style={styles.startWorkGroup}>
              <input
                type="text"
                placeholder="Technician name (optional)"
                value={technicianName}
                onChange={(e) => setTechnicianName(e.target.value)}
                style={styles.techInput}
                aria-label="Technician name"
              />
              <button
                style={{ ...styles.btn, ...styles.btnStartWork }}
                onClick={handleStartWork}
                type="button"
              >
                Start Work
              </button>
            </div>
          )}

          {request.status === 'In Progress' && (
            <button
              style={{ ...styles.btn, ...styles.btnResolve }}
              onClick={handleResolve}
              type="button"
            >
              Resolve
            </button>
          )}

          {/* Resolved: no action buttons */}
        </div>
      )}
    </div>
  )
}

// ─── Inline Styles ────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  card: {
    backgroundColor: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    padding: '0.875rem 1rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
    boxShadow: '0 1px 3px rgba(0,0,0,0.07)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '0.5rem',
  },
  assetTag: {
    fontSize: '0.8rem',
    fontWeight: 700,
    letterSpacing: '0.04em',
    color: '#374151',
    textTransform: 'uppercase' as const,
  },
  priorityBadge: {
    fontSize: '0.72rem',
    fontWeight: 600,
    padding: '0.15rem 0.55rem',
    borderRadius: '999px',
  },
  description: {
    margin: 0,
    fontSize: '0.875rem',
    color: '#374151',
    lineHeight: '1.45',
  },
  meta: {
    margin: 0,
    fontSize: '0.78rem',
    color: '#6b7280',
  },
  actions: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '0.5rem',
    marginTop: '0.25rem',
  },
  startWorkGroup: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '0.4rem',
  },
  techInput: {
    padding: '0.4rem 0.6rem',
    fontSize: '0.83rem',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    outline: 'none',
    color: '#111',
    width: '100%',
    boxSizing: 'border-box' as const,
  },
  btn: {
    padding: '0.4rem 0.85rem',
    fontSize: '0.82rem',
    fontWeight: 600,
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    width: '100%',
  },
  btnApprove: {
    backgroundColor: '#16a34a',
    color: '#ffffff',
  },
  btnReject: {
    backgroundColor: '#dc2626',
    color: '#ffffff',
  },
  btnStartWork: {
    backgroundColor: '#2563eb',
    color: '#ffffff',
  },
  btnResolve: {
    backgroundColor: '#7c3aed',
    color: '#ffffff',
  },
}
