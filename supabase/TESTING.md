# Verifying migrations 002–004 (not yet executed)

Automated: `npm run test:rls` (see `supabase/tests/rls_test.sql`). The manual list below is a complement, not a substitute.


Run on a **throw-away** Supabase project after `001_schema.sql` and `002_security_hardening.sql`. Create two users (A in org 1 as *Project Manager*, B in org 2 as *Finance Officer*) plus a *Team Member* C in org 1, then confirm each line:

| # | As | Action | Expected |
|---|----|--------|----------|
| 1 | B | `select * from projects` (org 1 rows) | 0 rows |
| 2 | C | `insert into expenses …` | denied by RLS |
| 3 | A | `insert into expenses …` | allowed; row visible to C |
| 4 | A | `update expenses set amount=… where status='Paid'` | 0 rows updated |
| 5 | A | `delete from expenses where status='Paid'` | 0 rows deleted |
| 6 | C | `insert into task_dependencies` making a cycle | exception "circular dependency" |
| 7 | A | `select record_stock_movement(m,'consumption', qty>stock, …)` | exception (check violation) |
| 8 | A | same call twice with one `p_op` | stock changes once |
| 9 | C | `insert into inventory_transactions …` directly | denied (no policy) |
| 10 | A | upload `documents/<A uid>/1/x.pdf` | allowed |
| 11 | B | download `documents/<A uid>/1/x.pdf` | denied |
| 12 | anon | any `select` on any table; bucket object URL | denied / 400 |
| 13 | C | `select` a document in category *Invoices* | 0 rows |

Do not mark Supabase as production-ready until every row passes.

## Task status bypass (migration 004) — manual repro
As a Site Supervisor session (`set local role authenticated` + a JWT `sub` of a supervisor):
```sql
update public.tasks set status = 'Completed', pct = 100 where id = '<task with an unfinished predecessor>';   -- must fail: permission denied for table tasks
select public.set_task_status('<same task>', 'Completed');                                                    -- must fail: Finish the predecessor task first
```
Before 004 the first statement succeeded. The automated equivalents are in `supabase/tests/rls_test.sql` (sections A–D).
