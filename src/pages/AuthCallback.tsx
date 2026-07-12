// OAuth callback route — /auth/callback
// Supabase redirects here after Google sign-in.
// Confirms the session, reads the user's role, and routes accordingly.
// Requirements: 9.4, 10.1–10.4

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { handleOAuthCallback } from '../services/authService'
import type { UserRole } from '../types'

export default function AuthCallback() {
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function finish() {
      const result = await handleOAuthCallback()

      if (cancelled) return

      if (result.error) {
        setError(result.error)
        return
      }

      routeByRole(result.role)
    }

    function routeByRole(role: UserRole | undefined) {
      if (role === 'Admin') {
        navigate('/admin/setup', { replace: true })
      } else if (
        role === 'Employee' ||
        role === 'Department Head' ||
        role === 'Asset Manager'
      ) {
        navigate('/dashboard', { replace: true })
      } else {
        // NULL / unrecognized role — stay on this page and show the error
        setError('Account configuration error. Contact your administrator.')
      }
    }

    finish()
    return () => { cancelled = true }
  }, [navigate])

  if (error) {
    return (
      <main style={styles.page}>
        <div style={styles.card}>
          <p role="alert" style={styles.error}>{error}</p>
          <a href="/" style={styles.link}>Back to sign in</a>
        </div>
      </main>
    )
  }

  // Show a spinner while the session is being confirmed
  return (
    <main style={styles.page}>
      <div style={styles.card}>
        <div style={styles.spinner} aria-label="Verifying sign-in…" role="status" />
        <p style={styles.loadingText}>Completing sign-in…</p>
      </div>
    </main>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f5f5f5',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: '8px',
    boxShadow: '0 2px 12px rgba(0,0,0,0.1)',
    padding: '2.5rem 2rem',
    textAlign: 'center',
    minWidth: '260px',
  },
  spinner: {
    width: '36px',
    height: '36px',
    border: '3px solid #e0e0e0',
    borderTop: '3px solid #0066cc',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
    margin: '0 auto 1rem',
  },
  loadingText: {
    color: '#555',
    fontSize: '0.95rem',
    margin: 0,
  },
  error: {
    color: '#cc0000',
    fontSize: '0.95rem',
    marginBottom: '1rem',
  },
  link: {
    color: '#0066cc',
    fontSize: '0.9rem',
  },
}
