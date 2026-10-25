-- RLS / privilege / integrity regression tests for migrations 001-004.
-- Run against a DISPOSABLE database only:   npm run test:rls     (see scripts/test-rls.sh)
-- One transaction, rolled back at the end. psql runs with ON_ERROR_STOP, so the FIRST failed check aborts with FAILED: <name> and a
-- non-zero exit status; reaching the final line means every check passed. Every security assertion uses fails_like(sql, pattern):
-- it passes only if the statement is rejected AND the error text matches the expected reason, so a typo cannot pass as "denied".
-- STATUS: written but NOT executed when authored (no PostgreSQL available). Treat as unverified until it has run.
begin;
create schema rlstest;
grant usage on schema rlstest to public;
create function rlstest.as_user(u uuid) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', u::text, true); execute 'set local role authenticated'; end $$;
create function rlstest.as_anon() returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true); perform set_config('request.jwt.claim.sub', '', true); execute 'set local role anon'; end $$;
create function rlstest.as_root() returns void language plpgsql as $$ begin execute 'reset role'; end $$;
-- true only if `q` raises an error whose message matches `pat`
create function rlstest.fails_like(q text, pat text) returns boolean language plpgsql as $$ begin
  execute q; return false;
exception when others then
  if sqlerrm ~* pat then return true; end if;
  raise notice 'unexpected error text: % (wanted /%/) for: %', sqlerrm, pat, left(q, 120); return false; end $$;
-- true only if `q` (DML) succeeds and touches exactly n rows
create function rlstest.affects(q text, n int) returns boolean language plpgsql as $$ declare c int; begin
  execute q; get diagnostics c = row_count; return c = n;
exception when others then raise notice 'unexpected error: % for: %', sqlerrm, left(q, 120); return false; end $$;
create function rlstest.succeeds(q text) returns boolean language plpgsql as $$ begin execute q; return true;
exception when others then raise notice 'unexpected error: % for: %', sqlerrm, left(q, 120); return false; end $$;
create function rlstest.val(q text) returns text language plpgsql as $$ declare r text; begin execute q into r; return r; end $$;
create function rlstest.check(n text, ok boolean) returns void language plpgsql as $$ begin
  if not coalesce(ok, false) then raise exception 'FAILED: %', n; end if; raise notice 'PASS: %', n; end $$;
grant execute on all functions in schema rlstest to public;

-- ===================================================== fixtures (as owner) =====================================================
-- org1: a1 Administrator, b1 Project Manager (manages P1), b2 Site Supervisor, b3 Team Member (assignee of T1,T6), b4 Finance, b5 Procurement
-- org2: a2 Administrator.   P1 active (org1), P2 (org2), P3 ARCHIVED (org1)
select rlstest.as_root();
insert into auth.users(id, email) select u, u::text || '@test.local' from unnest(array[
 '00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000b2',
 '00000000-0000-0000-0000-0000000000b3','00000000-0000-0000-0000-0000000000b4','00000000-0000-0000-0000-0000000000b5']::uuid[]) u;
insert into profiles(id, full_name) select id, email from auth.users where email like '%@test.local';
insert into organizations(id, name) values ('10000000-0000-0000-0000-000000000001','Org1'),('10000000-0000-0000-0000-000000000002','Org2');
insert into organization_members(org_id, user_id, role) values
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','Administrator'),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b1','Project Manager'),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b2','Site Supervisor'),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b3','Team Member'),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b4','Finance Officer'),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b5','Procurement Officer'),
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000a2','Administrator');
insert into projects(id, org_id, name, manager_id, budget, start_date, end_date, status) values
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','P1','00000000-0000-0000-0000-0000000000b1',1000,'2026-01-01','2026-12-31','Active'),
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','P2 other org','00000000-0000-0000-0000-0000000000a2',1000,'2026-01-01','2026-12-31','Active'),
 ('20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','P3 archived','00000000-0000-0000-0000-0000000000b1',1000,'2026-01-01','2026-12-31','Archived');
insert into tasks(id, project_id, title, status, pct, start_date, due_date) values
 ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','T1','To Do',0,'2026-02-01','2026-02-10'),
 ('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','T2 (after T1)','To Do',0,'2026-02-11','2026-02-20'),
 ('30000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000003','T4 archived project','To Do',0,'2026-02-01','2026-02-10'),
 ('30000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000002','T5 other org','To Do',0,'2026-02-01','2026-02-10'),
 ('30000000-0000-0000-0000-000000000006','20000000-0000-0000-0000-000000000001','T6 progress','In Progress',20,'2026-02-01','2026-02-10'),
 ('30000000-0000-0000-0000-000000000007','20000000-0000-0000-0000-000000000001','T7 done','Completed',100,'2026-02-01','2026-02-10'),
 ('30000000-0000-0000-0000-000000000008','20000000-0000-0000-0000-000000000001','T8 cancel path','To Do',0,'2026-02-01','2026-02-10');
