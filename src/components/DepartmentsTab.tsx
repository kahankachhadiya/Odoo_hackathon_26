// Departments tab for the Organization Setup screen.
// Renders a data grid of all departments and an "Add New Department" modal.
// Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import { isNonBlankName } from '../utils/validation'
import type { Department } from '../types/index'

// ─── Types ────────────────────────────────────────────────────────────────────

interface DepartmentRow {
  id: string
  name: string
  headName: string | null       // resolved from profiles.full_name via head_id
  parentName: string | null     // resolved from departments.name via parent_department_id
  status: 'Active' | 'Inactive'
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function DepartmentsTab() {
  const [rows, setRows] = useState<DepartmentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)

  // Modal state
  const [modalOpen, setModalOpen] = useState(false)
  const [nameValue, setNameValue] = useState('')
  const [parentId, setParentId] = useState<string>('')
  const [headId, setHeadId] = useState<string>('')
  const [nameError, setNameError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Dropdown data
  const [departments, setDepartments] = useState<Department[]>([])
  const [profiles, setProfiles] = useState<{ id: string; full_name: string | null }[]>([])

  // ── Data fetching ──────────────────────────────────────────────────────────

  const fetchDepartments = useCallback(async () => {
    setLoading(true)
    setFetchError(null)

    // Fetch departments with head profile name and parent department name via Supabase joins
    const { data, error } = await supabase
      .from('departments')
      .select(`
        id,
        name,
        status,
        head_id,
        parent_department_id,
        head:profiles!departments_head_id_fkey ( full_name ),
        parent:departments!departments_parent_department_id_fkey ( name )
      `)

    if (error) {
      setFetchError('Failed to load departments. Please try again.')
      setLoading(false)
      return
    }

    const mapped: DepartmentRow[] = (data ?? []).map((d) => {
      // Supabase returns the joined rows as objects or arrays; handle both shapes
      const headRecord = Array.isArray(d.head) ? d.head[0] : d.head
      const parentRecord = Array.isArray(d.parent) ? d.parent[0] : d.parent

      return {
        id: d.id,
        name: d.name,
        status: d.status,
        headName: (headRecord as { full_name: string | null } | null)?.full_name ?? null,
        parentName: (parentRecord as { name: string } | null)?.name ?? null,
      }
    })

    setRows(mapped)

    // Also refresh the raw departments list used by the modal dropdown
    const deptList = (data ?? []).map((d) => ({
      id: d.id,
      name: d.name,
      head_id: d.head_id,
      parent_department_id: d.parent_department_id,
      status: d.status,
    })) as Department[]
    setDepartments(deptList)

    setLoading(false)
  }, [])

  const fetchProfiles = useCallback(async () => {
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name')
      .order('full_name', { ascending: true })
    setProfiles(data ?? [])
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchDepartments()
    void fetchProfiles()
  }, [fetchDepartments, fetchProfiles])

  // ── Modal helpers ──────────────────────────────────────────────────────────

  function openModal() {
    setNameValue('')
    setParentId('')
    setHeadId('')
    setNameError(null)
    setSubmitError(null)
    setModalOpen(true)
  }

  function closeModal() {
    setModalOpen(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    // Client-side validation (Requirement 12.6)
    const validation = isNonBlankName(nameValue, 100, 'Department')
    if (!validation.valid) {
      setNameError(validation.error ?? 'Department name is required')
      return
    }

    setNameError(null)
    setSubmitError(null)
    setSubmitting(true)

    const insertPayload = {
      name: nameValue.trim(),
      parent_department_id: parentId !== '' ? parentId : null,
      head_id: headId !== '' ? headId : null,
    }

    const { error } = await supabase.from('departments').insert(insertPayload)

    setSubmitting(false)

    if (error) {
      // Detect duplicate name: Postgres unique constraint violation code 23505
      if (error.code === '23505') {
        setSubmitError('A department with this name already exists')
      } else if (error.code === '42501') {
        // RLS policy violation — user does not have write permission (design.md error table)
        setSubmitError("You don't have permission to perform this action")
      } else {
        console.error('[DepartmentsTab] Unexpected insert error:', error)
        setSubmitError('Something went wrong. Please try again.')
      }
      return
    }

    // Success — close modal and refresh grid (Requirements 12.5)
    closeModal()
    void fetchDepartments()
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <section style={styles.container}>
      {/* Header row */}
      <div style={styles.headerRow}>
        <h2 style={styles.heading}>Departments</h2>
        <button
          type="button"
          style={styles.addButton}
          onClick={openModal}
        >
          + Add New Department
        </button>
      </div>

      {/* Loading / error states */}
      {loading && <p style={styles.stateText}>Loading departments…</p>}
      {!loading && fetchError && <p style={styles.errorText}>{fetchError}</p>}

      {/* Data grid (Requirement 12.1, 12.2) */}
      {!loading && !fetchError && (
        <div style={styles.tableWrapper}>
          <table style={styles.table} aria-label="Departments">
            <thead>
              <tr>
                <th style={styles.th}>Name</th>
                <th style={styles.th}>Head</th>
                <th style={styles.th}>Parent Department</th>
                <th style={styles.th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={4} style={styles.emptyCell}>
                    No departments yet. Click "Add New Department" to create one.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} style={styles.tr}>
                    <td style={styles.td}>{row.name}</td>
                    <td style={styles.td}>{row.headName ?? <span style={styles.muted}>—</span>}</td>
                    <td style={styles.td}>{row.parentName ?? <span style={styles.muted}>—</span>}</td>
                    <td style={styles.td}>
                      <span style={row.status === 'Active' ? styles.badgeActive : styles.badgeInactive}>
                        {row.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Add New Department modal (Requirements 12.3, 12.4) */}
      {modalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-title"
          style={styles.overlay}
          onClick={(e) => {
            // Dismiss on backdrop click (Requirement: cancel/dismiss closes modal)
            if (e.target === e.currentTarget) closeModal()
          }}
        >
          <div style={styles.modal}>
            <h3 id="modal-title" style={styles.modalTitle}>Add New Department</h3>

            <form onSubmit={handleSubmit} noValidate>
              {/* Name field — required */}
              <div style={styles.fieldGroup}>
                <label htmlFor="dept-name" style={styles.label}>
                  Name <span style={styles.required}>*</span>
                </label>
                <input
                  id="dept-name"
                  type="text"
                  maxLength={100}
                  value={nameValue}
                  onChange={(e) => {
                    setNameValue(e.target.value)
                    if (nameError) setNameError(null)
                  }}
                  style={nameError ? { ...styles.input, ...styles.inputError } : styles.input}
                  aria-describedby={nameError ? 'dept-name-error' : undefined}
                  aria-invalid={nameError ? 'true' : 'false'}
                  autoFocus
                />
                {nameError && (
                  <p id="dept-name-error" style={styles.fieldError} role="alert">
                    {nameError}
                  </p>
                )}
              </div>

              {/* Parent Department dropdown — optional */}
              <div style={styles.fieldGroup}>
                <label htmlFor="dept-parent" style={styles.label}>
                  Parent Department
                </label>
                <select
                  id="dept-parent"
                  value={parentId}
                  onChange={(e) => setParentId(e.target.value)}
                  style={styles.select}
                >
                  <option value="">— None —</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Head dropdown — optional, populated from profiles */}
              <div style={styles.fieldGroup}>
                <label htmlFor="dept-head" style={styles.label}>
                  Head
                </label>
                <select
                  id="dept-head"
                  value={headId}
                  onChange={(e) => setHeadId(e.target.value)}
                  style={styles.select}
                >
                  <option value="">— None —</option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.full_name ?? '(unnamed)'}
                    </option>
                  ))}
                </select>
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
                  {submitting ? 'Saving…' : 'Add Department'}
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
    color: '#111',
  },
  addButton: {
    padding: '0.5rem 1rem',
    fontSize: '0.875rem',
    fontWeight: 600,
    color: '#ffffff',
    backgroundColor: '#2563eb',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  stateText: {
    color: '#666',
    fontSize: '0.9rem',
    padding: '1rem 0',
  },
  errorText: {
    color: '#dc2626',
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
  },
  th: {
    textAlign: 'left',
    padding: '0.6rem 0.75rem',
    backgroundColor: '#f9fafb',
    borderBottom: '2px solid #e5e7eb',
    fontWeight: 600,
    color: '#374151',
    whiteSpace: 'nowrap',
  },
  tr: {
    borderBottom: '1px solid #f3f4f6',
  },
  td: {
    padding: '0.6rem 0.75rem',
    color: '#111',
    verticalAlign: 'middle',
  },
  emptyCell: {
    padding: '1.5rem 0.75rem',
    color: '#6b7280',
    textAlign: 'center',
  },
  muted: {
    color: '#9ca3af',
  },
  badgeActive: {
    display: 'inline-block',
    padding: '0.2rem 0.6rem',
    fontSize: '0.75rem',
    fontWeight: 600,
    borderRadius: '9999px',
    backgroundColor: '#dcfce7',
    color: '#166534',
  },
  badgeInactive: {
    display: 'inline-block',
    padding: '0.2rem 0.6rem',
    fontSize: '0.75rem',
    fontWeight: 600,
    borderRadius: '9999px',
    backgroundColor: '#f3f4f6',
    color: '#6b7280',
  },
  // Modal
  overlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
  },
  modal: {
    backgroundColor: '#ffffff',
    borderRadius: '8px',
    padding: '1.75rem',
    width: '100%',
    maxWidth: '480px',
    boxShadow: '0 10px 25px rgba(0,0,0,0.15)',
  },
  modalTitle: {
    margin: '0 0 1.25rem',
    fontSize: '1.1rem',
    fontWeight: 700,
    color: '#111',
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
  inputError: {
    borderColor: '#dc2626',
  },
  select: {
    padding: '0.5rem 0.75rem',
    fontSize: '0.9rem',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
    color: '#111',
    backgroundColor: '#ffffff',
  },
  fieldError: {
    margin: 0,
    fontSize: '0.8rem',
    color: '#dc2626',
  },
  submitError: {
    margin: '0 0 0.75rem',
    padding: '0.6rem 0.75rem',
    fontSize: '0.85rem',
    color: '#dc2626',
    backgroundColor: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: '6px',
  },
  modalActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '0.75rem',
    marginTop: '1.25rem',
  },
  cancelButton: {
    padding: '0.5rem 1rem',
    fontSize: '0.875rem',
    fontWeight: 500,
    color: '#374151',
    backgroundColor: '#f3f4f6',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  submitButton: {
    padding: '0.5rem 1.25rem',
    fontSize: '0.875rem',
    fontWeight: 600,
    color: '#ffffff',
    backgroundColor: '#2563eb',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
  },
}
