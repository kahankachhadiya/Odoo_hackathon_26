// Controlled form for creating a new asset booking.
// Combines date + time fields into ISO 8601 timestamps before calling the service.
// Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6

import { useState } from 'react'
import { createBooking } from '../services/bookingService'
import { BookingOverlapError } from '../types/index'
import type { Asset, Booking } from '../types/index'

// ─── Props ────────────────────────────────────────────────────────────────────

interface BookingFormProps {
  selectedAsset: Asset | null
  onSuccess: (booking: Booking) => void
}

// ─── Form state ───────────────────────────────────────────────────────────────

interface FormState {
  title: string
  date: string
  startTime: string
  endTime: string
}

const emptyForm: FormState = {
  title: '',
  date: '',
  startTime: '',
  endTime: '',
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function BookingForm({ selectedAsset, onSuccess }: BookingFormProps) {
  const [form, setForm] = useState<FormState>(emptyForm)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const isDisabled = selectedAsset === null

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const { name, value } = e.target
    setForm((prev) => ({ ...prev, [name]: value }))
    // Clear error on any field edit
    setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedAsset) return

    // Build ISO 8601 strings with local timezone offset so the DB stores
    // the correct UTC equivalent (avoids UTC shift on naive timestamps).
    const localOffset = -new Date().getTimezoneOffset() // minutes, positive for UTC+
    const sign = localOffset >= 0 ? '+' : '-'
    const absOffset = Math.abs(localOffset)
    const hh = String(Math.floor(absOffset / 60)).padStart(2, '0')
    const mm = String(absOffset % 60).padStart(2, '0')
    const tzSuffix = `${sign}${hh}:${mm}`

    const start_time = `${form.date}T${form.startTime}:00${tzSuffix}`
    const end_time   = `${form.date}T${form.endTime}:00${tzSuffix}`

    setSubmitting(true)
    setError(null)

    try {
      const booking = await createBooking({
        asset_id: selectedAsset.id,
        title: form.title,
        start_time,
        end_time,
      })
      onSuccess(booking)
      setForm(emptyForm)
    } catch (err) {
      if (err instanceof BookingOverlapError) {
        setError('This time slot is already booked.')
      } else {
        setError('Something went wrong. Please try again.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate style={styles.form}>
      {/* Title */}
      <div style={styles.fieldGroup}>
        <label htmlFor="booking-title" style={styles.label}>
          Title <span style={styles.required}>*</span>
        </label>
        <input
          id="booking-title"
          type="text"
          name="title"
          value={form.title}
          onChange={handleChange}
          maxLength={255}
          required
          disabled={isDisabled}
          style={isDisabled ? { ...styles.input, ...styles.inputDisabled } : styles.input}
          aria-required="true"
        />
      </div>

      {/* Date */}
      <div style={styles.fieldGroup}>
        <label htmlFor="booking-date" style={styles.label}>
          Date <span style={styles.required}>*</span>
        </label>
        <input
          id="booking-date"
          type="date"
          name="date"
          value={form.date}
          onChange={handleChange}
          required
          disabled={isDisabled}
          style={isDisabled ? { ...styles.input, ...styles.inputDisabled } : styles.input}
          aria-required="true"
        />
      </div>

      {/* Start Time */}
      <div style={styles.fieldGroup}>
        <label htmlFor="booking-start-time" style={styles.label}>
          Start Time <span style={styles.required}>*</span>
        </label>
        <input
          id="booking-start-time"
          type="time"
          name="startTime"
          value={form.startTime}
          onChange={handleChange}
          required
          disabled={isDisabled}
          style={isDisabled ? { ...styles.input, ...styles.inputDisabled } : styles.input}
          aria-required="true"
        />
      </div>

      {/* End Time */}
      <div style={styles.fieldGroup}>
        <label htmlFor="booking-end-time" style={styles.label}>
          End Time <span style={styles.required}>*</span>
        </label>
        <input
          id="booking-end-time"
          type="time"
          name="endTime"
          value={form.endTime}
          onChange={handleChange}
          required
          disabled={isDisabled}
          style={isDisabled ? { ...styles.input, ...styles.inputDisabled } : styles.input}
          aria-required="true"
        />
      </div>

      {/* Inline error */}
      {error && (
        <p role="alert" style={styles.errorMessage}>
          {error}
        </p>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={isDisabled || submitting}
        style={
          isDisabled || submitting
            ? { ...styles.submitButton, ...styles.submitButtonDisabled }
            : styles.submitButton
        }
      >
        {submitting ? 'Booking…' : 'Confirm Booking'}
      </button>
    </form>
  )
}

// ─── Inline Styles ────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
  },
  fieldGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.3rem',
  },
  label: {
    fontSize: '0.875rem',
    fontWeight: 500,
    color: '#374151',
  },
  required: {
    color: '#dc2626',
    marginLeft: '0.15rem',
  },
  input: {
    padding: '0.5rem 0.75rem',
    fontSize: '0.9rem',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
    color: '#111',
  },
  inputDisabled: {
    backgroundColor: '#f3f4f6',
    color: '#9ca3af',
    cursor: 'not-allowed',
  },
  errorMessage: {
    margin: 0,
    padding: '0.6rem 0.75rem',
    fontSize: '0.85rem',
    color: '#dc2626',
    backgroundColor: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: '6px',
  },
  submitButton: {
    marginTop: '0.25rem',
    padding: '0.55rem 1.25rem',
    fontSize: '0.9rem',
    fontWeight: 600,
    color: '#ffffff',
    backgroundColor: '#2563eb',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    alignSelf: 'flex-start',
  },
  submitButtonDisabled: {
    backgroundColor: '#93c5fd',
    cursor: 'not-allowed',
  },
}
