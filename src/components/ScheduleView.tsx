// Read-only schedule view showing today's bookings for a selected asset,
// sorted by start time ascending.
// Requirements: 9.1, 9.2, 9.3

import type { Booking } from '../types/index'

// ─── Props ────────────────────────────────────────────────────────────────────

interface ScheduleViewProps {
  bookings: Booking[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ScheduleView({ bookings }: ScheduleViewProps) {
  const sorted = [...bookings].sort(
    (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
  )

  return (
    <section style={styles.section} aria-label="Today's schedule">
      <h3 style={styles.heading}>Today's Schedule</h3>

      {sorted.length === 0 ? (
        <p data-testid="no-bookings-message" style={styles.emptyMessage}>
          No bookings today
        </p>
      ) : (
        <ol style={styles.list}>
          {sorted.map((booking) => (
            <li
              key={booking.id}
              data-testid="booking-item"
              style={styles.listItem}
            >
              <span style={styles.bookingTitle}>{booking.title}</span>
              <span style={styles.bookingTime}>
                {formatTime(booking.start_time)} to {formatTime(booking.end_time)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

// ─── Inline Styles ────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  section: {
    marginTop: '1rem',
  },
  heading: {
    margin: '0 0 0.75rem',
    fontSize: '1rem',
    fontWeight: 600,
    color: 'var(--text-primary)',
  },
  emptyMessage: {
    margin: 0,
    fontSize: '0.9rem',
    color: 'var(--text-secondary)',
    fontStyle: 'italic',
  },
  list: {
    margin: 0,
    padding: '0 0 0 1.25rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  },
  listItem: {
    fontSize: '0.9rem',
    color: 'var(--text-primary)',
    display: 'flex',
    gap: '0.5rem',
    alignItems: 'baseline',
  },
  bookingTitle: {
    fontWeight: 600,
    color: 'var(--text-primary)',
  },
  bookingTime: {
    color: 'var(--text-secondary)',
    fontSize: '0.85rem',
  },
}
