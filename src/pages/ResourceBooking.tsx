// Screen 6 — Resource Booking page.
// Lets any authenticated employee pick a bookable asset, view today's schedule,
// and submit a new booking. The BookingForm handles overlap errors inline.
// Requirements: 7, 8, 9

import { useEffect, useState } from 'react'
import { listBookableAssets, getTodaysBookings, syncBookingStatuses } from '../services/bookingService'
import BookableAssetSelect from '../components/BookableAssetSelect'
import BookingForm from '../components/BookingForm'
import ScheduleView from '../components/ScheduleView'
import type { Asset, Booking } from '../types/index'

// ─── Component ────────────────────────────────────────────────────────────────

export default function ResourceBooking() {
  const [bookableAssets, setBookableAssets] = useState<Asset[]>([])
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null)
  const [todaysBookings, setTodaysBookings] = useState<Booking[]>([])
  const [loadingAssets, setLoadingAssets] = useState(true)
  const [loadingBookings, setLoadingBookings] = useState(false)

  // ── Fetch bookable assets on mount ────────────────────────────────────────

  useEffect(() => {
    void fetchBookableAssets()
  }, [])

  async function fetchBookableAssets() {
    setLoadingAssets(true)
    try {
      const assets = await listBookableAssets()
      console.log('[ResourceBooking] bookable assets fetched:', assets)
      setBookableAssets(assets)
    } catch (err) {
      // Per requirements 7.2: on fetch failure, render selector in empty state
      // without displaying an error — just leave bookableAssets as []
      console.error('[ResourceBooking] listBookableAssets error:', err)
      setBookableAssets([])
    } finally {
      setLoadingAssets(false)
    }
  }

  // ── Fetch today's bookings whenever the selected asset changes ────────────

  useEffect(() => {
    if (!selectedAsset) {
      setTodaysBookings([])
      return
    }

    void fetchTodaysBookings(selectedAsset.id)
  }, [selectedAsset])

  async function fetchTodaysBookings(assetId: string) {
    setLoadingBookings(true)
    try {
      // Sync booking statuses first (Upcoming→Ongoing→Completed) and update asset.status
      await syncBookingStatuses(assetId)
      const bookings = await getTodaysBookings(assetId)
      setTodaysBookings(bookings)
    } catch {
      setTodaysBookings([])
    } finally {
      setLoadingBookings(false)
    }
  }

  // ── Optimistic append on booking success ──────────────────────────────────

  function handleBookingSuccess(newBooking: Booking) {
    setTodaysBookings((prev) => [...prev, newBooking])
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <main style={styles.page}>
      {/* Page header */}
      <h1 style={styles.heading}>Resource Booking</h1>
      <p style={styles.subtitle}>
        Reserve a shared asset for a specific time window. Pick an asset below to get started.
      </p>

      <div style={styles.layout}>
        {/* ── Left panel: selector + form ──────────────────────────────── */}
        <section style={styles.leftPanel} aria-label="Booking form">
          {/* Asset selector */}
          <div style={styles.card}>
            <h2 style={styles.cardHeading}>Select an Asset</h2>
            {loadingAssets ? (
              <p style={styles.stateText}>Loading bookable assets…</p>
            ) : (
              <BookableAssetSelect
                assets={bookableAssets}
                onSelect={setSelectedAsset}
              />
            )}
          </div>

          {/* Booking form */}
          <div style={styles.card}>
            <h2 style={styles.cardHeading}>Booking Details</h2>

            {selectedAsset ? (
              <div>
                <p style={styles.selectedAssetLabel}>
                  Booking for:{' '}
                  <strong>
                    {selectedAsset.tag} — {selectedAsset.name}
                  </strong>
                </p>
                <BookingForm
                  selectedAsset={selectedAsset}
                  onSuccess={handleBookingSuccess}
                />
              </div>
            ) : (
              <p style={styles.promptText}>
                Please select an asset to view booking options
              </p>
            )}
          </div>
        </section>

        {/* ── Right panel: schedule view ───────────────────────────────── */}
        <section style={styles.rightPanel} aria-label="Today's schedule">
          <div style={styles.card}>
            {selectedAsset ? (
              <>
                {loadingBookings ? (
                  <p style={styles.stateText}>Loading schedule…</p>
                ) : (
                  <ScheduleView bookings={todaysBookings} />
                )}
              </>
            ) : (
              <>
                <h3 style={styles.scheduleHeading}>Today's Schedule</h3>
                <p style={styles.promptText}>
                  Select an asset to see its schedule for today.
                </p>
              </>
            )}
          </div>
        </section>
      </div>
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
  heading: {
    margin: '0 0 0.25rem',
    fontSize: '1.75rem',
    fontWeight: 700,
    color: 'var(--text-primary)',
  },
  subtitle: {
    margin: '0 0 1.5rem',
    fontSize: '0.95rem',
    color: 'var(--text-secondary)',
  },
  layout: {
    display: 'flex',
    gap: '1.5rem',
    alignItems: 'flex-start',
    flexWrap: 'wrap',
  },
  leftPanel: {
    flex: '1 1 340px',
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
  },
  rightPanel: {
    flex: '1 1 340px',
  },
  card: {
    backgroundColor: 'var(--bg-primary)',
    border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-card)',
    padding: '1.25rem',
  },
  cardHeading: {
    margin: '0 0 0.875rem',
    fontSize: '1rem',
    fontWeight: 600,
    color: 'var(--text-primary)',
  },
  scheduleHeading: {
    margin: '0 0 0.75rem',
    fontSize: '1rem',
    fontWeight: 600,
    color: 'var(--text-primary)',
  },
  selectedAssetLabel: {
    margin: '0 0 0.875rem',
    fontSize: '0.875rem',
    color: 'var(--text-secondary)',
  },
  stateText: {
    margin: 0,
    fontSize: '0.9rem',
    color: 'var(--text-secondary)',
  },
  promptText: {
    margin: 0,
    fontSize: '0.9rem',
    color: 'var(--text-secondary)',
    fontStyle: 'italic',
  },
}
