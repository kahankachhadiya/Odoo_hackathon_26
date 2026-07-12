// Authentication service for AssetFlow.
// Google OAuth only — no email/password flows.
// Requirements: 9.3–9.5, 10.1–10.4

import { supabase } from '../lib/supabaseClient'
import type { UserRole } from '../types/index'

// ─── Public Interfaces ────────────────────────────────────────────────────────

export interface AuthResult {
  error: string | null
  role?: UserRole
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mapOAuthError(err: unknown): string {
  if (!err || typeof err !== 'object') {
    return 'Sign-in failed. Please try again.'
  }
  const error = err as { message?: string; status?: number }
  const message = (error.message ?? '').toLowerCase()

  if (message.includes('fetch') || message.includes('network') || error.status === 0) {
    return 'Sign-in failed. Please try again.'
  }

  return 'Sign-in failed. Please try again.'
}

// ─── signInWithGoogle ─────────────────────────────────────────────────────────

/**
 * Initiates the Google OAuth flow.
 * Redirects the browser to Google's consent screen.
 * On success, Supabase redirects back to /auth/callback.
 * Requirements: 9.1, 9.3
 */
export async function signInWithGoogle(): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${window.location.origin}/auth/callback`,
    },
  })

  if (error) {
    // Supabase rarely errors here synchronously (it redirects), but handle it.
    throw new Error(mapOAuthError(error))
  }
}

// ─── handleOAuthCallback ──────────────────────────────────────────────────────

/**
 * Called on the /auth/callback route after Google redirects back.
 * Confirms the session and fetches the user's role for routing.
 * Requirements: 9.4, 10.1–10.4
 */
export async function handleOAuthCallback(): Promise<AuthResult> {
  // Supabase JS v2 automatically exchanges the code from the URL fragment/query.
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession()

  if (sessionError || !session) {
    return { error: 'Sign-in failed. Please try again.' }
  }

  const role = await getCurrentUserRole()

  if (role === null) {
    return { error: 'Account configuration error. Contact your administrator.' }
  }

  return { error: null, role }
}

// ─── signOut ──────────────────────────────────────────────────────────────────

/**
 * Signs the current user out of Supabase Auth.
 */
export async function signOut(): Promise<void> {
  await supabase.auth.signOut()
}

// ─── getCurrentUserRole ───────────────────────────────────────────────────────

/**
 * Queries `profiles.role` for the currently authenticated user.
 * Returns null if:
 *   - No session exists
 *   - The DB/network query fails
 *   - The role value is NULL or not a recognised UserRole
 *
 * Called by handleOAuthCallback (for routing) and AdminGuard (route guard).
 * Requirements: 10.1, 11.1, 11.4
 */
export async function getCurrentUserRole(): Promise<UserRole | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return null
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (error || !data) {
    return null
  }

  const VALID_ROLES: UserRole[] = ['Employee', 'Department Head', 'Asset Manager', 'Admin']
  if (!VALID_ROLES.includes(data.role as UserRole)) {
    return null
  }

  return data.role as UserRole
}
