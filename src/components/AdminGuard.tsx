// Route guard that restricts access to Admin-only pages.
// Re-queries the user's role on every mount — no caching across navigations.
// Requirements: 11.1–11.4

import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { getCurrentUserRole } from '../services/authService'
import type { UserRole } from '../types/index'

interface AdminGuardProps {
  children: React.ReactNode
}

type GuardState =
  | { status: 'loading' }
  | { status: 'authorized' }
  | { status: 'redirect-dashboard' }
  | { status: 'redirect-login' }

export default function AdminGuard({ children }: AdminGuardProps) {
  const [guard, setGuard] = useState<GuardState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false

    async function checkRole() {
      let role: UserRole | null

      try {
        role = await getCurrentUserRole()
      } catch {
        // DB/network error — treat as unauthenticated
        if (!cancelled) setGuard({ status: 'redirect-login' })
        return
      }

      if (cancelled) return

      if (role === null) {
        // Unauthenticated or unrecognised role
        setGuard({ status: 'redirect-login' })
      } else if (role === 'Admin') {
        setGuard({ status: 'authorized' })
      } else {
        // Authenticated but not Admin
        setGuard({ status: 'redirect-dashboard' })
      }
    }

    checkRole()

    return () => {
      cancelled = true
    }
  }, [])

  if (guard.status === 'loading') {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
        }}
      >
        <div
          style={{
            width: '40px',
            height: '40px',
            border: '4px solid #e5e7eb',
            borderTopColor: '#6366f1',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }}
        />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  if (guard.status === 'redirect-login') {
    return <Navigate to="/" replace />
  }

  if (guard.status === 'redirect-dashboard') {
    return <Navigate to="/dashboard" replace />
  }

  // status === 'authorized'
  return <>{children}</>
}
