#!/usr/bin/env bash
# Backend для e2e: чистая БД notetaker_e2e, миграции, uvicorn на :8011.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export NOTETAKER_DATABASE_URL="${E2E_DATABASE_URL:-postgresql+psycopg://postgres@127.0.0.1:5433/notetaker_e2e}"
export NOTETAKER_SCHEDULER_INTERVAL_SECONDS="${NOTETAKER_SCHEDULER_INTERVAL_SECONDS:-1}"
export NOTETAKER_CORS_ORIGINS='["http://127.0.0.1:5174"]'
cd "$ROOT/backend"
"$ROOT/.venv/bin/python" - <<'PY'
import os
from sqlalchemy import create_engine, text
e = create_engine(os.environ["NOTETAKER_DATABASE_URL"])
with e.begin() as c:
    c.execute(text("DROP SCHEMA public CASCADE; CREATE SCHEMA public;"))
PY
"$ROOT/.venv/bin/alembic" upgrade head
exec "$ROOT/.venv/bin/uvicorn" app.main:app --host 127.0.0.1 --port 8011
