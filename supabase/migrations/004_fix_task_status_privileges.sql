-- BuildSpace 004: CORRECTIVE migration (apply after 001, 002, 003). Idempotent: safe to run more than once.
--
-- ROOT CAUSE (003): `grant update (..., status, ..., pct) on tasks to authenticated` + the role-scoped tasks_write policy let
-- managers/supervisors UPDATE tasks.status and tasks.pct directly, skipping set_task_status() and every rule inside it
-- (transition checks, finish-to-start predecessors, completion => 100%). INSERT was also unrestricted, so a task could be
-- created already "Completed".
--
-- FIX (defence in depth, three independent layers):
--   1. privileges  - clients get UPDATE only on columns that are safe to edit directly; status/pct are not among them
--   2. triggers    - even if a broad GRANT is re-introduced later, client roles (authenticated/anon) cannot change status/pct
--                    or insert non-initial tasks; only the SECURITY DEFINER functions (running as the owner) can
--   3. functions   - set_task_status() / set_task_progress() hold all the business rules
--
-- ALSO FIXED HERE (found while auditing 001-003): unsafe search_path on definer functions (pg_temp is searched first unless
-- names are schema-qualified), PUBLIC execute leaking past `revoke ... from anon`, no way to cancel a purchase order,
-- archived-project writes, expenses movable across organisations, refunds above paid, free-text document categories that
-- bypassed the Invoices/Contracts restriction, zero-item PO receipts, and membership integrity of assignees.
--
-- STATUS: NOT executed against a database when authored (none was available). Run `npm run test:rls` on a disposable DB.
-- Requirement: run as the role that owns the tables (Supabase: `postgres`, which has BYPASSRLS). Definer functions run as that owner.

