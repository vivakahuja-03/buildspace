-- BuildSpace 002: role-based RLS, integrity rules and private document storage.
-- STATUS: written for review. NOT executed against a live Postgres/Supabase project (none was available when this was authored).
-- Test it on a throw-away Supabase project with the checks in supabase/TESTING.md before relying on it.
-- Assumes 001_schema.sql has been applied. NOTE: do not re-run after 003/004 (it drops every policy in `public`). Superseded in part by 003 and 004.

-- ---------- helpers (security definer, pinned search_path) ----------
create or replace function public.member_role(o uuid) returns text language sql stable security definer set search_path = public as
$$ select role from organization_members where org_id = o and user_id = auth.uid() and active $$;
create or replace function public.has_role(o uuid, roles text[]) returns boolean language sql stable security definer set search_path = public as
$$ select coalesce(public.member_role(o) = any(roles), false) $$;
create or replace function public.project_org(p uuid) returns uuid language sql stable security definer set search_path = public as
$$ select org_id from projects where id = p $$;
create or replace function public.is_member(o uuid) returns boolean language sql stable security definer set search_path = public as
$$ select exists(select 1 from organization_members where org_id = o and user_id = auth.uid() and active) $$;

-- ---------- schema additions that match the React app ----------
alter table tasks drop constraint if exists tasks_status_check;
alter table tasks add constraint tasks_status_check check (status in ('Backlog','To Do','In Progress','Blocked','Completed','Cancelled'));
alter table expenses add column if not exists is_refund boolean not null default false;
alter table expenses add column if not exists invoice_no text;
alter table expenses drop constraint if exists expenses_refund_paid;
alter table expenses add constraint expenses_refund_paid check (not is_refund or status = 'Paid') not valid;
alter table documents add column if not exists mime_type text, add column if not exists size_bytes bigint, add column if not exists content_hash text, add column if not exists storage_provider text not null default 'supabase';
alter table documents drop constraint if exists documents_size;
alter table documents add constraint documents_size check (size_bytes is null or (size_bytes > 0 and size_bytes <= 10485760)) not valid;
create unique index if not exists documents_project_hash on documents(project_id, content_hash) where content_hash is not null;
alter table inventory_transactions add column if not exists op_id uuid, add column if not exists note text;
create unique index if not exists inventory_op_id on inventory_transactions(op_id) where op_id is not null;

-- ---------- integrity: dependencies must be same-project and acyclic ----------
create or replace function public.check_task_dependency() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select project_id from tasks where id = new.task_id) <> (select project_id from tasks where id = new.depends_on) then
    raise exception 'A task can only depend on a task in the same project'; end if;
  if exists (with recursive chain(id) as (select new.depends_on union select d.depends_on from task_dependencies d join chain c on d.task_id = c.id) select 1 from chain where id = new.task_id) then
    raise exception 'This would create a circular dependency'; end if;
  return new;
end $$;
drop trigger if exists task_dependency_check on task_dependencies;
create trigger task_dependency_check before insert or update on task_dependencies for each row execute function public.check_task_dependency();

-- ---------- atomic, idempotent, never-negative stock movements ----------
create or replace function public.record_stock_movement(p_material uuid, p_kind text, p_qty numeric, p_project uuid, p_op uuid, p_note text default null)
returns numeric language plpgsql security definer set search_path = public as $$
declare o uuid; q numeric;
begin
  select org_id into o from materials where id = p_material;
  if o is null or not public.has_role(o, array['Administrator','Project Manager','Procurement Officer','Site Supervisor']) then raise exception 'Not allowed'; end if;
  if p_kind not in ('receipt','consumption','adjustment') then raise exception 'Invalid kind'; end if;
  if p_qty = 0 or (p_kind <> 'adjustment' and p_qty < 0) then raise exception 'Invalid quantity'; end if;
  if p_op is not null and exists (select 1 from inventory_transactions where op_id = p_op) then
    select quantity into q from materials where id = p_material; return q; end if;   -- repeated request: no-op
  update materials set quantity = quantity + case p_kind when 'consumption' then -p_qty else p_qty end, updated_at = now()
    where id = p_material returning quantity into q;                                 -- row lock serialises concurrent calls; CHECK (quantity >= 0) rejects overdraw
  insert into inventory_transactions(material_id, project_id, kind, quantity, created_by, op_id, note) values (p_material, p_project, p_kind, p_qty, auth.uid(), p_op, p_note);
  return q;
