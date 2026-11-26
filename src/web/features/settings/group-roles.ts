import type { GrantRole } from './types.ts'

export const ROLES: GrantRole[] = ['viewer', 'member', 'admin']

export const adminRole = (role: string): boolean => role === 'owner' || role === 'admin'
