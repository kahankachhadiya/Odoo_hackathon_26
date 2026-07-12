// Categories tab for the Organization Setup screen.
// Renders a data grid of all asset categories and an "Add Category" modal.
// Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import { isNonBlankName } from '../utils/validation'
import type { AssetCategory } from '../types/index'
import type { Json } from '../lib/database.types'

// ─── Component ────────────────────────────────────────────────────────────────

export default function CategoriesTab() {
  const [rows, setRows] = useState<AssetCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)

  // Modal state
  const [modalOpen, setModalOpen] = useState(false)
  const [nameValue, setNameValue] = useState('')
  const [attributesValue, setAttributesValue] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  const [attributesError, setAttributesError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // ── Data fetching ──────────────────────────────────────────────────────────

  const fetchCategories = useCallback(async () => {
    setLoading(true)
    setFetchError(null)

    const { data, error } = await supabase
      .from('asset_categories')
      .select('*')
      .order('name', { ascending: true })

    if (error) {
      setFetchError('Failed to load categories. Please try again.')
      setLoading(false)
      return
    }

    // Cast the DB Json type to AssetCategory's Record<string, unknown> shape.
    // JSONB objects from Postgres are always plain objects at runtime; the cast is safe.
    setRows(
      (data ?? []).map((row) => ({
        ...row,
        attributes: row.attributes as AssetCategory['attributes'],
      }))
    )
    setLoading(false)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchCategories()
  }, [fetchCategories])

  // ── Modal helpers ──────────────────────────────────────────────────────────

  function openModal() {
    setNameValue('')
    setAttributesValue('')
    setNameError(null)
    setAttributesError(null)
    setSubmitError(null)
    setModalOpen(true)
  }

  function closeModal() {
    setModalOpen(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    // Client-side name validation (Requirement 13.6)
    const nameValidation = isNonBlankName(nameValue, 100, 'Category')
    if (!nameValidation.valid) {
      setNameError(nameValidation.error ?? 'Category name is required')
      return
    }

    // Client-side attributes JSON validation (Requirement 13.7)
    let parsedAttributes: Record<string, unknown> | null = null
    if (attributesValue.trim() !== '') {
      try {
        parsedAttributes = JSON.parse(attributesValue) as Record<string, unknown>
      } catch {
        setAttributesError('Attributes must be valid JSON')
        return
      }
    }

    setNameError(null)
    setAttributesError(null)
    setSubmitError(null)
    setSubmitting(true)

    const { error } = await supabase.from('asset_categories').insert({
      name: nameValue.trim(),
      attributes: parsedAttributes as Json | null,
    })

    setSubmitting(false)

    if (error) {
      // Detect duplicate name: Postgres unique constraint violation code 23505
      if (error.code === '23505') {
        setSubmitError('A category with this name already exists')
      } else if (error.code === '42501') {
        // RLS policy violation — user does not have write permission (design.md error table)
        setSubmitError("You don't have permission to perform this action")
      } else {
        console.error('[CategoriesTab] Unexpected insert error:', error)
        setSubmitError('Something went wrong. Please try again.')
      }
      return
    }

    // Success — close modal and refresh grid (Requirement 13.5)
    closeModal()
    void fetchCategories()
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <section style={styles.container}>
      {/* Header row */}
      <div style={styles.headerRow}>
        <h2 style={styles.heading}>Categories</h2>
        <button
          type="button"
          style={styles.addButton}
          onClick={openModal}
        >
          + Add Category
        </button>
      </div>

      {/* Loading / error states */}
      {loading && <p style={styles.stateText}>Loading categories…</p>}
      {!loading && fetchError && <p style={styles.errorText}>{fetchError}</p>}

      {/* Data grid (Requirements 13.1, 13.2) */}
      {!loading && !fetchError && (
        <div style={styles.tableWrapper}>
          <table style={styles.table} aria-label="Categories">
            <thead>
              <tr>
                <th style={styles.th}>Name</th>
                <th style={styles.th}>Attributes</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={2} style={styles.emptyCell}>
                    No categories yet. Click "Add Category" to create one.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} style={styles.tr}>
                    <td style={styles.td}>{row.name}</td>
                    <td style={styles.td}>
                      {row.attributes === null ? (
                        <span style={styles.muted}>—</span>
                      ) : (
                        <span style={styles.attributeCell}>
                          {JSON.stringify(row.attributes)}
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Category modal (Requirements 13.3, 13.4) */}
      {modalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-title"
          style={styles.overlay}
          onClick={(e) => {
            // Dismiss on backdrop click (Requirement 13.8)
            if (e.target === e.currentTarget) closeModal()
          }}
        >
          <div style={styles.modal}>
            <h3 id="modal-title" style={styles.modalTitle}>Add Category</h3>

            <form onSubmit={handleSubmit} noValidate>
              {/* Name field — required */}
              <div style={styles.fieldGroup}>
                <label htmlFor="cat-name" style={styles.label}>
                  Name <span style={styles.required}>*</span>
                </label>
                <input
                  id="cat-name"
                  type="text"
                  maxLength={100}
                  value={nameValue}
                  onChange={(e) => {
                    setNameValue(e.target.value)
                    if (nameError) setNameError(null)
                  }}
                  style={nameError ? { ...styles.input, ...styles.inputError } : styles.input}
                  aria-describedby={nameError ? 'cat-name-error' : undefined}
                  aria-invalid={nameError ? 'true' : 'false'}
                  autoFocus
                />
                {nameError && (
                  <p id="cat-name-error" style={styles.fieldError} role="alert">
                    {nameError}
                  </p>
                )}
              </div>

              {/* Attributes field — optional JSONB textarea */}
              <div style={styles.fieldGroup}>
                <label htmlFor="cat-attributes" style={styles.label}>
                  Attributes
                </label>
                <textarea
                  id="cat-attributes"
                  value={attributesValue}
                  onChange={(e) => {
                    setAttributesValue(e.target.value)
                    if (attributesError) setAttributesError(null)
                  }}
                  style={
                    attributesError
                      ? { ...styles.textarea, ...styles.inputError }
                      : styles.textarea
                  }
                  placeholder='e.g. {"color": "red", "size": "large"}'
                  aria-describedby={attributesError ? 'cat-attributes-error' : undefined}
                  aria-invalid={attributesError ? 'true' : 'false'}
                />
                {attributesError && (
                  <p id="cat-attributes-error" style={styles.fieldError} role="alert">
                    {attributesError}
                  </p>
                )}
              </div>

              {/* Server-side / duplicate-name error */}
              {submitError && (
                <p style={styles.submitError} role="alert">
                  {submitError}
                </p>
              )}

              {/* Actions */}
              <div style={styles.modalActions}>
                <button
                  type="button"
                  style={styles.cancelButton}
                  onClick={closeModal}
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={submitting ? { ...styles.submitButton, opacity: 0.7 } : styles.submitButton}
                  disabled={submitting}
                >
                  {submitting ? 'Saving…' : 'Add Category'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  )
}

// ─── Inline Styles ────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: '0.5rem 0 1.5rem',
  },
  headerRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '1.25rem',
  },
  heading: {
    margin: 0,
    fontSize: '1.125rem',
    fontWeight: 600,
    color: 'var(--text-primary)',
  },
  addButton: {
    padding: '0.6rem 1.25rem',
    fontSize: '0.875rem',
    fontWeight: 600,
    color: 'var(--text-primary)',
    backgroundColor: 'transparent',
    border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-pill)',
    cursor: 'pointer',
    transition: 'var(--transition-all)',
  },
  stateText: {
    color: 'var(--text-secondary)',
    fontSize: '0.9rem',
    padding: '1rem 0',
  },
  errorText: {
    color: 'var(--error)',
    fontSize: '0.9rem',
    padding: '1rem 0',
  },
  tableWrapper: {
    overflowX: 'auto',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '0.9rem',
    color: 'var(--text-primary)',
  },
  th: {
    textAlign: 'left',
    padding: '0.8rem 1rem',
    backgroundColor: 'var(--bg-secondary)',
    borderBottom: '1px solid var(--border-color)',
    fontWeight: 600,
    color: 'var(--text-secondary)',
    whiteSpace: 'nowrap',
  },
  tr: {
    borderBottom: '1px solid var(--border-color)',
  },
  td: {
    padding: '0.8rem 1rem',
    color: 'var(--text-primary)',
    verticalAlign: 'middle',
  },
  emptyCell: {
    padding: '1.5rem 0.75rem',
    color: 'var(--text-secondary)',
    textAlign: 'center',
  },
  muted: {
    color: 'var(--text-secondary)',
  },
  attributeCell: {
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: '300px',
    display: 'inline-block',
    color: 'var(--text-primary)',
  },
  // Modal
  overlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
  },
  modal: {
    backgroundColor: 'var(--bg-primary)',
    borderRadius: 'var(--radius-card)',
    padding: '1.75rem',
    width: '100%',
    maxWidth: '480px',
    border: '1px solid var(--border-color)',
  },
  modalTitle: {
    margin: '0 0 1.25rem',
    fontSize: '1.1rem',
    fontWeight: 700,
    color: 'var(--text-primary)',
  },
  fieldGroup: {
    marginBottom: '1rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.3rem',
  },
  label: {
    fontSize: '0.875rem',
    fontWeight: 500,
    color: 'var(--text-secondary)',
  },
  required: {
    color: 'var(--error)',
    marginLeft: '0.15rem',
  },
  input: {
    padding: '0.8rem 1rem',
    fontSize: '0.9rem',
    border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-pill)',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
    color: 'var(--text-primary)',
    backgroundColor: 'transparent',
  },
  inputError: {
    borderColor: 'var(--error)',
  },
  select: {
    padding: '0.8rem 1rem',
    fontSize: '0.9rem',
    border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-pill)',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
    color: 'var(--text-primary)',
    backgroundColor: 'var(--bg-secondary)',
  },
  textarea: {
    padding: '0.8rem 1rem',
    fontSize: '0.9rem',
    border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-sm)',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box' as const,
    color: 'var(--text-primary)',
    backgroundColor: 'transparent',
    minHeight: '80px',
    resize: 'vertical' as const,
    fontFamily: 'monospace',
  },
  fieldError: {
    margin: 0,
    fontSize: '0.8rem',
    color: 'var(--error)',
  },
  submitError: {
    margin: '0 0 0.75rem',
    padding: '0.6rem 0.75rem',
    fontSize: '0.85rem',
    color: 'var(--error)',
    backgroundColor: 'var(--error-bg)',
    border: '1px solid var(--error)',
    borderRadius: 'var(--radius-card)',
  },
  modalActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '0.75rem',
    marginTop: '1.25rem',
  },
  cancelButton: {
    padding: '0.6rem 1.25rem',
    fontSize: '0.875rem',
    fontWeight: 500,
    color: 'var(--text-primary)',
    backgroundColor: 'transparent',
    border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-pill)',
    cursor: 'pointer',
    transition: 'var(--transition-all)',
  },
  submitButton: {
    padding: '0.6rem 1.25rem',
    fontSize: '0.875rem',
    fontWeight: 600,
    color: 'var(--text-primary)',
    backgroundColor: 'transparent',
    border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-pill)',
    cursor: 'pointer',
    transition: 'var(--transition-all)',
  },
}
