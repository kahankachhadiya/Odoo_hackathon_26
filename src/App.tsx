import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import LoginSignup from './pages/LoginSignup'
import AuthCallback from './pages/AuthCallback'
import Dashboard from './pages/Dashboard'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Screen 1: Google OAuth login */}
        <Route path="/" element={<LoginSignup />} />

        {/* OAuth callback — Supabase redirects here after Google sign-in */}
        <Route path="/auth/callback" element={<AuthCallback />} />

        {/* Placeholder Dashboard — for Employee, Department Head, Asset Manager */}
        <Route path="/dashboard" element={<Dashboard />} />

        {/* Screen 3: Organization Setup — placeholder until AdminGuard + OrganizationSetup are implemented */}
        <Route path="/admin/setup" element={<div style={{ padding: '2rem' }}><h1>Organization Setup</h1><p>Admin panel — coming soon.</p></div>} />

        {/* Catch-all → back to login */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
