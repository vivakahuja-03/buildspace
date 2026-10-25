# BuildSpace — Construction Project Management

React 18 + TypeScript + Vite + Tailwind. One application (`src/`); the old plain-JS app in `legacy/` is **deprecated, no longer built or linked**, and kept only as a reference until you have confirmed the React app in a browser (then delete it together with `scripts/smoke-legacy.mjs` and the `test:legacy` / `smoke:legacy` scripts).

## Run
```
npm ci
npm run dev          # http://localhost:5173
```
Demo mode (no env vars): business data lives in this browser's `localStorage`; uploaded files live in IndexedDB.

## Commands
| Command | What it does |
|---|---|
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest unit tests (`src/**/*.test.ts`) |
| `npm run build` | type-check + production build |
| `npm run smoke` | boots the built React app in jsdom, visits every route |
| `npm run test:rls` | applies migrations 001–004 and the RLS suite to a **disposable** Postgres (needs `psql`, `DATABASE_URL`; `STUB_SUPABASE=1` for plain Postgres) |
| `npm run check:sql` | static consistency check of the migrations (tables/columns exist, quoting, idempotency). **Not** a substitute for `test:rls` |
| `npm run test:legacy` | legacy business-logic tests (reference only) |

There is no ESLint configuration in this project; none was added.

## Environment variables (all optional)
| Name | Purpose |
|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL (public) |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key (public). **Never** use the service-role key in this project. |

With both set, the app requires sign-in and uploads documents to the private `documents` bucket. **Projects, tasks, expenses and inventory are still stored in the browser** — the database layer is not connected (see below).

## Architecture
- `src/lib/*` — pure business rules (no React). Every write is a function `(draft: DB, input) => …` that throws `DomainError` on invalid input. The store (`src/data/store.tsx`) runs it on a copy of the latest data and commits only if it succeeds, so a failed action never leaves half-applied changes. Role permissions and idempotency keys are enforced there too, not only in the UI.
- `src/pages/*` — thin UI over those functions. `src/components/ui/*` — shared primitives (accessible modal, fields, states).
- Persistence: `localStorage` key `buildspace-v1` (same shape as legacy). Corrupt data is copied to `buildspace-v1-corrupt-<time>` before demo data loads; values are validated/repaired on load; several tabs stay in sync through a revision counter; Settings has JSON backup/restore.
- Documents: `DocumentStorage` interface with IndexedDB (local), Supabase Storage (cloud) and in-memory (tests) providers.

