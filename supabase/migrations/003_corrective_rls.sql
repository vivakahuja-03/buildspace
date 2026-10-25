-- BuildSpace 003: CORRECTIVE migration for 001 + 002. KNOWN DEFECTS, fixed by 004_fix_task_status_privileges.sql (always apply 004 after this):
--   grants UPDATE (status, pct) on tasks to clients (bypasses set_task_status); not idempotent (plain CREATE POLICY); search_path = public is not hijack-safe.
-- Fixes: (1) permissive tasks UPDATE policy (`tasks_status`, from 002) that let ANY org member edit ANY task column;
--        (2) direct writes to materials.quantity bypassing the movement log; (3) cross-organisation project/material/supplier
--        references in stock movements and purchase orders; (4) project ownership / org changes; (5) purchase-order approval.
-- STATUS: NOT executed against a live database (none available when authored). Run supabase/tests/rls_test.sql after applying.
-- Manual step after applying: nothing else, but review that every user has an active organization_members row.

-- ===== 1. tasks: no broad UPDATE policy. Members change status only through set_task_status() =====
drop policy if exists tasks_status on tasks;                       -- permissive policies are OR-ed: this one defeated tasks_write
revoke update on tasks from authenticated, anon;
grant update (title, description, priority, status, start_date, due_date, effort_hours, pct) on tasks to authenticated;   -- project_id/id/created_at are immutable
create or replace function public.prevent_task_project_change() returns trigger language plpgsql as $$
begin if new.project_id is distinct from old.project_id then raise exception 'A task cannot be moved to another project'; end if; return new; end $$;
drop trigger if exists tasks_immutable_project on tasks;
create trigger tasks_immutable_project before update on tasks for each row execute function public.prevent_task_project_change();

create or replace function public.set_task_status(p_task uuid, p_status text) returns void language plpgsql security definer set search_path = public as $$
declare t tasks%rowtype; o uuid;
begin
  select * into t from tasks where id = p_task for update;
  if not found then raise exception 'Task not found'; end if;
  o := project_org(t.project_id);
  if auth.uid() is null or not is_member(o) then raise exception 'Not allowed'; end if;
  if not (has_role(o, array['Administrator','Project Manager','Site Supervisor'])
          or exists (select 1 from task_assignees a where a.task_id = p_task and a.user_id = auth.uid())) then
    raise exception 'Only managers, supervisors or the assignee may change this task''s status'; end if;
  if p_status not in ('Backlog','To Do','In Progress','Blocked','Completed','Cancelled') then raise exception 'Invalid status'; end if;
  if t.status = p_status then return; end if;
  if t.status = 'Cancelled' and p_status not in ('Backlog','To Do') then raise exception 'A cancelled task can only be restored to Backlog or To Do'; end if;
  if t.status = 'Completed' and p_status not in ('In Progress','To Do') then raise exception 'A completed task can only be reopened to To Do or In Progress'; end if;
  if p_status in ('In Progress','Completed') and exists (select 1 from task_dependencies d join tasks pt on pt.id = d.depends_on
        where d.task_id = p_task and pt.status not in ('Completed','Cancelled')) then raise exception 'Finish the predecessor task first'; end if;
  update tasks set status = p_status, pct = case when p_status = 'Completed' then 100 when t.status = 'Completed' then least(pct, 99) else pct end where id = p_task;
end $$;
revoke all on function public.set_task_status(uuid, text) from public, anon;
grant execute on function public.set_task_status(uuid, text) to authenticated;

-- ===== 2. projects: org is immutable; ownership changes limited; PMs only edit projects they manage or belong to =====
drop policy if exists projects_write on projects;
revoke update on projects from authenticated, anon;
grant update (name, manager_id, location, description, start_date, end_date, budget, status) on projects to authenticated;
create policy projects_insert on projects for insert with check (has_role(org_id, array['Administrator','Project Manager']));
create policy projects_update on projects for update
  using (has_role(org_id, array['Administrator']) or (has_role(org_id, array['Project Manager']) and (manager_id = auth.uid() or exists (select 1 from project_members m where m.project_id = projects.id and m.user_id = auth.uid()))))
  with check (has_role(org_id, array['Administrator','Project Manager']));
