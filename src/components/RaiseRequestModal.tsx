// Modal for raising a new maintenance request.
// Submits to maintenanceService.createMaintenanceRequest and calls onSuccess on completion.
// Requirements: 13.1–13.6

import { useState } from 'react'
import { createMaintenanceRequest } from '../services/maintenanceService'
import type { Asset, MaintenanceRequest, MaintenancePriority } from '../types/index'

// ─── Props ────────────────────────────────────────────────────────────────────

interface RaiseRequestModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: (request: MaintenanceRequest) => void
  assets: Asset[]
}

// ─── Form state ───────────────────────────────────────────────────────────────

interface FormState {
  assetId: string
  issueDescription: string
  priority: MaintenancePriority
}

const emptyForm = (firstAssetId: string): FormState => ({
  assetId: firstAssetId,
  issueDescription: '',
  priority: 'Medium',
})

// ─── Component ────────────────────────────────────────────────────────────────

export default function RaiseRequestModal({ isOpen, onClose, onSuccess, assets }: RaiseRequestModalProps) {
  const [form, setForm] = useState<FormState>(() => emptyForm(assets[0]?.id ?? ''))
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Keep modal unmounted when closed to reset local state
  if (!isOpen) return null

  function handleChange(
    e: React.ChangeEvent<HTMLSelectElement | HTMLTextAreaElement>
  ) {
    const { name, value } = e.target
    setForm((prev) => ({ ...prev, [name]: value }))
    setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!form.assetId) {
      setError('Please select an asset.')
      return
    }
    if (form.issueDescription.trim().length === 0) {
      setError('Issue description is required.')
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      const newRequest = await createMaintenanceRequest({
        asset_id: form.assetId,
        issue_description: form.issueDescription.trim(),
        priority: form.priority,
      })
      onSuccess(newRequest)
      onClose()
      // Reset form for next open — will be re-initialised when modal reopens
      setForm(emptyForm(assets[0]?.id ?? ''))
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        style={styles.backdrop}
        onClick={onClose}
        role="presentation"
        aria-hidden="true"
      />

      {/* Dialog */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="raise-request-title"
        style={styles.dialog}
      >
        <div style={styles.dialogHeader}>
          <h2 id="raise-request-title" style={styles.dialogTitle}>
            Raise Maintenance Request
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            style={styles.closeBtn}
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} noValidate style={styles.form}>
          {/* Asset selector */}
          <div style={styles.fieldGroup}>
            <label htmlFor="rm-asset" style={styles.label}>
              Asset <span style={styles.required}>*</span>
            </label>
            <select
              id="rm-asset"
              name="assetId"
              value={form.assetId}
              onChange={handleChange}
              required
              style={styles.select}
            >
              {assets.length === 0 && (
                <option value="">No assets available</option>
              )}
              {assets.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.name} ({asset.tag})
                </option>
              ))}
            </select>
          </div>

          {/* Issue description */}
          <div style={styles.fieldGroup}>
            <label htmlFor="rm-description" style={styles.label}>
              Issue Description <span style={styles.required}>*</span>
            </label>
            <textarea
              id="rm-description"
              name="issueDescription"
              value={form.issueDescription}
              onChange={handleChange}
              rows={4}
              required
              placeholder="Describe the issue…"
              style={styles.textarea}
              aria-required="true"
            />
          </div>

          {/* Priority selector */}
          <div style={styles.fieldGroup}>
            <label htmlFor="rm-priority" style={styles.label}>
              Priority
            </label>
            <select
              id="rm-priority"
              name="priority"
              value={form.priority}
              onChange={handleChange}
              style={styles.select}
            >
              <option value="Low">Low</option>
              <option value="Medium">Medium</option>
              <option value="High">High</option>
            </select>
          </div>

          {/* Inline error */}
          {error && (
            <p role="alert" style={styles.errorMessage}>
              {error}
            </p>
          )}

          {/* Footer buttons */}
          <div style={styles.footer}>
            <button
              type="button"
              onClick={onClose}
              style={styles.cancelBtn}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || assets.length === 0}
              style={
                submitting || assets.length === 0
                  ? { ...styles.submitBtn, ...styles.submitBtnDisabled }
                  : styles.submitBtn
              }
            >
              {submitting ? 'Submitting…' : 'Submit Request'}
            </button>
          </div>
        </form>
      </div>
    </>
  )
}

// ─── Inline Styles ────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    zIndex: 40,
  },
  dialog: {
    position: 'fixed',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    zIndex: 50,
    backgroundColor: '#ffffff',
    borderRadius: '10px',
    boxShadow: '0 20px 40px rgba(0,0,0,0.18)',
    width: '100%',
    maxWidth: '480px',
    maxHeight: '90vh',
    overflowY: 'auto',
    boxSizing: 'border-box',
  },
  dialogHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '1rem 1.25rem 0.75rem',
    borderBottom: '1px solid #e5e7eb',
  },
  dialogTitle: {
    margin: 0,
    fontSize: '1rem',
    fontWeight: 700,
    color: '#111827',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    fontSize: '1rem',
    cursor: 'pointer',
    color: '#6b7280',
    padding: '0.2rem 0.4rem',
    borderRadius: '4px',
  },
  form: {
    padding: '1rem 1.25rem 1.25rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.85rem',
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
  select: {
    padding: '0.5rem 0.75rem',
    fontSize: '0.9rem',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    outline: 'none',
    color: '#111',
    backgroundColor: '#ffffff',
    width: '100%',
    boxSizing: 'border-box',
  },
  textarea: {
    padding: '0.5rem 0.75rem',
    fontSize: '0.9rem',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    outline: 'none',
    color: '#111',
    resize: 'vertical',
    width: '100%',
    boxSizing: 'border-box',
    fontFamily: 'inherit',
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
  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '0.6rem',
    marginTop: '0.25rem',
  },
  cancelBtn: {
    padding: '0.5rem 1rem',
    fontSize: '0.875rem',
    fontWeight: 500,
    backgroundColor: '#f3f4f6',
    color: '#374151',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  submitBtn: {
    padding: '0.5rem 1.1rem',
    fontSize: '0.875rem',
    fontWeight: 600,
    backgroundColor: '#2563eb',
    color: '#ffffff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  submitBtnDisabled: {
    backgroundColor: '#93c5fd',
    cursor: 'not-allowed',
  },
}
