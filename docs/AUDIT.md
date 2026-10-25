# BuildSpace audit — status after this pass

## Legacy vs React parity
| Area | Legacy JS | React (now) |
|---|---|---|
| Overview, Projects, Tasks, Team, Materials, Budget | yes | yes, with edit flows, validation, filters |
| Schedule / Gantt | yes (percent-based) | yes (pixel timeline, dependencies, conflicts, date editing) |
| Documents | metadata only | real file storage (IndexedDB / Supabase), validation, access control |
| Reports | yes | yes, shared calculations, filters, CSV export |
| Settings, role switch, backup | yes | yes (+ import/restore, data check) |
| Global search, notifications | yes | yes |
| Sign-in with Supabase | yes | yes (gate only; data not synced) |
| Quick-create menu | yes | **not ported** — each page has its own "+ New" button |
| Project phases, progress history, supervisor notes | listed as missing in the old audit | **still not implemented** (never existed) |

## Defects found and fixed
- Budget utilisation showed 0% for a zero budget with spending; now "No budget".
- Spending sums used float addition; now integer minor units. Refunds/reversals added; Paid expenses locked.
- Overdue/attention counts included archived projects and cancelled work; now scoped consistently via `lib/metrics.ts`.
- Any active member could be a project manager; now restricted to Project Manager/Administrator roles.
- Inactive members could be assigned tasks; deactivation could orphan tasks and projects silently; now blocked or reassigned.
- Repeated submissions (double click) could apply a stock movement or purchase request twice; now idempotent via operation ids.
- Stale tabs could overwrite newer data; revision counter + storage events prevent it.
- Corrupt saved JSON was silently replaced; now backed up first and reported.
- Completed tasks could keep a lowered percentage, cross-project dependencies were accepted, project could be Completed with open tasks; now rejected.
- Uploads were name-only records; now real files with type/size/duplicate checks and role checks.
- Navigation was a scrolling strip on phones; now a menu button with `aria-expanded`; modals trap focus and restore it.

## Database security review (this pass)
| Finding | Severity | Status |
|---|---|---|
| 003 granted `UPDATE (status, pct)` on tasks to clients: direct status/progress writes bypassed `set_task_status()`; table-level REVOKE alone does not clear column grants | High | Fixed in 004 with explicit column-level REVOKEs + least-privilege grants + trigger + functions; regression tests written, **not executed** |
| Direct INSERT of a task already Completed/100% | High | Fixed in 004 |
| 002's permissive `tasks_status` policy let any member edit any task column | High | Dropped in 003 (kept as history) |
| `SECURITY DEFINER` functions with `search_path = public` (hijackable via `pg_temp`) | Medium | Fixed in 004: empty search_path + qualified names |
| `revoke … from anon` left the PUBLIC EXECUTE grant | Medium | Fixed in 004 |
| Purchase orders could not be cancelled in the database (UPDATE revoked, no function) | Medium | Fixed: `cancel_purchase_order()` |
| Writes into archived projects (tasks, expenses, documents, POs) | Medium | Fixed in 004 |
| Expenses movable across organisations; refunds above paid not capped in DB | Medium | Fixed in 004 |
| Free-text document category dodged the Invoices/Contracts restriction | Medium | Fixed in 004 (CHECK, NOT VALID) |
| Empty purchase requests could be "received" | Low | Fixed in 004 |
| 002 header claimed re-runnable; two ADD CONSTRAINT lines were not | Low | Fixed (drop-if-exists); header corrected |
| No approver separate from the creator for expenses | Info | Not fixed (no workflow in app or DB) |

**Earlier statements in this document that said the database layer was complete or verified were wrong**; nothing in `supabase/` has been executed against PostgreSQL.

## Known limits
See README "Supabase status". Business data is not yet in a database; Supabase SQL is unexecuted.
