#!/usr/bin/env sh
# Applies migrations 001-004 (004 twice, to prove it is idempotent) and runs supabase/tests/rls_test.sql.
# Requires `psql` and a DISPOSABLE database in DATABASE_URL (the script creates roles/objects; NEVER point it at production).
#   Plain Postgres (e.g. docker run --rm -e POSTGRES_PASSWORD=x -p 54329:5432 postgres:16):
#       STUB_SUPABASE=1 DATABASE_URL=postgres://postgres:x@localhost:54329/postgres npm run test:rls
#   Supabase (local `supabase start`, or a throw-away hosted project): omit STUB_SUPABASE.
set -eu
: "${DATABASE_URL:?Set DATABASE_URL to a disposable Postgres/Supabase database}"
run() { echo ">> $1"; psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$1"; }
[ "${STUB_SUPABASE:-0}" = "1" ] && run supabase/tests/stub_supabase.sql
for f in supabase/migrations/001_schema.sql supabase/migrations/002_security_hardening.sql supabase/migrations/003_corrective_rls.sql supabase/migrations/004_fix_task_status_privileges.sql; do run "$f"; done
echo ">> re-applying 004 (idempotency check)"; run supabase/migrations/004_fix_task_status_privileges.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_test.sql
