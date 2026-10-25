import type { Role } from '../types';
export type Action = 'project:write' | 'project:delete' | 'purchase:approve' | 'team:write' | 'task:write' | 'task:status' | 'inventory:write' | 'finance:write' | 'document:upload' | 'settings:reset';
const ALL: Role[] = ['Administrator', 'Project Manager', 'Site Supervisor', 'Procurement Officer', 'Finance Officer', 'Team Member'];
const MATRIX: Record<Action, Role[]> = {
  'project:write': ['Administrator', 'Project Manager'],
  'project:delete': ['Administrator'],
  'purchase:approve': ['Administrator', 'Project Manager'],
  'team:write': ['Administrator', 'Project Manager'],
  'task:write': ['Administrator', 'Project Manager', 'Site Supervisor'],
  'task:status': ALL,
  'inventory:write': ['Administrator', 'Project Manager', 'Procurement Officer', 'Site Supervisor'],
  'finance:write': ['Administrator', 'Project Manager', 'Finance Officer'],
  'document:upload': ['Administrator', 'Project Manager', 'Site Supervisor', 'Procurement Officer', 'Finance Officer'],
  'settings:reset': ['Administrator'],
};
/** Categories only these roles may see or download. */
const RESTRICTED_DOCS: Record<string, Role[]> = {
  Invoices: ['Administrator', 'Project Manager', 'Finance Officer', 'Procurement Officer'],
  Contracts: ['Administrator', 'Project Manager', 'Finance Officer', 'Procurement Officer'],
};
export const asRole = (r: string | undefined): Role => (ALL as string[]).includes(r ?? '') ? (r as Role) : 'Administrator';
export const can = (role: Role, action: Action): boolean => MATRIX[action].includes(role);
export const canViewDocument = (role: Role, category: string): boolean => !RESTRICTED_DOCS[category] || RESTRICTED_DOCS[category].includes(role);
/** Delete: Administrator/Project Manager, or the original uploader who still holds upload rights. */
export const canDeleteDocument = (role: Role, uploader: string | undefined, user: string): boolean =>
  role === 'Administrator' || role === 'Project Manager' || (!!uploader && uploader === user && can(role, 'document:upload'));