insert into task_assignees values ('30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b3'),('30000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-0000000000b3');
insert into task_dependencies values ('30000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001');
insert into materials(id, org_id, sku, name, unit) values ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','M1','Cement','bag'),('40000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','M2','Sand','m3');
insert into expenses(id, project_id, category, expense_date, amount, status) values
 ('80000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Labor','2026-03-01',100,'Paid'),
 ('80000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','Labor','2026-03-02',40,'Pending');
insert into documents(id, project_id, name, category, storage_path, uploaded_by) values ('90000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','inv.pdf','Invoices','x/inv.pdf','00000000-0000-0000-0000-0000000000b1');
insert into purchase_orders(id, org_id, project_id, status) values
 ('60000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Requested'),
 ('60000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Requested'),
 ('60000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Requested');
insert into purchase_order_items(id, po_id, material_id, quantity, unit_cost) values
 ('70000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001',5,1),
 ('70000000-0000-0000-0000-000000000002','60000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001',3,1);

-- ===================================================== A. catalog: privileges actually granted =====================================================
select rlstest.check('authenticated has NO column UPDATE on tasks.status', not has_column_privilege('authenticated','public.tasks','status','UPDATE'));
select rlstest.check('authenticated has NO column UPDATE on tasks.pct', not has_column_privilege('authenticated','public.tasks','pct','UPDATE'));
select rlstest.check('authenticated has NO column UPDATE on tasks.project_id', not has_column_privilege('authenticated','public.tasks','project_id','UPDATE'));
select rlstest.check('authenticated keeps UPDATE on tasks.title/description/priority/dates/effort',
  has_column_privilege('authenticated','public.tasks','title','UPDATE') and has_column_privilege('authenticated','public.tasks','description','UPDATE') and has_column_privilege('authenticated','public.tasks','priority','UPDATE')
  and has_column_privilege('authenticated','public.tasks','start_date','UPDATE') and has_column_privilege('authenticated','public.tasks','due_date','UPDATE') and has_column_privilege('authenticated','public.tasks','effort_hours','UPDATE'));
select rlstest.check('authenticated has NO column INSERT on tasks.status/pct', not has_column_privilege('authenticated','public.tasks','status','INSERT') and not has_column_privilege('authenticated','public.tasks','pct','INSERT'));
select rlstest.check('authenticated has NO UPDATE on materials.quantity or projects.org_id', not has_column_privilege('authenticated','public.materials','quantity','UPDATE') and not has_column_privilege('authenticated','public.projects','org_id','UPDATE'));
select rlstest.check('anon cannot execute any RPC', not has_function_privilege('anon','public.set_task_status(uuid,text)','EXECUTE') and not has_function_privilege('anon','public.set_task_progress(uuid,integer)','EXECUTE')
  and not has_function_privilege('anon','public.record_stock_movement(uuid,text,numeric,uuid,uuid,text)','EXECUTE') and not has_function_privilege('anon','public.advance_purchase_order(uuid)','EXECUTE') and not has_function_privilege('anon','public.cancel_purchase_order(uuid)','EXECUTE'));
select rlstest.check('authenticated can execute the approved RPCs', has_function_privilege('authenticated','public.set_task_status(uuid,text)','EXECUTE') and has_function_privilege('authenticated','public.set_task_progress(uuid,integer)','EXECUTE')
  and has_function_privilege('authenticated','public.record_stock_movement(uuid,text,numeric,uuid,uuid,text)','EXECUTE') and has_function_privilege('authenticated','public.advance_purchase_order(uuid)','EXECUTE') and has_function_privilege('authenticated','public.cancel_purchase_order(uuid)','EXECUTE'));
select rlstest.check('anon has no table access', not has_table_privilege('anon','public.tasks','SELECT') and not has_table_privilege('anon','public.projects','SELECT') and not has_table_privilege('anon','public.expenses','SELECT'));
select rlstest.check('no non-extension function in public is executable by anon',
  not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') and has_function_privilege('anon', p.oid, 'EXECUTE')));
select rlstest.check('every SECURITY DEFINER function in public pins search_path',
  (select coalesce(bool_and(exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c where c like 'search_path=%')), true) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef));
select rlstest.check('no tasks_status-style permissive UPDATE policy remains on tasks', (select count(*) from pg_policies where schemaname='public' and tablename='tasks' and cmd in ('UPDATE','ALL')) = 1);
select rlstest.check('RLS is enabled on every public table', not exists (select 1 from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and not c.relrowsecurity));

