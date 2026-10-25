"""Static consistency checks for the Supabase migrations (NOT a substitute for running them on PostgreSQL)."""
import re, sys, glob
mig = sorted(glob.glob('supabase/migrations/*.sql')); txt = {f: re.sub(r'--[^\n]*', '', open(f).read()) for f in mig}
errs = []
def top_split(body):
    out, depth, cur = [], 0, ''
    for ch in body:
        if ch == '(': depth += 1
        if ch == ')': depth -= 1
        if ch == ',' and depth == 0: out.append(cur); cur = ''
        else: cur += ch
    out.append(cur); return out
# --- tables/columns from 001, plus `alter table X add column` in 002+
cols = {}
for m in re.finditer(r'create table (\w+)\((.*?)\);\s*(?=create|alter|do|--|$)', txt[mig[0]], re.S):
    t, body = m.group(1), m.group(2); cols[t] = set()
    for part in top_split(body):
        w = part.strip().split()
        if w and w[0].lower() not in ('primary', 'check', 'unique', 'foreign', 'constraint'): cols[t].add(w[0])
for f in mig[1:]:
    for m in re.finditer(r'alter table (?:public\.)?(\w+)\s+add column if not exists (\w+)(?:.*?,\s*add column if not exists (\w+))*', txt[f]):
        pass
    for m in re.finditer(r'alter table (?:public\.)?(\w+)((?:\s+add column if not exists \w+[^,;]*,?)+);', txt[f]):
        for c in re.findall(r'add column if not exists (\w+)', m.group(2)): cols.setdefault(m.group(1), set()).add(c)
print('tables found in 001:', len(cols))
for f, s in txt.items():
    # 1 dollar quote balance
    for tag in set(re.findall(r'\$[a-z]*\$', s)):
        if s.count(tag) % 2: errs.append(f'{f}: unbalanced {tag}')
    # 2 grant (cols) on table
    for m in re.finditer(r'grant (?:update|insert) \(([^)]*)\) on (?:public\.)?(\w+)', s):
        t = m.group(2)
        for c in [x.strip() for x in m.group(1).split(',')]:
            if t not in cols: errs.append(f'{f}: grant on unknown table {t}')
            elif c not in cols[t]: errs.append(f'{f}: grant column {t}.{c} does not exist')
    # 3 tables referenced as public.<name>
    for t in set(re.findall(r'public\.(\w+)(?=[\s,;)]|$)', s)):
        if t in cols: continue
        if re.search(rf'public\.{t}\s*\(', s) or re.search(rf'function public\.{t}', s) or re.search(rf'public\.{t}%rowtype', s): continue
        errs.append(f'{f}: public.{t} is not a known table (or function)') if not re.search(rf'public\.{t}\b', ' '.join(re.findall(r'function public\.\w+', s))) else None
    # 4 policy / trigger idempotency (004 only, which claims to be re-runnable)
    if '004' in f:
        for p, t in re.findall(r'create policy (\w+) on (?:public\.)?(\w+)', s):
            if not re.search(rf'drop policy if exists {p} on (?:public\.)?{t}', s): errs.append(f'{f}: policy {p} not dropped first')
        for tr, t in re.findall(r'create trigger (\w+) \w+ [\w ]+ on (?:public\.)?(\w+)', s):
            if not re.search(rf'drop trigger if exists {tr} on (?:public\.)?{t}', s): errs.append(f'{f}: trigger {tr} not dropped first')
        for c in re.findall(r'add constraint (\w+)', s):
            if not re.search(rf'drop constraint if exists {c}', s): errs.append(f'{f}: constraint {c} not dropped first')
# 5 columns referenced via new./old. in trigger functions of 004, mapped to their table
fn_table = {'guard_task_write': 'tasks', 'guard_project_update': 'projects', 'guard_material': 'materials', 'guard_material_quantity': 'materials', 'guard_purchase_order': 'purchase_orders',
            'guard_po_item': 'purchase_order_items', 'guard_expense': 'expenses', 'guard_document': 'documents', 'check_task_dependency': 'task_dependencies'}
s = txt[[f for f in mig if '004' in f][0]]
for fn, t in fn_table.items():
    m = re.search(rf'function public\.{fn}\(\).*?\$fn\$(.*?)\$fn\$', s, re.S)
    if not m: errs.append(f'function {fn} not found'); continue
    for c in set(re.findall(r'\b(?:new|old)\.(\w+)', m.group(1))):
        if c not in cols.get(t, set()): errs.append(f'{fn}: {t}.{c} does not exist')
# 6 security definer functions must pin an empty search_path, and be schema qualified
for f in mig[-1:]:
    for m in re.finditer(r'create or replace function (public\.\w+)\(.*?(?=\$fn\$)', txt[f], re.S):
        head = m.group(0)
        if 'security definer' in head and "set search_path = ''" not in head: errs.append(f'{m.group(1)}: security definer without empty search_path')
print('ERRORS:' if errs else 'static checks: no problems found'); [print(' -', e) for e in errs]; sys.exit(1 if errs else 0)
