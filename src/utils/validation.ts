// Validation utility functions for AssetFlow.
// Each function returns { valid: boolean; error?: string } for field-level error display.
// Client-side validation runs before any Supabase call (see design.md Error Handling section).

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean
  error?: string
}

// ─── Email ────────────────────────────────────────────────────────────────────

/**
 * Validates an email address against RFC 5322 format.
 * Requirements: 9.5
 */
export function isValidEmail(value: string): ValidationResult {
  // Covers the vast majority of valid RFC 5322 addresses used in practice.
  // Allows: local part with letters, digits, and common special chars;
  // domain with at least one dot and a TLD of 2+ characters.
  const RFC_5322_RE =
    /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/

  if (!RFC_5322_RE.test(value)) {
    return { valid: false, error: 'Please enter a valid email address' }
  }
  return { valid: true }
}

// ─── Password ─────────────────────────────────────────────────────────────────

/**
 * Validates a password: must be 6–72 characters inclusive.
 * Requirements: 9.5
 */
export function isValidPassword(value: string): ValidationResult {
  if (value.length < 6 || value.length > 72) {
    return { valid: false, error: 'Password must be 6–72 characters' }
  }
  return { valid: true }
}

// ─── Full Name ────────────────────────────────────────────────────────────────

/**
 * Validates a full name: must be non-empty and at most 100 characters.
 * Requirements: 9.5
 */
export function isValidFullName(value: string): ValidationResult {
  if (value.trim().length === 0) {
    return { valid: false, error: 'Full name is required' }
  }
  if (value.length > 100) {
    return { valid: false, error: 'Full name is required' }
  }
  return { valid: true }
}

// ─── Generic Non-Blank Name ───────────────────────────────────────────────────

/**
 * Validates a name field (e.g. department name, category name):
 *   - Must contain at least one non-whitespace character (not blank/whitespace-only)
 *   - Must be at most `maxLen` characters
 *
 * The caller is responsible for supplying the `fieldLabel` used in the error message
 * (e.g. "Department" or "Category"). Defaults to "Name" if omitted.
 *
 * Requirements: 12.6, 13.6
 */
export function isNonBlankName(
  value: string,
  maxLen: number,
  fieldLabel: string = 'Name'
): ValidationResult {
  if (value.trim().length === 0) {
    return { valid: false, error: `${fieldLabel} name is required` }
  }
  if (value.length > maxLen) {
    return { valid: false, error: `${fieldLabel} name is required` }
  }
  return { valid: true }
}