-- ===================================================== B. THE VULNERABILITY: direct status/pct writes =====================================================
select rlstest.as_user('00000000-0000-0000-0000-0000000000b2');   -- Site Supervisor: may edit tasks, may NOT bypass the rules
select rlstest.check('supervisor: direct UPDATE of status is denied (privilege)', rlstest.fails_like($q$update public.tasks set status='Completed' where id='30000000-0000-0000-0000-000000000002'$q$, 'permission denied'));
select rlstest.check('supervisor: direct UPDATE of pct is denied (privilege)', rlstest.fails_like($q$update public.tasks set pct=100 where id='30000000-0000-0000-0000-000000000002'$q$, 'permission denied'));
select rlstest.check('supervisor: status+pct together denied', rlstest.fails_like($q$update public.tasks set status='Completed', pct=100 where id='30000000-0000-0000-0000-000000000002'$q$, 'permission denied'));
select rlstest.check('supervisor: cannot complete T2 while predecessor T1 is open (the classic bypass)', rlstest.val($q$select status from public.tasks where id='30000000-0000-0000-0000-000000000002'$q$) = 'To Do');
select rlstest.check('supervisor: INSERT with status Completed denied (privilege)', rlstest.fails_like($q$insert into public.tasks(project_id,title,status,pct) values ('20000000-0000-0000-0000-000000000001','sneaky','Completed',100)$q$, 'permission denied'));
select rlstest.check('supervisor: INSERT with only permitted columns works', rlstest.affects($q$insert into public.tasks(project_id,title,start_date,due_date) values ('20000000-0000-0000-0000-000000000001','legit new task','2026-04-01','2026-04-02')$q$, 1));
select rlstest.check('...and the new task starts as To Do at 0%', rlstest.val($q$select status || ':' || pct::text from public.tasks where title='legit new task'$q$) = 'To Do:0');
select rlstest.check('supervisor: INSERT into another organisation denied (RLS)', rlstest.fails_like($q$insert into public.tasks(project_id,title) values ('20000000-0000-0000-0000-000000000002','x')$q$, 'row-level security'));
select rlstest.check('supervisor: INSERT into an ARCHIVED project denied', rlstest.fails_like($q$insert into public.tasks(project_id,title) values ('20000000-0000-0000-0000-000000000003','x')$q$, 'archived'));
-- legitimate editing of permitted columns still works
select rlstest.check('supervisor: can still edit title, description, priority, dates, effort',
  rlstest.affects($q$update public.tasks set title='T8 renamed', description='d', priority='High', start_date='2026-02-02', due_date='2026-02-12', effort_hours=8 where id='30000000-0000-0000-0000-000000000008'$q$, 1));
select rlstest.check('supervisor: cannot move a task to another project (privilege)', rlstest.fails_like($q$update public.tasks set project_id='20000000-0000-0000-0000-000000000002' where id='30000000-0000-0000-0000-000000000008'$q$, 'permission denied'));
select rlstest.check('supervisor: cannot edit a task of an ARCHIVED project', rlstest.fails_like($q$update public.tasks set title='y' where id='30000000-0000-0000-0000-000000000004'$q$, 'archived'));
select rlstest.as_user('00000000-0000-0000-0000-0000000000b1');   -- Project Manager
select rlstest.check('PM: direct status UPDATE denied', rlstest.fails_like($q$update public.tasks set status='Completed' where id='30000000-0000-0000-0000-000000000001'$q$, 'permission denied'));
select rlstest.as_user('00000000-0000-0000-0000-0000000000a1');   -- Administrator
select rlstest.check('Administrator: direct pct UPDATE denied', rlstest.fails_like($q$update public.tasks set pct=50 where id='30000000-0000-0000-0000-000000000001'$q$, 'permission denied'));
select rlstest.as_user('00000000-0000-0000-0000-0000000000b3');   -- Team Member (assignee): no direct write path at all
select rlstest.check('assignee: direct status UPDATE denied', rlstest.fails_like($q$update public.tasks set status='Completed' where id='30000000-0000-0000-0000-000000000001'$q$, 'permission denied'));
select rlstest.check('assignee: editing the title is blocked by RLS (0 rows)', rlstest.affects($q$update public.tasks set title='mine' where id='30000000-0000-0000-0000-000000000001'$q$, 0));

-- defence in depth: even if a broad GRANT is re-introduced, the TRIGGER still blocks clients. (savepoint = undo the temporary grant)
select rlstest.as_root();
savepoint reintroduced_grant;
grant update on public.tasks to authenticated;      -- simulate the original vulnerability
grant insert on public.tasks to authenticated;
select rlstest.as_user('00000000-0000-0000-0000-0000000000b2');
select rlstest.check('REGRESSION: with table-level UPDATE re-granted, trigger still blocks status', rlstest.fails_like($q$update public.tasks set status='Completed' where id='30000000-0000-0000-0000-000000000002'$q$, 'set_task_status'));
select rlstest.check('REGRESSION: with table-level UPDATE re-granted, trigger still blocks pct', rlstest.fails_like($q$update public.tasks set pct=100 where id='30000000-0000-0000-0000-000000000002'$q$, 'set_task_status'));
select rlstest.check('REGRESSION: with INSERT re-granted, trigger still blocks a Completed insert', rlstest.fails_like($q$insert into public.tasks(project_id,title,status,pct) values ('20000000-0000-0000-0000-000000000001','sneaky2','Completed',100)$q$, 'must start as'));
select rlstest.check('REGRESSION: the approved function still works while broad grants exist', rlstest.succeeds($q$select public.set_task_status('30000000-0000-0000-0000-000000000008','Backlog')$q$));
select rlstest.as_root();
rollback to savepoint reintroduced_grant;
select rlstest.check('temporary re-grant was undone', not has_column_privilege('authenticated','public.tasks','status','UPDATE'));