create policy projects_delete on projects for delete using (has_role(org_id, array['Administrator']));
create or replace function public.guard_project_update() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.org_id is distinct from old.org_id then raise exception 'A project cannot move to another organisation'; end if;
  if new.manager_id is distinct from old.manager_id and not (has_role(old.org_id, array['Administrator']) or old.manager_id = auth.uid()) then
    raise exception 'Only an administrator or the current manager can change the project manager'; end if;
  if new.manager_id is not null and not exists (select 1 from organization_members where org_id = new.org_id and user_id = new.manager_id and active and role in ('Administrator','Project Manager')) then
    raise exception 'The manager must be an active Project Manager or Administrator of this organisation'; end if;
  return new;
end $$;
drop trigger if exists projects_guard on projects;
create trigger projects_guard before update on projects for each row execute function public.guard_project_update();

-- ===== 3. materials / suppliers: org immutable, quantity only through record_stock_movement() =====
drop policy if exists materials_write on materials;
revoke update on materials from authenticated, anon;
grant update (sku, name, category, unit, min_stock, unit_cost, supplier_id, location, updated_at) on materials to authenticated;   -- NOT quantity, NOT org_id
create policy materials_insert on materials for insert with check (has_role(org_id, array['Administrator','Project Manager','Procurement Officer','Site Supervisor']));
create policy materials_update on materials for update using (has_role(org_id, array['Administrator','Project Manager','Procurement Officer','Site Supervisor'])) with check (has_role(org_id, array['Administrator','Project Manager','Procurement Officer','Site Supervisor']));
create policy materials_delete on materials for delete using (has_role(org_id, array['Administrator','Project Manager']) and quantity = 0 and not exists (select 1 from inventory_transactions t where t.material_id = materials.id));
create or replace function public.guard_material() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.quantity <> 0 then raise exception 'Create the material with quantity 0, then record a receipt'; end if;
  else
    if new.org_id is distinct from old.org_id then raise exception 'Organisation cannot change'; end if;
    if new.unit is distinct from old.unit and old.quantity > 0 then raise exception 'Unit cannot change while stock exists'; end if;
  end if;
  if new.supplier_id is not null and (select org_id from suppliers where id = new.supplier_id) is distinct from new.org_id then raise exception 'Supplier belongs to a different organisation'; end if;
  return new;
end $$;
drop trigger if exists materials_guard on materials;
create trigger materials_guard before insert or update on materials for each row execute function public.guard_material();

-- ===== 4. stock movements: same-org validation, scoped idempotency, atomic =====
drop index if exists inventory_op_id;
create unique index if not exists inventory_op_per_material on inventory_transactions(material_id, op_id) where op_id is not null;
create or replace function public.record_stock_movement(p_material uuid, p_kind text, p_qty numeric, p_project uuid, p_op uuid, p_note text default null)
returns numeric language plpgsql security definer set search_path = public as $$
declare o uuid; q numeric;
begin
  if auth.uid() is null then raise exception 'Not allowed'; end if;
  select org_id into o from materials where id = p_material for update;          -- row lock serialises concurrent movements
  if o is null or not has_role(o, array['Administrator','Project Manager','Procurement Officer','Site Supervisor']) then raise exception 'Not allowed'; end if;
  if p_kind not in ('receipt','consumption','adjustment') then raise exception 'Invalid kind'; end if;
  if p_qty is null or p_qty = 0 or p_qty <> round(p_qty, 3) or abs(p_qty) > 1e9 or (p_kind <> 'adjustment' and p_qty < 0) then raise exception 'Invalid quantity'; end if;
  if p_kind = 'adjustment' and length(trim(coalesce(p_note, ''))) < 3 then raise exception 'An adjustment needs a reason'; end if;
  if p_kind = 'consumption' and p_project is null then raise exception 'Consumption must be charged to a project'; end if;
  if p_project is not null then
    if (select org_id from projects where id = p_project) is distinct from o then raise exception 'Project belongs to a different organisation'; end if;
    if (select status from projects where id = p_project) = 'Archived' then raise exception 'Project is archived'; end if;
  end if;
  if p_op is not null and exists (select 1 from inventory_transactions where material_id = p_material and op_id = p_op) then
    select quantity into q from materials where id = p_material; return q; end if;   -- repeated submission: no second movement
  update materials set quantity = quantity + case p_kind when 'consumption' then -p_qty else p_qty end, updated_at = now() where id = p_material returning quantity into q;  -- CHECK (quantity >= 0) rolls the whole call back on overdraw
  insert into inventory_transactions(material_id, project_id, kind, quantity, created_by, op_id, note) values (p_material, p_project, p_kind, p_qty, auth.uid(), p_op, p_note);
  return q;
