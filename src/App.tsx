import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import LoginSignup from './pages/LoginSignup'
import AuthCallback from './pages/AuthCallback'
import Dashboard from './pages/Dashboard'
import OrganizationSetup from './pages/OrganizationSetup'
import AdminGuard from './components/AdminGuard'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Screen 1: Google OAuth login — Requirements: 9.1 */}
        <Route path="/" element={<LoginSignup />} />

        {/* OAuth callback — Supabase redirects here after Google sign-in — Requirements: 9.4 */}
        <Route path="/auth/callback" element={<AuthCallback />} />

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

        {/* Catch-all → back to login */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