-- ===================================================== C. set_task_status(): the approved path and its rules =====================================================
select rlstest.as_user('00000000-0000-0000-0000-0000000000b3');   -- assignee of T1
select rlstest.check('assignee can set own task to Blocked', rlstest.succeeds($q$select public.set_task_status('30000000-0000-0000-0000-000000000001','Blocked')$q$));
select rlstest.check('...and it is stored', rlstest.val($q$select status from public.tasks where id='30000000-0000-0000-0000-000000000001'$q$) = 'Blocked');
select rlstest.check('member who is NOT the assignee cannot change status', rlstest.fails_like($q$select public.set_task_status('30000000-0000-0000-0000-000000000002','Backlog')$q$, 'Only managers'));
select rlstest.as_user('00000000-0000-0000-0000-0000000000b4');   -- Finance Officer, org member but not assignee/manager
select rlstest.check('finance (not assignee) cannot change status', rlstest.fails_like($q$select public.set_task_status('30000000-0000-0000-0000-000000000001','In Progress')$q$, 'Only managers'));
select rlstest.as_user('00000000-0000-0000-0000-0000000000b2');
select rlstest.check('supervisor: valid transition Blocked -> In Progress', rlstest.succeeds($q$select public.set_task_status('30000000-0000-0000-0000-000000000001','In Progress')$q$));
select rlstest.check('predecessor open: T2 -> In Progress rejected', rlstest.fails_like($q$select public.set_task_status('30000000-0000-0000-0000-000000000002','In Progress')$q$, 'predecessor'));
select rlstest.check('predecessor open: T2 -> Completed rejected', rlstest.fails_like($q$select public.set_task_status('30000000-0000-0000-0000-000000000002','Completed')$q$, 'predecessor'));
select rlstest.check('T2 unchanged after rejected attempts', rlstest.val($q$select status || ':' || pct from public.tasks where id='30000000-0000-0000-0000-000000000002'$q$) = 'To Do:0');
select rlstest.check('invalid status value rejected', rlstest.fails_like($q$select public.set_task_status('30000000-0000-0000-0000-000000000001','Done')$q$, 'Invalid status'));
select rlstest.check('NULL status rejected', rlstest.fails_like($q$select public.set_task_status('30000000-0000-0000-0000-000000000001', null)$q$, 'Invalid status'));
select rlstest.check('completing T1 succeeds', rlstest.succeeds($q$select public.set_task_status('30000000-0000-0000-0000-000000000001','Completed')$q$));
select rlstest.check('...and sets pct to 100', rlstest.val($q$select status || ':' || pct::text from public.tasks where id='30000000-0000-0000-0000-000000000001'$q$) = 'Completed:100');
select rlstest.check('after predecessor completes, T2 may start', rlstest.succeeds($q$select public.set_task_status('30000000-0000-0000-0000-000000000002','In Progress')$q$));
select rlstest.check('completed -> Backlog rejected', rlstest.fails_like($q$select public.set_task_status('30000000-0000-0000-0000-000000000001','Backlog')$q$, 'reopened'));
select rlstest.check('completed -> In Progress (reopen) succeeds', rlstest.succeeds($q$select public.set_task_status('30000000-0000-0000-0000-000000000001','In Progress')$q$));
select rlstest.check('...and caps pct at 99', rlstest.val($q$select pct::text from public.tasks where id='30000000-0000-0000-0000-000000000001'$q$) = '99');
select rlstest.check('To Do -> Cancelled allowed', rlstest.succeeds($q$select public.set_task_status('30000000-0000-0000-0000-000000000008','Cancelled')$q$));
select rlstest.check('cancelled -> Completed rejected', rlstest.fails_like($q$select public.set_task_status('30000000-0000-0000-0000-000000000008','Completed')$q$, 'cancelled task can only'));
select rlstest.check('cancelled -> To Do (restore) allowed', rlstest.succeeds($q$select public.set_task_status('30000000-0000-0000-0000-000000000008','To Do')$q$));
select rlstest.check('archived project: status change rejected', rlstest.fails_like($q$select public.set_task_status('30000000-0000-0000-0000-000000000004','In Progress')$q$, 'archived'));
select rlstest.as_user('00000000-0000-0000-0000-0000000000a2');   -- Administrator of ANOTHER organisation
select rlstest.check('other-org admin cannot change status of an org1 task', rlstest.fails_like($q$select public.set_task_status('30000000-0000-0000-0000-000000000001','Blocked')$q$, '^Not allowed$'));
select rlstest.check('other-org admin cannot set progress of an org1 task', rlstest.fails_like($q$select public.set_task_progress('30000000-0000-0000-0000-000000000006', 30)$q$, '^Not allowed$'));
select rlstest.check('a nonexistent task id gives the SAME error (no existence oracle across organisations)', rlstest.fails_like($q$select public.set_task_status('30000000-0000-0000-0000-0000000000ff','Blocked')$q$, '^Not allowed$'));
select rlstest.as_anon();
select rlstest.check('anon cannot call set_task_status (no EXECUTE)', rlstest.fails_like($q$select public.set_task_status('30000000-0000-0000-0000-000000000001','Blocked')$q$, 'permission denied'));
select rlstest.as_root();
select rlstest.check('org1 task T1 was NOT changed by the cross-org and anon attempts (still In Progress)', rlstest.val($q$select status from public.tasks where id='30000000-0000-0000-0000-000000000001'$q$) = 'In Progress');

