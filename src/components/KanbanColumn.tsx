// Single Kanban column for the Maintenance board.
// Renders a titled column containing a MaintenanceCard for each request.
// Requirements: 10.1, 10.2, 10.3

import type { MaintenanceRequestWithDetails, MaintenanceStatus, UserRole } from '../types/index'
import MaintenanceCard from './MaintenanceCard'

// ─── Props ────────────────────────────────────────────────────────────────────

interface KanbanColumnProps {
  title: string
  requests: MaintenanceRequestWithDetails[]
  currentUserRole: UserRole
  onStatusChange: (id: string, status: MaintenanceStatus, technicianName?: string) => void
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function KanbanColumn({ title, requests, currentUserRole, onStatusChange }: KanbanColumnProps) {
  return (
    <div style={styles.column}>
      {/* Column header */}
      <div style={styles.header}>
        <span style={styles.title}>{title}</span>
        <span style={styles.count}>{requests.length}</span>
      </div>

      {/* Cards */}
      <div style={styles.cardList}>
        {requests.length === 0 ? (
          <p style={styles.emptyMessage}>No requests</p>
        ) : (
          requests.map((request) => (
            <MaintenanceCard
              key={request.id}
              request={request}
              currentUserRole={currentUserRole}
              onStatusChange={onStatusChange}
            />
          ))
        )}
      </div>
    </div>
  )
}

// ─── Inline Styles ────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  column: {
    flex: '1 1 220px',
    minWidth: '200px',
    maxWidth: '320px',
    backgroundColor: '#f9fafb',
    border: '1px solid #e5e7eb',
    borderRadius: '10px',
    display: 'flex',
    flexDirection: 'column',
    gap: '0',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0.65rem 0.9rem',
    borderBottom: '1px solid #e5e7eb',
    backgroundColor: '#f3f4f6',
  },
  title: {
    fontSize: '0.85rem',
    fontWeight: 700,
    color: '#111827',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
  },
  count: {
    fontSize: '0.78rem',
    fontWeight: 600,
    backgroundColor: '#e5e7eb',
    color: '#374151',
    borderRadius: '999px',
    padding: '0.1rem 0.55rem',
  },
  cardList: {
    padding: '0.75rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.6rem',
    overflowY: 'auto',
    flex: 1,
  },
  emptyMessage: {
    margin: 0,
    fontSize: '0.8rem',
    color: '#9ca3af',
    textAlign: 'center',
    padding: '1rem 0',
  },
}