end $$;
revoke all on function public.record_stock_movement(uuid, text, numeric, uuid, uuid, text) from public;
grant execute on function public.record_stock_movement(uuid, text, numeric, uuid, uuid, text) to authenticated;

-- ---------- row level security: drop old policies, then recreate by role ----------
do $$ declare r record; begin
  for r in select schemaname, tablename, policyname from pg_policies where schemaname = 'public' loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;
do $$ declare t text; begin
  foreach t in array array['organizations','profiles','organization_members','projects','project_members','project_milestones','tasks','task_assignees','task_dependencies','task_comments','suppliers','materials','inventory_transactions','purchase_orders','purchase_order_items','budgets','expenses','documents','activity_logs','notifications'] loop
    execute format('alter table %I enable row level security', t); end loop; end $$;

create policy org_read on organizations for select using (is_member(id));
create policy profile_read on profiles for select using (id = auth.uid() or exists (select 1 from organization_members a join organization_members b on a.org_id = b.org_id where a.user_id = auth.uid() and a.active and b.user_id = profiles.id));
create policy profile_update on profiles for update using (id = auth.uid()) with check (id = auth.uid());
create policy members_read on organization_members for select using (is_member(org_id));
create policy members_admin on organization_members for all using (has_role(org_id, array['Administrator'])) with check (has_role(org_id, array['Administrator']));

create policy projects_read on projects for select using (is_member(org_id));
create policy projects_write on projects for all using (has_role(org_id, array['Administrator','Project Manager'])) with check (has_role(org_id, array['Administrator','Project Manager']));
create policy pmembers_read on project_members for select using (is_member(project_org(project_id)));
create policy pmembers_write on project_members for all using (has_role(project_org(project_id), array['Administrator','Project Manager'])) with check (has_role(project_org(project_id), array['Administrator','Project Manager']));
create policy milestones_read on project_milestones for select using (is_member(project_org(project_id)));
create policy milestones_write on project_milestones for all using (has_role(project_org(project_id), array['Administrator','Project Manager'])) with check (has_role(project_org(project_id), array['Administrator','Project Manager']));

create policy tasks_read on tasks for select using (is_member(project_org(project_id)));
create policy tasks_write on tasks for all using (has_role(project_org(project_id), array['Administrator','Project Manager','Site Supervisor'])) with check (has_role(project_org(project_id), array['Administrator','Project Manager','Site Supervisor']));
create policy tasks_status on tasks for update using (is_member(project_org(project_id))) with check (is_member(project_org(project_id)));  -- any member may move a task between statuses
create policy tassign_read on task_assignees for select using (is_member(project_org((select project_id from tasks where id = task_id))));
create policy tassign_write on task_assignees for all using (has_role(project_org((select project_id from tasks where id = task_id)), array['Administrator','Project Manager','Site Supervisor'])) with check (has_role(project_org((select project_id from tasks where id = task_id)), array['Administrator','Project Manager','Site Supervisor']));
create policy tdep_read on task_dependencies for select using (is_member(project_org((select project_id from tasks where id = task_id))));
create policy tdep_write on task_dependencies for all using (has_role(project_org((select project_id from tasks where id = task_id)), array['Administrator','Project Manager','Site Supervisor'])) with check (has_role(project_org((select project_id from tasks where id = task_id)), array['Administrator','Project Manager','Site Supervisor']));
create policy tcomment_read on task_comments for select using (is_member(project_org((select project_id from tasks where id = task_id))));
create policy tcomment_insert on task_comments for insert with check (author_id = auth.uid() and is_member(project_org((select project_id from tasks where id = task_id))));