-- ===================================================== D. set_task_progress() =====================================================
select rlstest.as_user('00000000-0000-0000-0000-0000000000b3');
select rlstest.check('assignee can record progress on own task', rlstest.succeeds($q$select public.set_task_progress('30000000-0000-0000-0000-000000000006', 40)$q$));
select rlstest.check('...and it is stored', rlstest.val($q$select pct::text from public.tasks where id='30000000-0000-0000-0000-000000000006'$q$) = '40');
select rlstest.check('progress 100 must go through completion', rlstest.fails_like($q$select public.set_task_progress('30000000-0000-0000-0000-000000000006', 100)$q$, 'Progress must be'));
select rlstest.check('negative progress rejected', rlstest.fails_like($q$select public.set_task_progress('30000000-0000-0000-0000-000000000006', -1)$q$, 'Progress must be'));
select rlstest.as_user('00000000-0000-0000-0000-0000000000b2');
select rlstest.check('progress on a completed task rejected (authorised caller)', rlstest.fails_like($q$select public.set_task_progress('30000000-0000-0000-0000-000000000007', 50)$q$, 'Reopen'));
select rlstest.as_user('00000000-0000-0000-0000-0000000000b4');
select rlstest.check('non-assignee non-manager cannot record progress', rlstest.fails_like($q$select public.set_task_progress('30000000-0000-0000-0000-000000000006', 50)$q$, 'Only managers'));

-- ===================================================== E. dependencies / assignees =====================================================
select rlstest.as_user('00000000-0000-0000-0000-0000000000b2');
select rlstest.check('dependency cycle rejected', rlstest.fails_like($q$insert into public.task_dependencies values ('30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002')$q$, 'circular'));
select rlstest.check('cross-project dependency rejected', rlstest.fails_like($q$insert into public.task_dependencies values ('30000000-0000-0000-0000-000000000008','30000000-0000-0000-0000-000000000004')$q$, 'same project'));
select rlstest.check('assigning a user from another organisation rejected', rlstest.fails_like($q$insert into public.task_assignees values ('30000000-0000-0000-0000-000000000008','00000000-0000-0000-0000-0000000000a2')$q$, 'not an active member'));

-- ===================================================== F. cross-organisation isolation (existing protections) =====================================================
select rlstest.as_user('00000000-0000-0000-0000-0000000000a2');
select rlstest.check('org2 admin sees none of org1 (projects, tasks, expenses, materials, documents)',
  (select count(*) from public.projects where org_id = '10000000-0000-0000-0000-000000000001') = 0 and (select count(*) from public.tasks where project_id <> '20000000-0000-0000-0000-000000000002') = 0
  and (select count(*) from public.expenses) = 0 and (select count(*) from public.materials where org_id = '10000000-0000-0000-0000-000000000001') = 0 and (select count(*) from public.documents) = 0);
select rlstest.check('org2 admin cannot update an org1 project', rlstest.affects($q$update public.projects set description='x' where id='20000000-0000-0000-0000-000000000001'$q$, 0));
select rlstest.check('org2 admin cannot update an org1 task', rlstest.affects($q$update public.tasks set title='x' where id='30000000-0000-0000-0000-000000000001'$q$, 0));
select rlstest.as_anon();
select rlstest.check('anon cannot read projects', rlstest.fails_like($q$select count(*) from public.projects$q$, 'permission denied'));
select rlstest.check('anon cannot read tasks', rlstest.fails_like($q$select count(*) from public.tasks$q$, 'permission denied'));

