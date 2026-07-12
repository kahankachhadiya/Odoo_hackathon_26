// Dashboard screen — KPI cards, overdue banner, recent activity feed.
// Requirements: 9.1–9.8, 10.1–10.4, 11.1–11.4, 18.3

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { ActivityLog } from '../types'
import { getDashboardKPIs, getOverdueCount } from '../services/dashboardService'
import { getRecentActivity } from '../services/activityService'

// ─── State types ──────────────────────────────────────────────────────────────

interface DashboardState {
  kpis: (number | null)[]
  overdueCount: number
  activityLogs: ActivityLog[]
  kpisLoading: boolean
  overdueLoading: boolean
  activityLoading: boolean
  activityError: boolean
}

// ─── KPI card metadata ────────────────────────────────────────────────────────

const KPI_LABELS: string[] = [
  'Total Assets Available',
  'Total Assets Allocated',
  'Active Bookings Today',
  'Pending Maintenance',
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatActivityDate(isoString: string): string {
  return new Date(isoString).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface KpiCardProps {
  label: string
  value: number | null
  loading: boolean
}

function KpiCard({ label, value, loading }: KpiCardProps) {
  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: '0.75rem',
        padding: '1.5rem',
        minWidth: '180px',
        flex: '1 1 180px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.07)',
      }}
    >
      <p
        style={{
          margin: '0 0 0.5rem',
          fontSize: '0.8rem',
          fontWeight: 600,
          color: '#6b7280',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}
      >
        {label}
      </p>
      {loading ? (
        <div
          aria-label="Loading"
          style={{
            height: '2rem',
            background: '#f3f4f6',
            borderRadius: '0.375rem',
            animation: 'pulse 1.5s ease-in-out infinite',
          }}
        />
      ) : (
        <p
          style={{
            margin: 0,
            fontSize: '2rem',
            fontWeight: 700,
            color: '#111827',
          }}
        >
          {value === null ? '--' : value}
        </p>
      )}
    </div>
  )
}

// ─── Dashboard page ───────────────────────────────────────────────────────────

export default function Dashboard() {
  const [state, setState] = useState<DashboardState>({
    kpis: [null, null, null, null],
    overdueCount: 0,
    activityLogs: [],
    kpisLoading: true,
    overdueLoading: true,
    activityLoading: true,
    activityError: false,
  })

  useEffect(() => {
    // Fire all three fetches concurrently
    const kpiPromise = getDashboardKPIs()
      .then((data) => {
        setState((prev) => ({
          ...prev,
          kpis: [
            data.totalAvailableAssets,
            data.totalAllocatedAssets,
            data.activeBookingsToday,
            data.pendingMaintenance,
          ],
          kpisLoading: false,
        }))
      })
      .catch(() => {
        setState((prev) => ({
          ...prev,
          kpis: [null, null, null, null],
          kpisLoading: false,
        }))
      })

    const overduePromise = getOverdueCount().then((count) => {
      setState((prev) => ({
        ...prev,
        overdueCount: count,
        overdueLoading: false,
      }))
    })

    const activityPromise = getRecentActivity(5)
      .then((logs) => {
        setState((prev) => ({
          ...prev,
          activityLogs: logs,
          activityLoading: false,
        }))
      })
      .catch(() => {
        setState((prev) => ({
          ...prev,
          activityLoading: false,
          activityError: true,
        }))
      })

    // No cleanup needed — state updates on unmounted components are harmless
    // in React 18+ and these are fire-and-forget
    void kpiPromise
    void overduePromise
    void activityPromise
  }, [])

  const {
    kpis,
    overdueCount,
    activityLogs,
    kpisLoading,
    activityLoading,
    activityError,
  } = state

  return (
    <main style={{ padding: '2rem', maxWidth: '960px', margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}>
      {/* Page header */}
      <h1 style={{ margin: '0 0 0.25rem', fontSize: '1.75rem', fontWeight: 700, color: '#111827' }}>
        Dashboard
      </h1>
      <p style={{ margin: '0 0 2rem', color: '#6b7280' }}>
        Overview of your asset management activity.
      </p>

      {/* Navigation */}
      <nav
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.75rem',
          marginBottom: '2rem',
        }}
      >
        {[
          { to: '/assets', label: 'Asset Directory' },
          { to: '/allocations', label: 'Allocation & Transfer' },
          { to: '/bookings', label: 'Resource Booking' },
          { to: '/maintenance', label: 'Maintenance Board' },
          { to: '/reports', label: 'Reports & Analytics' },
          { to: '/activity-logs', label: 'Activity Logs' },
        ].map(({ to, label }) => (
          <Link
            key={to}
            to={to}
            style={{
              padding: '0.4rem 0.85rem',
              borderRadius: '0.5rem',
              background: '#f3f4f6',
              color: '#374151',
              textDecoration: 'none',
              fontSize: '0.875rem',
              fontWeight: 500,
            }}
          >
            {label}
          </Link>
        ))}
      </nav>

      {/* Overdue alert banner — only rendered when overdueCount > 0 */}
      {overdueCount > 0 && (
        <div
          role="alert"
          style={{
            background: '#fee2e2',
            borderLeft: '4px solid #ef4444',
            borderRadius: '0.5rem',
            padding: '0.875rem 1rem',
            marginBottom: '1.5rem',
            color: '#991b1b',
            fontWeight: 500,
          }}
        >
          {overdueCount} asset(s) overdue for return — flagged for follow-up
        </div>
      )}

      {/* KPI cards */}
      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ margin: '0 0 1rem', fontSize: '1rem', fontWeight: 600, color: '#374151' }}>
          Key Metrics
        </h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem' }}>
          {KPI_LABELS.map((label, i) => (
            <KpiCard
              key={label}
              label={label}
              value={kpis[i] ?? null}
              loading={kpisLoading}
            />
          ))}
        </div>
      </section>

      {/* Recent activity feed */}
      <section>
        <h2 style={{ margin: '0 0 1rem', fontSize: '1rem', fontWeight: 600, color: '#374151' }}>
          Recent Activity
        </h2>
        <div
          style={{
            background: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: '0.75rem',
            overflow: 'hidden',
            boxShadow: '0 1px 3px rgba(0,0,0,0.07)',
          }}
        >
          {activityLoading ? (
            <div style={{ padding: '1.5rem', color: '#9ca3af' }}>Loading activity…</div>
          ) : activityError ? (
            <div style={{ padding: '1.5rem', color: '#ef4444' }}>Could not load activity</div>
          ) : activityLogs.length === 0 ? (
            <div style={{ padding: '1.5rem', color: '#9ca3af' }}>No recent activity</div>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {activityLogs.map((log, idx) => (
                <li
                  key={log.id}
                  style={{
                    padding: '0.875rem 1.25rem',
                    borderBottom: idx < activityLogs.length - 1 ? '1px solid #f3f4f6' : 'none',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    gap: '1rem',
                  }}
                >
                  <span style={{ color: '#374151', fontSize: '0.9rem' }}>{log.message}</span>
                  <span
                    style={{
                      color: '#9ca3af',
                      fontSize: '0.8rem',
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                    }}
                  >
                    {formatActivityDate(log.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </main>
  )
}