create policy suppliers_read on suppliers for select using (is_member(org_id));
create policy suppliers_write on suppliers for all using (has_role(org_id, array['Administrator','Project Manager','Procurement Officer'])) with check (has_role(org_id, array['Administrator','Project Manager','Procurement Officer']));
create policy materials_read on materials for select using (is_member(org_id));
create policy materials_write on materials for all using (has_role(org_id, array['Administrator','Project Manager','Procurement Officer','Site Supervisor'])) with check (has_role(org_id, array['Administrator','Project Manager','Procurement Officer','Site Supervisor']));
create policy invtx_read on inventory_transactions for select using (is_member((select org_id from materials where id = material_id)));
-- no insert/update/delete policy: movements are written only through record_stock_movement()
create policy po_read on purchase_orders for select using (is_member(org_id));
create policy po_write on purchase_orders for all using (has_role(org_id, array['Administrator','Project Manager','Procurement Officer'])) with check (has_role(org_id, array['Administrator','Project Manager','Procurement Officer']));
create policy poi_read on purchase_order_items for select using (is_member((select org_id from purchase_orders where id = po_id)));
create policy poi_write on purchase_order_items for all using (has_role((select org_id from purchase_orders where id = po_id), array['Administrator','Project Manager','Procurement Officer'])) with check (has_role((select org_id from purchase_orders where id = po_id), array['Administrator','Project Manager','Procurement Officer']));

create policy budgets_read on budgets for select using (is_member(project_org(project_id)));
create policy budgets_write on budgets for all using (has_role(project_org(project_id), array['Administrator','Project Manager','Finance Officer'])) with check (has_role(project_org(project_id), array['Administrator','Project Manager','Finance Officer']));
create policy expenses_read on expenses for select using (is_member(project_org(project_id)));
create policy expenses_insert on expenses for insert with check (has_role(project_org(project_id), array['Administrator','Project Manager','Finance Officer']));
create policy expenses_update on expenses for update using (has_role(project_org(project_id), array['Administrator','Project Manager','Finance Officer']) and status = 'Pending') with check (has_role(project_org(project_id), array['Administrator','Project Manager','Finance Officer']));  -- paid rows are immutable; reverse with a refund row
create policy expenses_delete on expenses for delete using (has_role(project_org(project_id), array['Administrator','Project Manager','Finance Officer']) and status = 'Pending');

create or replace function public.can_see_doc(o uuid, c text) returns boolean language sql stable security definer set search_path = public as
$$ select is_member(o) and (c not in ('Invoices','Contracts') or has_role(o, array['Administrator','Project Manager','Finance Officer','Procurement Officer'])) $$;
create policy docs_read on documents for select using (public.can_see_doc(project_org(project_id), category));
create policy docs_insert on documents for insert with check (uploaded_by = auth.uid() and has_role(project_org(project_id), array['Administrator','Project Manager','Site Supervisor','Procurement Officer','Finance Officer']) and public.can_see_doc(project_org(project_id), category));
create policy docs_delete on documents for delete using (public.can_see_doc(project_org(project_id), category) and (has_role(project_org(project_id), array['Administrator','Project Manager']) or uploaded_by = auth.uid()));

create policy activity_read on activity_logs for select using (is_member(org_id));
create policy activity_insert on activity_logs for insert with check (is_member(org_id) and actor_id = auth.uid());
create policy notif_own on notifications for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- private storage bucket for documents ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('documents', 'documents', false, 10485760,
  array['application/pdf','image/png','image/jpeg','image/webp','text/plain','text/csv','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation','application/acad','application/x-acad','application/octet-stream','image/vnd.dwg','application/dxf','image/vnd.dxf'])
  on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists documents_obj_read on storage.objects; drop policy if exists documents_obj_insert on storage.objects; drop policy if exists documents_obj_delete on storage.objects;
-- The React client writes objects under "<auth user id>/<project>/<doc id>-<name>", so access is scoped to the owner of the folder.
-- TODO (when the database layer is connected): switch the path prefix to the organisation id and scope by is_member()/can_see_doc() via the documents row.
create policy documents_obj_read on storage.objects for select to authenticated using (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);
create policy documents_obj_insert on storage.objects for insert to authenticated with check (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);
create policy documents_obj_delete on storage.objects for delete to authenticated using (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);