-- ===================================================== G. projects =====================================================
select rlstest.as_user('00000000-0000-0000-0000-0000000000b1');
select rlstest.check('PM can edit a project they manage', rlstest.affects($q$update public.projects set description='ok' where id='20000000-0000-0000-0000-000000000001'$q$, 1));
select rlstest.check('PM cannot change the organisation (privilege)', rlstest.fails_like($q$update public.projects set org_id='10000000-0000-0000-0000-000000000002' where id='20000000-0000-0000-0000-000000000001'$q$, 'permission denied'));
select rlstest.check('manager must be a Project Manager/Administrator', rlstest.fails_like($q$update public.projects set manager_id='00000000-0000-0000-0000-0000000000b2' where id='20000000-0000-0000-0000-000000000001'$q$, 'must be an active Project Manager'));
select rlstest.as_user('00000000-0000-0000-0000-0000000000b3');
select rlstest.check('team member cannot edit a project (0 rows)', rlstest.affects($q$update public.projects set budget=1 where id='20000000-0000-0000-0000-000000000001'$q$, 0));

-- ===================================================== H. inventory =====================================================
select rlstest.as_user('00000000-0000-0000-0000-0000000000b3');
select rlstest.check('team member cannot record stock', rlstest.fails_like($q$select public.record_stock_movement('40000000-0000-0000-0000-000000000001','receipt',5,null,gen_random_uuid())$q$, 'Not allowed'));
select rlstest.as_user('00000000-0000-0000-0000-0000000000b2');
select rlstest.check('supervisor receives stock', rlstest.val($q$select public.record_stock_movement('40000000-0000-0000-0000-000000000001','receipt',10,null,'50000000-0000-0000-0000-000000000001')::text$q$) = '10');
select rlstest.check('repeating the same operation id returns the same stock', rlstest.val($q$select public.record_stock_movement('40000000-0000-0000-0000-000000000001','receipt',10,null,'50000000-0000-0000-0000-000000000001')::text$q$) = '10');
select rlstest.check('...and wrote only one history row', rlstest.val($q$select count(*)::text from public.inventory_transactions where material_id='40000000-0000-0000-0000-000000000001'$q$) = '1');
select rlstest.check('overdraw is rejected', rlstest.fails_like($q$select public.record_stock_movement('40000000-0000-0000-0000-000000000001','consumption',99,'20000000-0000-0000-0000-000000000001',gen_random_uuid())$q$, 'violates check constraint'));
select rlstest.check('failed overdraw left stock and history unchanged', rlstest.val($q$select quantity::text from public.materials where id='40000000-0000-0000-0000-000000000001'$q$) = '10'
  and rlstest.val($q$select count(*)::text from public.inventory_transactions where material_id='40000000-0000-0000-0000-000000000001'$q$) = '1');
select rlstest.check('CROSS-ORG project rejected', rlstest.fails_like($q$select public.record_stock_movement('40000000-0000-0000-0000-000000000001','consumption',1,'20000000-0000-0000-0000-000000000002',gen_random_uuid())$q$, 'different organisation'));
select rlstest.check('CROSS-ORG material rejected', rlstest.fails_like($q$select public.record_stock_movement('40000000-0000-0000-0000-000000000002','receipt',1,null,gen_random_uuid())$q$, 'Not allowed'));
select rlstest.check('archived project rejected', rlstest.fails_like($q$select public.record_stock_movement('40000000-0000-0000-0000-000000000001','consumption',1,'20000000-0000-0000-0000-000000000003',gen_random_uuid())$q$, 'archived'));
select rlstest.check('consumption without a project rejected', rlstest.fails_like($q$select public.record_stock_movement('40000000-0000-0000-0000-000000000001','consumption',1,null,gen_random_uuid())$q$, 'charged to a project'));
select rlstest.check('adjustment without a reason rejected', rlstest.fails_like($q$select public.record_stock_movement('40000000-0000-0000-0000-000000000001','adjustment',-1,null,gen_random_uuid())$q$, 'reason'));
select rlstest.check('more than 3 decimals rejected', rlstest.fails_like($q$select public.record_stock_movement('40000000-0000-0000-0000-000000000001','receipt',0.0001,null,gen_random_uuid())$q$, 'Invalid quantity'));
select rlstest.check('direct quantity UPDATE denied (privilege)', rlstest.fails_like($q$update public.materials set quantity=9999 where id='40000000-0000-0000-0000-000000000001'$q$, 'permission denied'));
select rlstest.check('direct movement INSERT denied (no policy)', rlstest.fails_like($q$insert into public.inventory_transactions(material_id,kind,quantity) values ('40000000-0000-0000-0000-000000000001','receipt',5)$q$, 'row-level security'));
select rlstest.check('creating a material with stock is rejected', rlstest.fails_like($q$insert into public.materials(org_id,sku,name,unit,quantity) values ('10000000-0000-0000-0000-000000000001','M9','Gravel','m3',50)$q$, 'quantity 0'));
select rlstest.as_root();
savepoint reintroduced_material_grant;
grant update on public.materials to authenticated;
select rlstest.as_user('00000000-0000-0000-0000-0000000000b2');
select rlstest.check('REGRESSION: with UPDATE on materials re-granted, trigger still blocks quantity', rlstest.fails_like($q$update public.materials set quantity=9999 where id='40000000-0000-0000-0000-000000000001'$q$, 'record_stock_movement'));
select rlstest.as_root();
rollback to savepoint reintroduced_material_grant;

