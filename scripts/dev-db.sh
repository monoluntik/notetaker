#!/usr/bin/env bash
# Локальный PostgreSQL без Docker (бинарники из pip-пакета pixeltable-pgserver).
# Используется, когда Docker недоступен. Основной способ запуска — docker compose.
# Usage: scripts/dev-db.sh start|stop|status|psql
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA="$ROOT/.pgdata"
PORT="${PGPORT:-5433}"
# Каталог pginstall/ содержит PostgreSQL 16 — та же мажорная версия, что в docker-compose.
BIN="$(ls -d "$ROOT"/.venv/lib/python3*/site-packages/pixeltable_pgserver/pginstall/bin | head -1)"
[ -x "$BIN/pg_ctl" ] || { echo "pg_ctl not found: pip install pixeltable-pgserver"; exit 1; }

case "${1:-start}" in
  start)
    if [ ! -f "$DATA/PG_VERSION" ]; then
      "$BIN/initdb" -D "$DATA" -U postgres --auth=trust -E UTF8 >/dev/null
    fi
    if ! "$BIN/pg_ctl" -D "$DATA" status >/dev/null 2>&1; then
      "$BIN/pg_ctl" -D "$DATA" -l "$DATA/server.log" -w \
        -o "-h 127.0.0.1 -p $PORT -k $DATA" start
    fi
    for db in notetaker notetaker_test; do
      "$BIN/psql" -h 127.0.0.1 -p "$PORT" -U postgres -tAc \
        "select 1 from pg_database where datname='$db'" | grep -q 1 \
        || "$BIN/createdb" -h 127.0.0.1 -p "$PORT" -U postgres "$db"
    done
    echo "PostgreSQL on 127.0.0.1:$PORT (dbs: notetaker, notetaker_test)";;
  stop)   "$BIN/pg_ctl" -D "$DATA" -m fast stop;;
  status) "$BIN/pg_ctl" -D "$DATA" status;;
  psql)   shift; "$BIN/psql" -h 127.0.0.1 -p "$PORT" -U postgres -d "${PGDATABASE:-notetaker}" "$@";;
esac