-- =====================================================================================================================
-- 0. Helper functions: empty search_path + fully qualified names (no reliance on the caller's search_path / pg_temp)
-- =====================================================================================================================
create or replace function public.member_role(o uuid) returns text language sql stable security definer set search_path = '' as
$fn$ select m.role from public.organization_members m where m.org_id = o and m.user_id = auth.uid() and m.active $fn$;

create or replace function public.is_member(o uuid) returns boolean language sql stable security definer set search_path = '' as
$fn$ select exists (select 1 from public.organization_members m where m.org_id = o and m.user_id = auth.uid() and m.active) $fn$;

create or replace function public.has_role(o uuid, roles text[]) returns boolean language sql stable security definer set search_path = '' as
$fn$ select coalesce(public.member_role(o) = any(roles), false) $fn$;

create or replace function public.project_org(p uuid) returns uuid language sql stable security definer set search_path = '' as
$fn$ select pr.org_id from public.projects pr where pr.id = p $fn$;

create or replace function public.project_is_archived(p uuid) returns boolean language sql stable security definer set search_path = '' as
$fn$ select coalesce((select pr.status = 'Archived' from public.projects pr where pr.id = p), false) $fn$;

create or replace function public.can_see_doc(o uuid, c text) returns boolean language sql stable security definer set search_path = '' as
$fn$ select public.is_member(o) and (c not in ('Invoices', 'Contracts') or public.has_role(o, array['Administrator','Project Manager','Finance Officer','Procurement Officer'])) $fn$;

-- =====================================================================================================================
-- 1. tasks: column privileges (layer 1) -- status and pct are NOT directly writable by clients
-- =====================================================================================================================
-- PostgreSQL table-level REVOKE does NOT remove previously granted column-level privileges.
-- Revoke the old column grants explicitly before rebuilding the least-privilege allowlist.
revoke update, insert on public.tasks from authenticated, anon, public;
revoke update (id, project_id, title, description, priority, status, start_date, due_date, effort_hours, pct, created_at)
  on public.tasks from authenticated, anon, public;
revoke insert (id, project_id, title, description, priority, status, start_date, due_date, effort_hours, pct, created_at)
  on public.tasks from authenticated, anon, public;
grant update (title, description, priority, start_date, due_date, effort_hours) on public.tasks to authenticated;
grant insert (project_id, title, description, priority, start_date, due_date, effort_hours) on public.tasks to authenticated;   -- status/pct take their defaults ('To Do', 0)

-- RLS: split the broad FOR ALL policy into explicit per-command policies (same role predicate as before; no widening)
drop policy if exists tasks_write on public.tasks;
drop policy if exists tasks_insert on public.tasks; drop policy if exists tasks_update on public.tasks; drop policy if exists tasks_delete on public.tasks;
create policy tasks_insert on public.tasks for insert
  with check (public.has_role(public.project_org(project_id), array['Administrator','Project Manager','Site Supervisor']));
create policy tasks_update on public.tasks for update
  using (public.has_role(public.project_org(project_id), array['Administrator','Project Manager','Site Supervisor']))
  with check (public.has_role(public.project_org(project_id), array['Administrator','Project Manager','Site Supervisor']));
create policy tasks_delete on public.tasks for delete
  using (public.has_role(public.project_org(project_id), array['Administrator','Project Manager','Site Supervisor']));
-- (003's dropped tasks_status policy stays dropped; tasks_read from 002 is unchanged.)

-- =====================================================================================================================
-- 2. tasks: triggers (layer 2) -- NOT security definer, so current_user is the role actually running the statement.
--    Inside set_task_status()/set_task_progress() (security definer) current_user is the function owner, so they pass.
-- =====================================================================================================================
create or replace function public.guard_task_write() returns trigger language plpgsql set search_path = '' as $fn$
declare client boolean := current_user in ('authenticated', 'anon');
begin
  if tg_op = 'INSERT' then
    if client and (new.status not in ('Backlog', 'To Do') or coalesce(new.pct, 0) <> 0) then
      raise exception 'New tasks must start as Backlog or To Do at 0%% progress';
    end if;
    if client and public.project_is_archived(new.project_id) then raise exception 'Project is archived'; end if;
  else
    if client and (new.status is distinct from old.status or new.pct is distinct from old.pct) then
      raise exception 'Task status and progress can only be changed through set_task_status() / set_task_progress()';
    end if;
    if new.project_id is distinct from old.project_id then raise exception 'A task cannot be moved to another project'; end if;
    if client and public.project_is_archived(old.project_id) then raise exception 'Project is archived'; end if;
  end if;
  return new;
end $fn$;
drop trigger if exists tasks_immutable_project on public.tasks;      -- superseded by guard_task_write()
drop trigger if exists tasks_guard on public.tasks;
create trigger tasks_guard before insert or update on public.tasks for each row execute function public.guard_task_write();

-- =====================================================================================================================
-- 3. tasks: the approved write paths (layer 3)
-- =====================================================================================================================
create or replace function public.set_task_status(p_task uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $fn$
declare t public.tasks%rowtype; o uuid;
begin
  if auth.uid() is null then raise exception 'Not allowed'; end if;
  select * into t from public.tasks where id = p_task for update;                 -- row lock: concurrent changes serialise
  -- one message for "missing" and "other organisation" so ids cannot be probed across organisations
  if not found then raise exception 'Not allowed'; end if;
  o := public.project_org(t.project_id);
  if o is null or not public.is_member(o) then raise exception 'Not allowed'; end if;
  if not (public.has_role(o, array['Administrator','Project Manager','Site Supervisor'])
          or exists (select 1 from public.task_assignees a where a.task_id = p_task and a.user_id = auth.uid())) then
    raise exception 'Only managers, supervisors or the assignee may change this task''s status';
  end if;
  if public.project_is_archived(t.project_id) then raise exception 'Project is archived'; end if;
  if p_status is null or p_status not in ('Backlog','To Do','In Progress','Blocked','Completed','Cancelled') then raise exception 'Invalid status'; end if;
  if t.status = p_status then return; end if;
  if t.status = 'Cancelled' and p_status not in ('Backlog','To Do') then raise exception 'A cancelled task can only be restored to Backlog or To Do'; end if;
  if t.status = 'Completed' and p_status not in ('In Progress','To Do') then raise exception 'A completed task can only be reopened to To Do or In Progress'; end if;
  if p_status in ('In Progress','Completed') and exists (
       select 1 from public.task_dependencies d join public.tasks pt on pt.id = d.depends_on
       where d.task_id = p_task and pt.status not in ('Completed','Cancelled')) then
    raise exception 'Finish the predecessor task first';
  end if;
  update public.tasks
     set status = p_status,
         pct = case when p_status = 'Completed' then 100 when t.status = 'Completed' then least(t.pct, 99) else t.pct end
   where id = p_task;
end $fn$;

create or replace function public.set_task_progress(p_task uuid, p_pct integer) returns void
language plpgsql security definer set search_path = '' as $fn$
declare t public.tasks%rowtype; o uuid;
begin
  if auth.uid() is null then raise exception 'Not allowed'; end if;
  select * into t from public.tasks where id = p_task for update;
  if not found then raise exception 'Not allowed'; end if;
  o := public.project_org(t.project_id);
  if o is null or not public.is_member(o) then raise exception 'Not allowed'; end if;
  if not (public.has_role(o, array['Administrator','Project Manager','Site Supervisor'])
          or exists (select 1 from public.task_assignees a where a.task_id = p_task and a.user_id = auth.uid())) then
    raise exception 'Only managers, supervisors or the assignee may update this task''s progress';
  end if;
  if public.project_is_archived(t.project_id) then raise exception 'Project is archived'; end if;
  if t.status in ('Completed', 'Cancelled') then raise exception 'Reopen the task before changing its progress'; end if;
  if p_pct is null or p_pct < 0 or p_pct > 99 then raise exception 'Progress must be 0-99; complete the task with set_task_status() to reach 100'; end if;
  update public.tasks set pct = p_pct where id = p_task;
end $fn$;

-- dependencies: same project, acyclic (qualified rewrite of 002)
create or replace function public.check_task_dependency() returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  if (select project_id from public.tasks where id = new.task_id) is distinct from (select project_id from public.tasks where id = new.depends_on) then
    raise exception 'A task can only depend on a task in the same project'; end if;
  if exists (with recursive chain(id) as (select new.depends_on union select d.depends_on from public.task_dependencies d join chain c on d.task_id = c.id) select 1 from chain where id = new.task_id) then
    raise exception 'This would create a circular dependency'; end if;
  return new;
end $fn$;

-- assignees / project members must belong to the project's organisation
create or replace function public.guard_membership_ref() returns trigger language plpgsql security definer set search_path = '' as $fn$
declare o uuid;
begin
  if tg_table_name = 'task_assignees' then o := public.project_org((select t.project_id from public.tasks t where t.id = new.task_id));
  else o := public.project_org(new.project_id); end if;      -- separate statements: plpgsql resolves NEW.<field> per statement, and each table has different columns
  if o is null or not exists (select 1 from public.organization_members m where m.org_id = o and m.user_id = new.user_id and m.active) then
    raise exception 'The user is not an active member of this organisation'; end if;
  return new;
end $fn$;
drop trigger if exists task_assignees_guard on public.task_assignees;
create trigger task_assignees_guard before insert or update on public.task_assignees for each row execute function public.guard_membership_ref();
drop trigger if exists project_members_guard on public.project_members;
create trigger project_members_guard before insert or update on public.project_members for each row execute function public.guard_membership_ref();

-- =====================================================================================================================
-- 4. projects / materials / purchase orders (qualified rewrites of 003 + new checks)
-- =====================================================================================================================
create or replace function public.guard_project_update() returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  if tg_op = 'UPDATE' then
    if new.org_id is distinct from old.org_id then raise exception 'A project cannot move to another organisation'; end if;
    if new.manager_id is distinct from old.manager_id and not (public.has_role(old.org_id, array['Administrator']) or old.manager_id = auth.uid()) then
      raise exception 'Only an administrator or the current manager can change the project manager'; end if;
  end if;
  if new.manager_id is not null and (tg_op = 'INSERT' or new.manager_id is distinct from old.manager_id)
     and not exists (select 1 from public.organization_members m where m.org_id = new.org_id and m.user_id = new.manager_id and m.active and m.role in ('Administrator','Project Manager')) then
    raise exception 'The manager must be an active Project Manager or Administrator of this organisation'; end if;
  return new;
end $fn$;
drop trigger if exists projects_guard on public.projects;
create trigger projects_guard before insert or update on public.projects for each row execute function public.guard_project_update();

create or replace function public.guard_material() returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  if tg_op = 'INSERT' then
    if new.quantity <> 0 then raise exception 'Create the material with quantity 0, then record a receipt'; end if;
  else
    if new.org_id is distinct from old.org_id then raise exception 'Organisation cannot change'; end if;
    if new.unit is distinct from old.unit and old.quantity > 0 then raise exception 'Unit cannot change while stock exists'; end if;
  end if;
  if new.supplier_id is not null and (select s.org_id from public.suppliers s where s.id = new.supplier_id) is distinct from new.org_id then raise exception 'Supplier belongs to a different organisation'; end if;
  return new;
end $fn$;
drop trigger if exists materials_guard on public.materials;
create trigger materials_guard before insert or update on public.materials for each row execute function public.guard_material();
-- Layer 2 for stock: NOT security definer, so current_user is the real caller (guard_material above is definer and cannot tell).
create or replace function public.guard_material_quantity() returns trigger language plpgsql set search_path = '' as $fn$
begin
  if new.quantity is distinct from old.quantity and current_user in ('authenticated', 'anon') then
    raise exception 'Stock can only change through record_stock_movement()'; end if;
  return new;
end $fn$;
drop trigger if exists materials_quantity_guard on public.materials;
create trigger materials_quantity_guard before update on public.materials for each row execute function public.guard_material_quantity();

create or replace function public.guard_purchase_order() returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  if tg_op = 'UPDATE' and new.org_id is distinct from old.org_id then raise exception 'Organisation cannot change'; end if;
  if new.project_id is not null then
    if (select pr.org_id from public.projects pr where pr.id = new.project_id) is distinct from new.org_id then raise exception 'Project belongs to a different organisation'; end if;
    if (tg_op = 'INSERT' or new.project_id is distinct from old.project_id) and public.project_is_archived(new.project_id) then raise exception 'Project is archived'; end if;
  end if;
  if new.supplier_id is not null and (select s.org_id from public.suppliers s where s.id = new.supplier_id) is distinct from new.org_id then raise exception 'Supplier belongs to a different organisation'; end if;
  return new;
end $fn$;
drop trigger if exists po_guard on public.purchase_orders;
create trigger po_guard before insert or update on public.purchase_orders for each row execute function public.guard_purchase_order();

create or replace function public.guard_po_item() returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  if new.material_id is null then raise exception 'A purchase request line needs a material'; end if;
  if (select m.org_id from public.materials m where m.id = new.material_id) is distinct from (select po.org_id from public.purchase_orders po where po.id = new.po_id) then
    raise exception 'Material belongs to a different organisation'; end if;
  return new;
end $fn$;
drop trigger if exists po_item_guard on public.purchase_order_items;
create trigger po_item_guard before insert or update on public.purchase_order_items for each row execute function public.guard_po_item();

-- =====================================================================================================================
-- 5. inventory + purchase orders: RPCs (qualified rewrites; archived check; zero-item guard; cancel path)
-- =====================================================================================================================
create or replace function public.record_stock_movement(p_material uuid, p_kind text, p_qty numeric, p_project uuid, p_op uuid, p_note text default null)
returns numeric language plpgsql security definer set search_path = '' as $fn$
declare o uuid; q numeric;
begin
  if auth.uid() is null then raise exception 'Not allowed'; end if;
  select m.org_id into o from public.materials m where m.id = p_material for update;     -- row lock serialises concurrent movements
  if o is null or not public.has_role(o, array['Administrator','Project Manager','Procurement Officer','Site Supervisor']) then raise exception 'Not allowed'; end if;
  if p_kind is null or p_kind not in ('receipt','consumption','adjustment') then raise exception 'Invalid kind'; end if;
  if p_qty is null or p_qty = 0 or p_qty <> round(p_qty, 3) or abs(p_qty) > 1e9 or (p_kind <> 'adjustment' and p_qty < 0) then raise exception 'Invalid quantity'; end if;
  if p_kind = 'adjustment' and length(trim(coalesce(p_note, ''))) < 3 then raise exception 'An adjustment needs a reason'; end if;
  if p_kind = 'consumption' and p_project is null then raise exception 'Consumption must be charged to a project'; end if;
  if p_project is not null then
    if public.project_org(p_project) is distinct from o then raise exception 'Project belongs to a different organisation'; end if;
    if public.project_is_archived(p_project) then raise exception 'Project is archived'; end if;
  end if;
  if p_op is not null and exists (select 1 from public.inventory_transactions t where t.material_id = p_material and t.op_id = p_op) then
    select m.quantity into q from public.materials m where m.id = p_material; return q;     -- repeated submission: no second movement
  end if;
  update public.materials set quantity = quantity + case p_kind when 'consumption' then -p_qty else p_qty end, updated_at = now()
   where id = p_material returning quantity into q;                                           -- CHECK (quantity >= 0) aborts the whole call on overdraw
  insert into public.inventory_transactions(material_id, project_id, kind, quantity, created_by, op_id, note) values (p_material, p_project, p_kind, p_qty, auth.uid(), p_op, p_note);
  return q;
end $fn$;

create or replace function public.advance_purchase_order(p_po uuid) returns text language plpgsql security definer set search_path = '' as $fn$
declare po public.purchase_orders%rowtype; nx text; it record;
begin
  if auth.uid() is null then raise exception 'Not allowed'; end if;
  select * into po from public.purchase_orders where id = p_po for update;
  if not found or not public.is_member(po.org_id) then raise exception 'Not allowed'; end if;
  nx := case po.status when 'Requested' then 'Approved' when 'Approved' then 'Ordered' when 'Ordered' then 'Received' else null end;
  if nx is null then raise exception 'A % request cannot be advanced', po.status; end if;
  if nx = 'Approved' and not public.has_role(po.org_id, array['Administrator','Project Manager']) then raise exception 'Only a manager can approve a purchase request'; end if;
  if nx <> 'Approved' and not public.has_role(po.org_id, array['Administrator','Project Manager','Procurement Officer']) then raise exception 'Not allowed'; end if;
  if not exists (select 1 from public.purchase_order_items i where i.po_id = p_po) then raise exception 'A purchase request without lines cannot be advanced'; end if;
  if nx = 'Received' then
    for it in select i.id, i.material_id, i.quantity from public.purchase_order_items i where i.po_id = p_po order by i.id loop
      perform public.record_stock_movement(it.material_id, 'receipt', it.quantity, null, md5(it.id::text || ':receipt')::uuid, 'Received (PO ' || p_po::text || ')');   -- deterministic op id: receiving twice cannot double-count
    end loop;
  end if;
  update public.purchase_orders set status = nx where id = p_po;
  return nx;
end $fn$;

create or replace function public.cancel_purchase_order(p_po uuid) returns void language plpgsql security definer set search_path = '' as $fn$
declare po public.purchase_orders%rowtype;
begin
  if auth.uid() is null then raise exception 'Not allowed'; end if;
  select * into po from public.purchase_orders where id = p_po for update;
  if not found or not public.has_role(po.org_id, array['Administrator','Project Manager','Procurement Officer']) then raise exception 'Not allowed'; end if;
  if po.status not in ('Requested','Approved','Ordered') then raise exception 'A % request cannot be cancelled', po.status; end if;
  update public.purchase_orders set status = 'Cancelled' where id = p_po;
end $fn$;

-- =====================================================================================================================
-- 6. expenses and documents: integrity the database must enforce itself
-- =====================================================================================================================
create or replace function public.guard_expense() returns trigger language plpgsql security definer set search_path = '' as $fn$
declare net numeric;
begin
  if tg_op = 'UPDATE' and new.project_id is distinct from old.project_id and public.project_org(new.project_id) is distinct from public.project_org(old.project_id) then
    raise exception 'An expense cannot move to a project of another organisation'; end if;
  if (tg_op = 'INSERT' or new.project_id is distinct from old.project_id) and public.project_is_archived(new.project_id) then raise exception 'Project is archived'; end if;
  if new.is_refund then
    perform pg_advisory_xact_lock(hashtextextended(new.project_id::text, 0));             -- serialise concurrent refunds on one project
    select coalesce(sum(case when e.is_refund then -e.amount else e.amount end), 0) into net from public.expenses e
     where e.project_id = new.project_id and e.status = 'Paid' and e.id is distinct from new.id;
    if new.amount > net then raise exception 'Refund exceeds the amount paid on this project'; end if;
  end if;
  return new;
end $fn$;
drop trigger if exists expenses_guard on public.expenses;
create trigger expenses_guard before insert or update on public.expenses for each row execute function public.guard_expense();

create or replace function public.guard_document() returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  if public.project_is_archived(new.project_id) then raise exception 'Project is archived'; end if;
  return new;
end $fn$;
drop trigger if exists documents_guard on public.documents;
create trigger documents_guard before insert on public.documents for each row execute function public.guard_document();

-- categories are matched by name by can_see_doc(); free text such as 'invoices' would dodge the restriction. NOT VALID = enforced for new rows.
alter table public.documents drop constraint if exists documents_category_valid;
alter table public.documents add constraint documents_category_valid check (category in ('Contracts','Architectural drawings','Engineering plans','Permits','Invoices','Safety reports','Site photographs','Inspection reports')) not valid;
alter table public.expenses drop constraint if exists expenses_refund_paid;      -- idempotent re-add of the 002 constraint
alter table public.expenses add constraint expenses_refund_paid check (not is_refund or status = 'Paid') not valid;
alter table public.documents drop constraint if exists documents_size;
alter table public.documents add constraint documents_size check (size_bytes is null or (size_bytes > 0 and size_bytes <= 10485760)) not valid;

-- =====================================================================================================================
-- 7. function privileges: nothing executable by PUBLIC/anon; clients get exactly the functions they need
-- =====================================================================================================================
do $do$ declare r record; begin
  for r in select p.oid::regprocedure as sig from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') loop      -- skip extension-owned functions
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end $do$;
alter default privileges in schema public revoke execute on functions from public, anon;
alter default privileges in schema public revoke all on tables from anon;
-- helpers used inside RLS policies (policy expressions run as the calling role)
grant execute on function public.is_member(uuid), public.has_role(uuid, text[]), public.member_role(uuid), public.project_org(uuid),
                          public.project_is_archived(uuid), public.can_see_doc(uuid, text) to authenticated;
-- the approved write paths (RPCs)
grant execute on function public.set_task_status(uuid, text), public.set_task_progress(uuid, integer),
                          public.record_stock_movement(uuid, text, numeric, uuid, uuid, text),
                          public.advance_purchase_order(uuid), public.cancel_purchase_order(uuid) to authenticated;
-- guard_* / check_task_dependency are trigger functions: PostgreSQL checks EXECUTE only when a trigger is created, so clients need none.