end $$;
revoke all on function public.record_stock_movement(uuid, text, numeric, uuid, uuid, text) from public, anon;
grant execute on function public.record_stock_movement(uuid, text, numeric, uuid, uuid, text) to authenticated;

-- ===== 5. purchase orders: same-org references, approval by managers only, receipt creates stock once =====
drop policy if exists po_write on purchase_orders; drop policy if exists poi_write on purchase_order_items;
revoke update on purchase_orders from authenticated, anon;
grant update (project_id, supplier_id) on purchase_orders to authenticated;
create policy po_insert on purchase_orders for insert with check (has_role(org_id, array['Administrator','Project Manager','Procurement Officer']) and status = 'Requested');
create policy po_update on purchase_orders for update using (has_role(org_id, array['Administrator','Project Manager','Procurement Officer']) and status = 'Requested') with check (has_role(org_id, array['Administrator','Project Manager','Procurement Officer']));
create policy po_delete on purchase_orders for delete using (has_role(org_id, array['Administrator','Project Manager']) and status = 'Requested');
create policy poi_write on purchase_order_items for all using (has_role((select org_id from purchase_orders where id = po_id), array['Administrator','Project Manager','Procurement Officer']) and (select status from purchase_orders where id = po_id) = 'Requested')
  with check (has_role((select org_id from purchase_orders where id = po_id), array['Administrator','Project Manager','Procurement Officer']) and (select status from purchase_orders where id = po_id) = 'Requested');
create or replace function public.guard_purchase_order() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.org_id is distinct from old.org_id then raise exception 'Organisation cannot change'; end if;
  if new.project_id is not null and (select org_id from projects where id = new.project_id) is distinct from new.org_id then raise exception 'Project belongs to a different organisation'; end if;
  if new.supplier_id is not null and (select org_id from suppliers where id = new.supplier_id) is distinct from new.org_id then raise exception 'Supplier belongs to a different organisation'; end if;
  return new;
end $$;
drop trigger if exists po_guard on purchase_orders;
create trigger po_guard before insert or update on purchase_orders for each row execute function public.guard_purchase_order();
create or replace function public.guard_po_item() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select org_id from materials where id = new.material_id) is distinct from (select org_id from purchase_orders where id = new.po_id) then raise exception 'Material belongs to a different organisation'; end if;
  return new;
end $$;
drop trigger if exists po_item_guard on purchase_order_items;
create trigger po_item_guard before insert or update on purchase_order_items for each row execute function public.guard_po_item();

create or replace function public.advance_purchase_order(p_po uuid) returns text language plpgsql security definer set search_path = public as $$
declare po purchase_orders%rowtype; nx text; it record;
begin
  select * into po from purchase_orders where id = p_po for update;
  if not found or auth.uid() is null then raise exception 'Not allowed'; end if;
  nx := case po.status when 'Requested' then 'Approved' when 'Approved' then 'Ordered' when 'Ordered' then 'Received' else null end;
  if nx is null then raise exception 'A % request cannot be advanced', po.status; end if;
  if nx = 'Approved' and not has_role(po.org_id, array['Administrator','Project Manager']) then raise exception 'Only a manager can approve a purchase request'; end if;
  if nx <> 'Approved' and not has_role(po.org_id, array['Administrator','Project Manager','Procurement Officer']) then raise exception 'Not allowed'; end if;
  if nx = 'Received' then
    for it in select id, material_id, quantity from purchase_order_items where po_id = p_po loop
      perform public.record_stock_movement(it.material_id, 'receipt', it.quantity, null, md5(it.id::text || ':receipt')::uuid, 'Received (PO ' || p_po || ')');   -- deterministic op id: receiving twice cannot double-count
    end loop;
  end if;
  update purchase_orders set status = nx where id = p_po;
  return nx;
end $$;
revoke all on function public.advance_purchase_order(uuid) from public, anon;
grant execute on function public.advance_purchase_order(uuid) to authenticated;

-- ===== 6. defence in depth: anonymous clients get nothing =====
revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon;
grant execute on function public.is_member(uuid), public.has_role(uuid, text[]), public.member_role(uuid), public.project_org(uuid) to authenticated;