## Calculation rules (one definition each, shared by Overview, Project detail, Budget and Reports)
- **Progress** = duration-weighted mean of task completion (Completed = 100%); Cancelled tasks are excluded; no live tasks → "No tasks"; always clamped to 0–100.
- **Planned %** = share of the project's schedule elapsed — an *estimate*, used only for the "behind" flag (10-point tolerance).
- **Money** is summed in integer minor units (1/100) — no float drift; inputs allow at most 2 decimals.
- **Allocated** = project budget. **Actual (paid)** = Paid expenses minus Paid refunds. **Committed** = Pending expenses. **Remaining** = allocated − paid. **Available** = remaining − committed. Zero/missing budget with spending shows "No budget" / over-budget, never 0%.
- **Inventory value** = Σ round(qty × current unit cost). Stock can never go negative; quantities keep ≤ 3 decimals.
- Task dependency = one finish-to-start predecessor in the same project; cycles rejected; a task cannot start/complete before its predecessor finishes (cancelled predecessors don't block).

## Database (Supabase / PostgreSQL)

### Apply migrations in this order
`001_schema.sql` → `002_security_hardening.sql` → `003_corrective_rls.sql` → **`004_fix_task_status_privileges.sql`**. Always apply 004 after 003 (it is idempotent and also works on a database that already ran 001–003). Run migrations as the table owner (Supabase: `postgres`). Never run the test suite against production.

### Task status vulnerability (found in review, fixed in 004)
**Root cause.** Migration 003 revoked table-level UPDATE on `tasks` but granted column-level `UPDATE (… status … pct)` to `authenticated`, and the role-scoped `tasks_write` policy let managers/supervisors update rows. Any of them could therefore run `UPDATE tasks SET status='Completed', pct=100` directly, skipping `set_task_status()` and all of its rules (valid transitions, finish-to-start predecessors, completion ⇒ 100%). INSERT was unrestricted too, so a task could be created already "Completed". (An earlier permissive `tasks_status` policy from 002 was a related flaw and was already dropped in 003.)

**Fix, three independent layers.**
1. *Privileges:* clients may UPDATE only `title, description, priority, start_date, due_date, effort_hours` and INSERT only those plus `project_id`. `status`, `pct`, `project_id` (update) are not grantable columns for clients.
2. *Trigger (`guard_task_write`):* even if a broad GRANT is re-introduced later, `authenticated`/`anon` cannot change `status`/`pct`, cannot insert a task that is not Backlog/To Do at 0%, and cannot edit or add tasks in an archived project. Only the `SECURITY DEFINER` functions (running as the owner) can.
3. *Functions:* `set_task_status(task, status)` and `set_task_progress(task, 0-99)` hold the rules.

### Supported way to change task status or progress (for the future data layer)
```
select public.set_task_status('<task uuid>', 'In Progress');   -- Backlog | To Do | In Progress | Blocked | Completed | Cancelled
select public.set_task_progress('<task uuid>', 40);            -- 0-99; reach 100 by completing the task
```
Callers: Administrator / Project Manager / Site Supervisor of the task's organisation, or the task's assignee. Rejected in the database: unknown or other-organisation tasks (same "Not allowed" message, so ids cannot be probed), archived projects, invalid transitions (Completed → only In Progress/To Do; Cancelled → only Backlog/To Do), starting/completing while a predecessor is unfinished, progress outside 0–99, progress on Completed/Cancelled tasks. Completing sets 100%; reopening caps at 99%. The React app does not yet call the database for tasks (it only uses Supabase for sign-in and document files), so no frontend code needed to change; any future client must use these RPCs.

### Other database hardening in 004
All `SECURITY DEFINER` functions use `search_path = ''` and schema-qualified names (a plain `search_path = public` is hijackable via `pg_temp`); EXECUTE is revoked from `PUBLIC`/`anon` (revoking only from `anon` leaves the PUBLIC grant) and granted to `authenticated` only for the helpers and RPCs; `anon` has no table access; `materials.quantity` changes only through `record_stock_movement()` (atomic, row-locked, idempotent per `(material, op_id)`, same-organisation and archived-project checks); `advance_purchase_order()` approval is manager-only, receipt adds stock once, empty requests cannot advance; new `cancel_purchase_order()`; expenses cannot move between organisations or into archived projects and refunds cannot exceed the paid total; document categories are constrained (a lower-case "invoices" could previously bypass the Invoices restriction); assignees must belong to the organisation.

### Verification status — read this
The migrations and `supabase/tests/rls_test.sql` (≈125 checks: privilege catalog, direct-write attacks, the grant-reintroduction regression, every RPC rule, cross-organisation isolation, inventory, expenses, documents, purchase orders) have **never been executed**: no PostgreSQL was available when they were written. Only static checks were run (`sqlcheck`-style: quote balance, every referenced table/column exists in 001, idempotency of policies/triggers). Run them before trusting any of this:
```
docker run --rm -d --name bs-pg -e POSTGRES_PASSWORD=x -p 54329:5432 postgres:16
STUB_SUPABASE=1 DATABASE_URL=postgres://postgres:x@localhost:54329/postgres npm run test:rls     # plain Postgres
DATABASE_URL=<local `supabase start` or a throw-away project> npm run test:rls                      # real Supabase
```
The script applies 001→004, re-applies 004 to prove idempotency, then runs the suite in one rolled-back transaction; the first failing check aborts with `FAILED: <name>`.

### Known database gaps (not fixed)
- Concurrency is reasoned about (row locks, unique `(material_id, op_id)`), not load-tested.
- There is no separate approver for expenses: a Finance Officer can create and mark expenses Paid (the app has no approval workflow either).
- `organization_members` lets an Administrator remove the last Administrator.
- `tasks_write`-style policies are role-scoped org-wide (any Site Supervisor can edit any task in the organisation).
- `service_role` bypasses RLS and the client-role triggers by design; keep that key server-side only.
- Storage policies are owner-scoped (`<user id>/…`); organisation-scoped paths need the database layer.
- **The React app does not read or write these tables**: projects, tasks, expenses, inventory and reports live in the browser (`localStorage`).

## Demo roles
Settings → Demo role switches which actions the UI/store allows. Anyone can change it, so it demonstrates the permission rules and is **not** a security boundary. Real authorisation is the database layer described above (not yet connected).

## Notes on behaviour
- Archiving a task sets it to **Cancelled** (kept for history, excluded from progress); deleting is permanent and asks for confirmation.
- Projects can be permanently deleted only when nothing refers to them (Administrator); otherwise archive.
- Open purchase requests are shown beside, not inside, committed costs, to avoid double counting.
- Phases, milestones (tasks flagged ◆), progress updates and supervisor notes are stored per project; update progress % is computed from tasks, never typed.
