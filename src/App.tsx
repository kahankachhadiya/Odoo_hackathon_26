import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import LoginSignup from './pages/LoginSignup'
import AuthCallback from './pages/AuthCallback'
import Dashboard from './pages/Dashboard'
import OrganizationSetup from './pages/OrganizationSetup'
import AssetDirectory from './pages/AssetDirectory'
import AllocationTransfer from './pages/AllocationTransfer'
import ResourceBooking from './pages/ResourceBooking'
import MaintenanceBoard from './pages/MaintenanceBoard'
import AdminGuard from './components/AdminGuard'
import AppLayout from './components/AppLayout'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Screen 1: Google OAuth login — Requirements: 9.1 */}
        <Route path="/" element={<LoginSignup />} />

        {/* OAuth callback — Supabase redirects here after Google sign-in — Requirements: 9.4 */}
        <Route path="/auth/callback" element={<AuthCallback />} />

        {/* Authenticated Layout Wrapper */}
        <Route element={<AppLayout />}>
          {/* Dashboard — for Employee, Department Head, Asset Manager — Requirements: 10.4 */}
          <Route path="/dashboard" element={<Dashboard />} />

          {/* Screen 3: Organization Setup — Admin only — Requirements: 10.3, 11.1–11.4 */}
          <Route
            path="/admin/setup"
            element={
              <AdminGuard>
                <OrganizationSetup />
              </AdminGuard>
            }
          />

          {/* Asset Directory — all authenticated roles — Requirements: 10.1, 12.1 */}
          <Route path="/assets" element={<AssetDirectory />} />

          {/* Allocation & Transfer — all authenticated roles — Requirements: 10.1, 12.1 */}
          <Route path="/allocations" element={<AllocationTransfer />} />

          {/* Resource Booking — all authenticated roles — Requirements: 18.1, 18.2, 18.3 */}
          <Route path="/bookings" element={<ResourceBooking />} />

          {/* Maintenance Board — all authenticated roles — Requirements: 18.1, 18.2, 18.3 */}
          <Route path="/maintenance" element={<MaintenanceBoard />} />
        </Route>

        {/* Catch-all → back to login */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
