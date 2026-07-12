// Screen 3: Organization Setup — Admin-only tab container.
// Contains three tabs: Departments, Categories, Employee Directory.
// Requirements: 10.3, 12.1, 13.1, 14.1

import { useState } from 'react'
import DepartmentsTab from '../components/DepartmentsTab'
import CategoriesTab from '../components/CategoriesTab'
import EmployeeDirectoryTab from '../components/EmployeeDirectoryTab'
import './OrganizationSetup.css'

type TabId = 'departments' | 'categories' | 'employees'

const TABS: { id: TabId; label: string }[] = [
  { id: 'departments', label: 'Departments' },
  { id: 'categories', label: 'Categories' },
  { id: 'employees', label: 'Employee' },
]

export default function OrganizationSetup() {
  const [activeTab, setActiveTab] = useState<TabId>('departments')

  return (
    <div className="org-setup-page">
      <div className="tab-bar-container">
        <nav className="tab-bar" role="tablist" aria-label="Organization setup tabs">
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
                className={`tab-btn ${isActive ? 'active' : ''}`}
              >
                {tab.label}
              </button>
            )
          })}
        </nav>
        <button className="add-btn">+ Add</button>
      </div>

      {/* Tab panels */}
      <div className="tab-content-area">
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
    </div>
  )
}
