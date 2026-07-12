// Dashboard screen — KPI cards, overdue banner, recent activity feed.
// Requirements: 9.1–9.8, 10.1–10.4, 11.1–11.4, 18.3

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { ActivityLog } from '../types'
import { getDashboardKPIs, getOverdueCount } from '../services/dashboardService'
import { getRecentActivity } from '../services/activityService'
import './Dashboard.css'

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
  'Available',
  'Allocated',
  'Active Bookings',
  'Maintenance',
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
    <div className="kpi-card">
      <div className="kpi-label">{label}</div>
      {loading ? (
        <div className="kpi-loading" />
      ) : (
        <div className="kpi-value">{value === null ? '--' : value}</div>
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
    <div className="dashboard-page">
      <div className="dashboard-header">
        <h1>Today's Overview</h1>
      </div>

      <div className="overview-grid">
        {KPI_LABELS.map((label, i) => (
          <KpiCard
            key={label}
            label={label}
            value={kpis[i] ?? null}
            loading={kpisLoading}
          />
        ))}
      </div>

      {/* Overdue alert banner */}
      {overdueCount > 0 && (
        <div className="overdue-alert" role="alert">
          <span>{overdueCount} assets overdue for return - flagged for follow-up</span>
        </div>
      )}

      {/* Navigation matching mockup buttons */}
      <div className="action-buttons">
        <Link to="/assets" className="action-btn primary">+ register asset</Link>
        <Link to="/bookings" className="action-btn">Book resource</Link>
        <Link to="/maintenance" className="action-btn">Raise requests</Link>
      </div>

      {/* Recent activity feed */}
      <div className="recent-activity">
        <h2>Recent Activity</h2>
        
        {activityLoading ? (
          <div className="empty-state">Loading activity…</div>
        ) : activityError ? (
          <div className="empty-state" style={{ color: 'var(--error)' }}>Could not load activity</div>
        ) : activityLogs.length === 0 ? (
          <div className="empty-state">No recent activity</div>
        ) : (
          <div className="activity-list">
            {activityLogs.map((log) => (
              <div key={log.id} className="activity-item">
                <span className="activity-message">{log.message}</span>
                <span className="activity-date">{formatActivityDate(log.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
