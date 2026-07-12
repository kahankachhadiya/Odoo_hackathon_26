// Screen 1: Login page for AssetFlow.
// Google OAuth only — no email/password fields.
// Requirements: 9.1, 9.2, 9.3, 9.5, 10.1–10.4

import { useState } from 'react'
import { signInWithGoogle } from '../services/authService'

export default function LoginSignup() {
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  async function handleGoogleSignIn() {
    setError(null)
    setIsLoading(true)
    try {
      await signInWithGoogle()
      // signInWithGoogle() redirects the browser — code below only runs on error
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed. Please try again.')
      setIsLoading(false)
    }
  }

  return (
    <main style={styles.page}>
      <div style={styles.card}>
        <h1 style={styles.title}>AssetFlow</h1>
        <p style={styles.subtitle}>Sign in to continue</p>

        {error && (
          <p role="alert" style={styles.errorBanner}>
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={handleGoogleSignIn}
          disabled={isLoading}
          style={isLoading ? { ...styles.googleButton, opacity: 0.6 } : styles.googleButton}
          aria-label="Sign in with Google"
        >
          {/* Google "G" logo */}
          <svg
            aria-hidden="true"
            focusable="false"
            viewBox="0 0 24 24"
            style={styles.googleIcon}
          >
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            />
          </svg>
          {isLoading ? 'Redirecting…' : 'Sign in with Google'}
        </button>
      </div>
    </main>
  )
}

// ─── Inline Styles ────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f5f5f5',
    padding: '1rem',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: '8px',
    boxShadow: '0 2px 12px rgba(0,0,0,0.1)',
    padding: '2.5rem 2rem',
    width: '100%',
    maxWidth: '380px',
    textAlign: 'center',
  },
  title: {
    margin: '0 0 0.25rem',
    fontSize: '1.75rem',
    fontWeight: 700,
    color: '#111',
  },
  subtitle: {
    margin: '0 0 1.75rem',
    fontSize: '0.95rem',
    color: '#666',
  },
  errorBanner: {
    backgroundColor: '#fff0f0',
    border: '1px solid #ffaaaa',
    borderRadius: '4px',
    color: '#cc0000',
    padding: '0.6rem 0.75rem',
    marginBottom: '1.25rem',
    fontSize: '0.9rem',
    textAlign: 'left',
  },
  googleButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.6rem',
    width: '100%',
    padding: '0.7rem 1rem',
    backgroundColor: '#ffffff',
    color: '#444',
    border: '1px solid #dadce0',
    borderRadius: '4px',
    fontSize: '0.95rem',
    fontWeight: 500,
    cursor: 'pointer',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
    transition: 'box-shadow 0.15s',
  },
  googleIcon: {
    width: '18px',
    height: '18px',
    flexShrink: 0,
  },
}
