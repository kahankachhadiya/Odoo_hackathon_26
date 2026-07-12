// Role utility functions for AssetFlow.
// Centralises role-based permission checks so components stay free of
// inline role-string comparisons.
// Requirements: 12.1, 12.9

import type { UserRole } from '../types/index'

/**
 * Returns true when the given role has Asset Manager–level privileges.
 * Both 'Admin' and 'Asset Manager' are considered managers.
 * Requirements: 12.1, 12.9
 */
export function isAssetManager(role: UserRole): boolean {
  return role === 'Admin' || role === 'Asset Manager'
}