-- ===================================================== I. expenses =====================================================
select rlstest.as_user('00000000-0000-0000-0000-0000000000b3');
select rlstest.check('team member cannot add an expense', rlstest.fails_like($q$insert into public.expenses(project_id,category,expense_date,amount) values ('20000000-0000-0000-0000-000000000001','Labor','2026-03-01',5)$q$, 'row-level security'));
select rlstest.as_user('00000000-0000-0000-0000-0000000000b4');
select rlstest.check('finance can add an expense', rlstest.affects($q$insert into public.expenses(project_id,category,expense_date,amount,status) values ('20000000-0000-0000-0000-000000000001','Labor','2026-03-03',5,'Paid')$q$, 1));
select rlstest.check('paid expense cannot be updated (0 rows)', rlstest.affects($q$update public.expenses set amount=1 where id='80000000-0000-0000-0000-000000000001'$q$, 0));
select rlstest.check('paid expense cannot be deleted (0 rows)', rlstest.affects($q$delete from public.expenses where id='80000000-0000-0000-0000-000000000001'$q$, 0));
select rlstest.check('refund above the paid total rejected', rlstest.fails_like($q$insert into public.expenses(project_id,category,expense_date,amount,status,is_refund) values ('20000000-0000-0000-0000-000000000001','Labor','2026-03-04',500,'Paid',true)$q$, 'Refund exceeds'));
select rlstest.check('refund within the paid total accepted', rlstest.affects($q$insert into public.expenses(project_id,category,expense_date,amount,status,is_refund) values ('20000000-0000-0000-0000-000000000001','Labor','2026-03-04',10,'Paid',true)$q$, 1));
select rlstest.check('a Pending refund is rejected', rlstest.fails_like($q$insert into public.expenses(project_id,category,expense_date,amount,status,is_refund) values ('20000000-0000-0000-0000-000000000001','Labor','2026-03-04',1,'Pending',true)$q$, 'violates check constraint'));
select rlstest.check('expense cannot be moved to another organisation', rlstest.fails_like($q$update public.expenses set project_id='20000000-0000-0000-0000-000000000002' where id='80000000-0000-0000-0000-000000000002'$q$, 'row-level security|another organisation'));
select rlstest.check('expense on an ARCHIVED project rejected', rlstest.fails_like($q$insert into public.expenses(project_id,category,expense_date,amount) values ('20000000-0000-0000-0000-000000000003','Labor','2026-03-01',5)$q$, 'archived'));
select rlstest.check('pending expense can be marked paid', rlstest.affects($q$update public.expenses set status='Paid' where id='80000000-0000-0000-0000-000000000002'$q$, 1));

-- ===================================================== J. documents =====================================================
select rlstest.as_user('00000000-0000-0000-0000-0000000000b2');
select rlstest.check('lower-case "invoices" cannot dodge the category restriction', rlstest.fails_like($q$insert into public.documents(project_id,name,category,storage_path,uploaded_by) values ('20000000-0000-0000-0000-000000000001','a.pdf','invoices','p','00000000-0000-0000-0000-0000000000b2')$q$, 'violates check constraint'));
select rlstest.check('supervisor cannot add an Invoices document', rlstest.fails_like($q$insert into public.documents(project_id,name,category,storage_path,uploaded_by) values ('20000000-0000-0000-0000-000000000001','a.pdf','Invoices','p','00000000-0000-0000-0000-0000000000b2')$q$, 'row-level security'));
select rlstest.check('cannot attribute an upload to someone else', rlstest.fails_like($q$insert into public.documents(project_id,name,category,storage_path,uploaded_by) values ('20000000-0000-0000-0000-000000000001','a.pdf','Permits','p','00000000-0000-0000-0000-0000000000b1')$q$, 'row-level security'));
select rlstest.check('supervisor can add a Permits document as themselves', rlstest.affects($q$insert into public.documents(project_id,name,category,storage_path,uploaded_by) values ('20000000-0000-0000-0000-000000000001','a.pdf','Permits','p','00000000-0000-0000-0000-0000000000b2')$q$, 1));
select rlstest.check('document on an ARCHIVED project rejected', rlstest.fails_like($q$insert into public.documents(project_id,name,category,storage_path,uploaded_by) values ('20000000-0000-0000-0000-000000000003','a.pdf','Permits','p','00000000-0000-0000-0000-0000000000b2')$q$, 'archived'));
select rlstest.check('supervisor cannot see the Invoices document', (select count(*) from public.documents where category = 'Invoices') = 0);
select rlstest.as_user('00000000-0000-0000-0000-0000000000b4');
select rlstest.check('finance can see the Invoices document', (select count(*) from public.documents where category = 'Invoices') = 1);

