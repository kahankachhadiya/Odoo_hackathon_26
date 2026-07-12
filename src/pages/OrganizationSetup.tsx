// Screen 3: Organization Setup — Admin-only tab container.
// Contains three tabs: Departments, Categories, Employee Directory.
// Requirements: 10.3, 12.1, 13.1, 14.1

import { useState } from 'react'
import DepartmentsTab from '../components/DepartmentsTab'
import CategoriesTab from '../components/CategoriesTab'
import EmployeeDirectoryTab from '../components/EmployeeDirectoryTab'

type TabId = 'departments' | 'categories' | 'employees'

const TABS: { id: TabId; label: string }[] = [
  { id: 'departments', label: 'Departments' },
  { id: 'categories', label: 'Categories' },
  { id: 'employees', label: 'Employee Directory' },
]

export default function OrganizationSetup() {
  const [activeTab, setActiveTab] = useState<TabId>('departments')

  return (
    <main style={styles.page}>
      <h1 style={styles.heading}>Organization Setup</h1>

      {/* Tab bar */}
      <nav style={styles.tabBar} role="tablist" aria-label="Organization setup tabs">
        {TABS.map((tab) => {
          const isActive = tab.id === activeTab
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              aria-controls={`tabpanel-${tab.id}`}
              id={`tab-${tab.id}`}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              style={isActive ? { ...styles.tabButton, ...styles.tabButtonActive } : styles.tabButton}
            >
              {tab.label}
            </button>
          )
        })}
      </nav>

      {/* Tab panels */}
      <div style={styles.tabContent}>
        <div
          role="tabpanel"
          id="tabpanel-departments"
          aria-labelledby="tab-departments"
          hidden={activeTab !== 'departments'}
        >
          {activeTab === 'departments' && <DepartmentsTab />}
        </div>

        <div
          role="tabpanel"
          id="tabpanel-categories"
          aria-labelledby="tab-categories"
          hidden={activeTab !== 'categories'}
        >
          {activeTab === 'categories' && <CategoriesTab />}
        </div>

        <div
          role="tabpanel"
          id="tabpanel-employees"
          aria-labelledby="tab-employees"
          hidden={activeTab !== 'employees'}
        >
          {activeTab === 'employees' && <EmployeeDirectoryTab />}
        </div>
      </div>
    </main>
  )
}

// ─── Inline Styles ────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    backgroundColor: '#f5f5f5',
    padding: '2rem',
  },
  heading: {
    margin: '0 0 1.5rem',
    fontSize: '1.75rem',
    fontWeight: 700,
    color: '#111',
  },
  tabBar: {
    display: 'flex',
    gap: '0.25rem',
    borderBottom: '2px solid #e5e7eb',
    marginBottom: '1.5rem',
  },
  tabButton: {
    padding: '0.6rem 1.25rem',
    fontSize: '0.95rem',
    fontWeight: 500,
    color: '#555',
    backgroundColor: 'transparent',
    border: '1px solid transparent',
    borderBottom: 'none',
    borderRadius: '4px 4px 0 0',
    cursor: 'pointer',
    position: 'relative',
    top: '2px',            // sit on top of the tabBar border
    transition: 'color 0.15s, background-color 0.15s',
  },
  tabButtonActive: {
    color: '#111',
    backgroundColor: '#ffffff',
    border: '1px solid #e5e7eb',
    borderBottom: '2px solid #ffffff',  // covers the tabBar border line
    fontWeight: 600,
  },
  tabContent: {
    backgroundColor: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: '0 4px 4px 4px',
    padding: '1.5rem',
    boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
  },
}
