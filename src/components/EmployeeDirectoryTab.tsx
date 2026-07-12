// Employee Directory tab for the Organization Setup screen.
// Renders a data grid of all employees and an employee edit modal.
// Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import type { UserRole, ActiveStatus, Department } from '../types/index'

// ─── Types ────────────────────────────────────────────────────────────────────

interface EmployeeRow {
  id: string
  full_name: string | null
  email: string
  role: UserRole
  department_id: string | null
  departmentName: string | null   // resolved via join, null when unassigned
  status: ActiveStatus
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ROLES: UserRole[] = ['Employee', 'Department Head', 'Asset Manager', 'Admin']

// ─── Component ────────────────────────────────────────────────────────────────

export default function EmployeeDirectoryTab() {
  const [rows, setRows] = useState<EmployeeRow[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)

  // Modal state
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedEmployee, setSelectedEmployee] = useState<EmployeeRow | null>(null)
  const [editRole, setEditRole] = useState<UserRole>('Employee')
  const [editDepartmentId, setEditDepartmentId] = useState<string>('')  // '' represents NULL / Unassigned
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Dropdown data for departments
  const [activeDepartments, setActiveDepartments] = useState<Department[]>([])

  // ── Data fetching ──────────────────────────────────────────────────────────

  const fetchEmployees = useCallback(async () => {
    setLoading(true)
    setFetchError(null)

    const { data, error } = await supabase
      .from('profiles')
      .select(`
        id, full_name, email, role, department_id, status, created_at,
        department:departments!profiles_department_id_fkey ( name )
      `)
      .order('full_name', { ascending: true })

    if (error) {
      setFetchError('Failed to load employees. Please try again.')
      setLoading(false)
      return
    }

    const mapped: EmployeeRow[] = (data ?? []).map((p) => {
      // Supabase returns the joined row as an object or array; handle both shapes
      const deptRecord = Array.isArray(p.department) ? p.department[0] : p.department
      return {
        id: p.id,
        full_name: p.full_name,
        email: p.email,
        role: p.role as UserRole,
        department_id: p.department_id,
        departmentName: (deptRecord as { name: string } | null)?.name ?? null,
        status: p.status as ActiveStatus,
      }
    })

    setRows(mapped)
    setLoading(false)
  }, [])

  const fetchActiveDepartments = useCallback(async () => {
    const { data } = await supabase
      .from('departments')
      .select('id, name, head_id, parent_department_id, status')
      .eq('status', 'Active')
      .order('name', { ascending: true })
    setActiveDepartments((data ?? []) as Department[])
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchEmployees()
    void fetchActiveDepartments()
  }, [fetchEmployees, fetchActiveDepartments])

  // ── Modal helpers ──────────────────────────────────────────────────────────

  function openModal(employee: EmployeeRow) {
    setSelectedEmployee(employee)
    setEditRole(employee.role)
    setEditDepartmentId(employee.department_id ?? '')
    setSubmitError(null)
    setModalOpen(true)
  }

  function closeModal() {
    setModalOpen(false)
    setSelectedEmployee(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedEmployee) return

    setSubmitError(null)
    setSubmitting(true)

    const { error } = await supabase
      .from('profiles')
      .update({
        role: editRole,
        department_id: editDepartmentId !== '' ? editDepartmentId : null,
      })
      .eq('id', selectedEmployee.id)

    setSubmitting(false)

    if (error) {
      // Keep modal open with submitted values (Requirement 14.7)
      if (error.code === '42501') {
        // RLS policy violation — user does not have write permission (design.md error table)
        setSubmitError("You don't have permission to perform this action")
      } else {
        console.error('[EmployeeDirectoryTab] Unexpected update error:', error)
        setSubmitError('Update failed. Please try again.')
      }
      return
    }

    // Success — close modal and refresh grid (Requirements 14.5, 14.6)
    closeModal()
    void fetchEmployees()
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <section style={styles.container}>
      {/* Header row */}
      <div style={styles.headerRow}>
        <h2 style={styles.heading}>Employee Directory</h2>
      </div>

      {/* Loading / error states */}
      {loading && <p style={styles.stateText}>Loading employees…</p>}
      {!loading && fetchError && <p style={styles.errorText}>{fetchError}</p>}

      {/* Data grid (Requirements 14.1, 14.2) */}
      {!loading && !fetchError && (
        <div style={styles.tableWrapper}>
          <table style={styles.table} aria-label="Employee Directory">
            <thead>
              <tr>
                <th style={styles.th}>Full Name</th>
                <th style={styles.th}>Email</th>
                <th style={styles.th}>Department</th>
                <th style={styles.th}>Role</th>
                <th style={styles.th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5} style={styles.emptyCell}>
                    No employees found.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr
                    key={row.id}
                    style={{ ...styles.tr, ...styles.trClickable }}
                    onClick={() => openModal(row)}
                    tabIndex={0}
                    role="button"
                    aria-label={`Edit ${row.full_name ?? row.email}`}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        openModal(row)
                      }
                    }}
                  >
                    <td style={styles.td}>{row.full_name ?? <span style={styles.muted}>—</span>}</td>
                    <td style={styles.td}>{row.email}</td>
                    <td style={styles.td}>
                      {row.departmentName ?? <span style={styles.muted}>Unassigned</span>}
                    </td>
                    <td style={styles.td}>{row.role}</td>
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

      {/* Employee edit modal (Requirements 14.3–14.7) */}
      {modalOpen && selectedEmployee && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="emp-modal-title"
          style={styles.overlay}
          onClick={(e) => {
            // Dismiss on backdrop click
            if (e.target === e.currentTarget) closeModal()
          }}
        >
          <div style={styles.modal}>
            <h3 id="emp-modal-title" style={styles.modalTitle}>Edit Employee</h3>

            <form onSubmit={handleSubmit} noValidate>
              {/* Read-only: Full Name (Requirement 14.3) */}
              <div style={styles.fieldGroup}>
                <label htmlFor="emp-fullname" style={styles.label}>Full Name</label>
                <input
                  id="emp-fullname"
                  type="text"
                  value={selectedEmployee.full_name ?? ''}
                  readOnly
                  style={{ ...styles.input, ...styles.inputReadOnly }}
                  aria-readonly="true"
                />
              </div>

              {/* Read-only: Email (Requirement 14.3) */}
              <div style={styles.fieldGroup}>
                <label htmlFor="emp-email" style={styles.label}>Email</label>
                <input
                  id="emp-email"
                  type="email"
                  value={selectedEmployee.email}
                  readOnly
                  style={{ ...styles.input, ...styles.inputReadOnly }}
                  aria-readonly="true"
                />
              </div>

              {/* Role dropdown (Requirement 14.4) */}
              <div style={styles.fieldGroup}>
                <label htmlFor="emp-role" style={styles.label}>Role</label>
                <select
                  id="emp-role"
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value as UserRole)}
                  style={styles.select}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>

              {/* Department dropdown (Requirement 14.4) */}
              <div style={styles.fieldGroup}>
                <label htmlFor="emp-department" style={styles.label}>Department</label>
                <select
                  id="emp-department"
                  value={editDepartmentId}
                  onChange={(e) => setEditDepartmentId(e.target.value)}
                  style={styles.select}
                >
                  <option value="">Unassigned</option>
                  {activeDepartments.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>

              {/* Update failure error (Requirement 14.7) */}
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
                  {submitting ? 'Saving…' : 'Save Changes'}
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
  trClickable: {
    cursor: 'pointer',
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
  inputReadOnly: {
    backgroundColor: '#f9fafb',
    color: '#6b7280',
    cursor: 'default',
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