-- ===================================================== K. purchase orders =====================================================
select rlstest.as_user('00000000-0000-0000-0000-0000000000b2');
select rlstest.check('supervisor cannot approve', rlstest.fails_like($q$select public.advance_purchase_order('60000000-0000-0000-0000-000000000001')$q$, 'Only a manager'));
select rlstest.as_user('00000000-0000-0000-0000-0000000000a2');
select rlstest.check('other-org admin cannot advance an org1 PO', rlstest.fails_like($q$select public.advance_purchase_order('60000000-0000-0000-0000-000000000001')$q$, '^Not allowed$'));
select rlstest.as_user('00000000-0000-0000-0000-0000000000b5');
select rlstest.check('procurement cannot approve', rlstest.fails_like($q$select public.advance_purchase_order('60000000-0000-0000-0000-000000000001')$q$, 'Only a manager'));
select rlstest.check('direct PO status UPDATE denied (privilege)', rlstest.fails_like($q$update public.purchase_orders set status='Received' where id='60000000-0000-0000-0000-000000000001'$q$, 'permission denied'));
select rlstest.check('PO created directly as Received rejected', rlstest.fails_like($q$insert into public.purchase_orders(org_id,status) values ('10000000-0000-0000-0000-000000000001','Received')$q$, 'row-level security'));
select rlstest.check('PO referencing another organisation''s project rejected', rlstest.fails_like($q$insert into public.purchase_orders(org_id,project_id,status) values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','Requested')$q$, 'different organisation'));
select rlstest.as_user('00000000-0000-0000-0000-0000000000b1');
select rlstest.check('PM approves', rlstest.val($q$select public.advance_purchase_order('60000000-0000-0000-0000-000000000001')$q$) = 'Approved');
select rlstest.as_user('00000000-0000-0000-0000-0000000000b5');
select rlstest.check('procurement marks Approved -> Ordered', rlstest.val($q$select public.advance_purchase_order('60000000-0000-0000-0000-000000000001')$q$) = 'Ordered');
select rlstest.check('procurement marks Ordered -> Received', rlstest.val($q$select public.advance_purchase_order('60000000-0000-0000-0000-000000000001')$q$) = 'Received');
select rlstest.check('receipt added the 5 bags exactly once (10 -> 15)', rlstest.val($q$select quantity::text from public.materials where id='40000000-0000-0000-0000-000000000001'$q$) = '15');
select rlstest.check('receiving again is rejected', rlstest.fails_like($q$select public.advance_purchase_order('60000000-0000-0000-0000-000000000001')$q$, 'cannot be advanced'));
select rlstest.check('...and stock is unchanged', rlstest.val($q$select quantity::text from public.materials where id='40000000-0000-0000-0000-000000000001'$q$) = '15');
select rlstest.check('a received PO cannot be cancelled', rlstest.fails_like($q$select public.cancel_purchase_order('60000000-0000-0000-0000-000000000001')$q$, 'cannot be cancelled'));
select rlstest.as_user('00000000-0000-0000-0000-0000000000b1');
select rlstest.check('a PO with no lines cannot be advanced', rlstest.fails_like($q$select public.advance_purchase_order('60000000-0000-0000-0000-000000000003')$q$, 'without lines'));
select rlstest.as_user('00000000-0000-0000-0000-0000000000b5');
select rlstest.check('procurement can cancel an open PO', rlstest.succeeds($q$select public.cancel_purchase_order('60000000-0000-0000-0000-000000000002')$q$));
select rlstest.check('...and its status is Cancelled', rlstest.val($q$select status from public.purchase_orders where id='60000000-0000-0000-0000-000000000002'$q$) = 'Cancelled');
select rlstest.check('a cancelled PO cannot be advanced', rlstest.fails_like($q$select public.advance_purchase_order('60000000-0000-0000-0000-000000000002')$q$, 'cannot be advanced'));
select rlstest.as_user('00000000-0000-0000-0000-0000000000b3');
select rlstest.check('team member cannot cancel a PO', rlstest.fails_like($q$select public.cancel_purchase_order('60000000-0000-0000-0000-000000000003')$q$, 'Not allowed'));

select rlstest.as_root();
\echo 'RLS SUITE COMPLETE: every check above printed PASS (a failure would have aborted with FAILED: <name>)'
rollback;
