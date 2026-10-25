export type TaskStatus = 'Backlog' | 'To Do' | 'In Progress' | 'Blocked' | 'Completed' | 'Cancelled';
export type ProjectStatus = 'Planning' | 'Active' | 'On Hold' | 'Completed' | 'Archived';
export const TASK_STATUSES: TaskStatus[] = ['Backlog', 'To Do', 'In Progress', 'Blocked', 'Completed', 'Cancelled'];
export const PROJECT_STATUSES: ProjectStatus[] = ['Planning', 'Active', 'On Hold', 'Completed', 'Archived'];
export const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'] as const;
export type Priority = (typeof PRIORITIES)[number];
export interface BudgetRevision { date: string; from: number; to: number; reason: string }
export interface Phase { id: number; name: string; start: string; end: string }
/** Progress history entry: `progress` is computed from tasks when the update is recorded (never typed in by hand). */
export interface ProgressUpdate { id: number; date: string; by: string; progress: number | null; note: string }
export interface Project { id: number; name: string; mgr: string; loc: string; start: string; end: string; budget: number; status: ProjectStatus; budgetHistory?: BudgetRevision[]; desc?: string; client?: string; phases?: Phase[]; updates?: ProgressUpdate[] }
/** `dep` is a single finish-to-start predecessor (same project). `pri` is optional so older saved data stays valid. */
export interface Task { id: number; p: number; title: string; who: string; status: TaskStatus; start: string; due: string; pct: number; ms: boolean; dep: number | ''; pri?: Priority; desc?: string; phase?: number }
export const AVAILABILITY = ['Available', 'Partially available', 'Unavailable'] as const;
export type Availability = (typeof AVAILABILITY)[number];
export interface Member { name: string; role: string; dept: string; active: boolean; email?: string; phone?: string; skills?: string[]; availability?: Availability }
export interface Material { id: number; name: string; cat: string; unit: string; qty: number; min: number; cost: number; sup: string; sku: string; upd: string }
export interface Expense { id: number; p: number; cat: string; vendor: string; date: string; amt: number; status: 'Paid' | 'Pending'; ref: string; refund?: boolean; inv?: string; notes?: string }
/** Stock movement row: [date, material name, label, quantity, project id|null, note?]. Rows 0-4 match the legacy app. */
export type Movement = (string | number | null)[];
export interface PurchaseOrder { id: number; m: number; q: number; status: string; date?: string; p?: number; by?: string; approvedBy?: string }
/** Document metadata. `path` is the key in the storage provider; legacy rows (name only) have provider 'metadata-only'. */
export interface Doc { id: number; n: string; s: number; p: number; c: string; d: string; type?: string; by?: string; path?: string; hash?: string; provider?: 'local' | 'supabase' | 'metadata-only' }
export interface DB {
  cur: string; role?: string; act: [string, string][]; rev?: number; ops?: string[];
  P: Project[]; T: Task[]; M: Member[]; I: Material[]; E: Expense[];
  MV: Movement[]; DOC: Doc[]; PO: PurchaseOrder[];
}
export const ROLES = ['Administrator', 'Project Manager', 'Site Supervisor', 'Procurement Officer', 'Finance Officer', 'Team Member'] as const;
export type Role = (typeof ROLES)[number];
export const EXPENSE_CATEGORIES = ['Labor', 'Materials', 'Equipment', 'Transportation', 'Permits', 'Subcontractors', 'Miscellaneous'] as const;
export const DOC_CATEGORIES = ['Contracts', 'Architectural drawings', 'Engineering plans', 'Permits', 'Invoices', 'Safety reports', 'Site photographs', 'Inspection reports'] as const;
