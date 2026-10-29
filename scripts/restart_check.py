"""Проверка на реальных процессах: SIGKILL backend → рестарт → данные и напоминания.

Запуск: scripts/dev-db.sh start && .venv/bin/python scripts/restart_check.py
Использует БД notetaker_e2e (пересоздаётся), SMTP-приёмник aiosmtpd на :1026, backend на :8012.
"""

import os
import signal
import subprocess
import sys
import time
from datetime import UTC, datetime, timedelta
from email import message_from_bytes, policy
from pathlib import Path

import httpx
from aiosmtpd.controller import Controller
from sqlalchemy import create_engine, text

ROOT = Path(__file__).resolve().parent.parent
DB = os.environ.get("E2E_DATABASE_URL", "postgresql+psycopg://postgres@127.0.0.1:5433/notetaker_e2e")
API = "http://127.0.0.1:8012/api"
RECEIVED: list[str] = []


class Sink:
    async def handle_DATA(self, server, session, envelope):
        RECEIVED.append(str(message_from_bytes(envelope.content, policy=policy.default)["Subject"]))
        return "250 OK"


def start_backend() -> subprocess.Popen:
    env = os.environ | {
        "NOTETAKER_DATABASE_URL": DB,
        "NOTETAKER_EMAIL_BACKEND": "smtp",
        "NOTETAKER_SMTP_PORT": "1026",
        "NOTETAKER_SCHEDULER_INTERVAL_SECONDS": "1",
    }
    p = subprocess.Popen([str(ROOT / ".venv/bin/uvicorn"), "app.main:app", "--port", "8012"],
                         cwd=ROOT / "backend", env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(100):
        try:
            if httpx.get(f"{API}/health").status_code == 200:
                return p
        except httpx.HTTPError:
            time.sleep(0.1)
    raise RuntimeError("backend did not start")


def log(msg: str) -> None:
    print(f"[{datetime.now():%H:%M:%S}] {msg}", flush=True)


def main() -> int:
    eng = create_engine(DB)
    with eng.begin() as c:
        c.execute(text("DROP SCHEMA public CASCADE; CREATE SCHEMA public;"))
    subprocess.run([str(ROOT / ".venv/bin/alembic"), "upgrade", "head"], cwd=ROOT / "backend",
                   env=os.environ | {"NOTETAKER_DATABASE_URL": DB}, check=True, capture_output=True)
    smtp = Controller(Sink(), hostname="127.0.0.1", port=1026)
    smtp.start()

    p = start_backend()
    log(f"backend started pid={p.pid}")
    httpx.patch(f"{API}/settings", json={"email": "me@example.com", "timezone": "Asia/Almaty"})
    tag = httpx.post(f"{API}/tags", json={"name": "restart"}).json()
    now = datetime.now(UTC).replace(microsecond=0)
    # Напоминание «за 1 час» уже наступило → уйдёт сразу; «за 10 минут» наступит через 6 с, во время простоя
    note = httpx.post(f"{API}/notes", json={
        "title": "Restart demo", "start_at": (now + timedelta(minutes=10, seconds=6)).isoformat(),
        "tag_ids": [tag["id"]], "reminders": [10, 60]}).json()
    time.sleep(2.5)
    log(f"emails before kill: {RECEIVED}")
    p.send_signal(signal.SIGKILL)
    p.wait()
    log("backend killed with SIGKILL; waiting 8 s (10-minute reminder fires during downtime)")
    time.sleep(8)

    p = start_backend()
    log(f"backend restarted pid={p.pid}")
    time.sleep(3)
    got = httpx.get(f"{API}/notes/{note['id']}").json()
    log(f"note after restart: title={got['title']!r} reminders={got['reminders']}")
    log(f"emails after restart: {RECEIVED}")

    p.send_signal(signal.SIGTERM)
    p.wait()
    p = start_backend()
    time.sleep(3)
    log(f"emails after second restart: {RECEIVED}")
    p.send_signal(signal.SIGTERM)
    p.wait()
    smtp.stop()

    with eng.connect() as c:
        rows = c.execute(text("SELECT offset_minutes, status, attempts FROM reminder_deliveries ORDER BY offset_minutes")).all()
    log(f"deliveries: {[tuple(r) for r in rows]}")
    ok = (
        got["title"] == "Restart demo"
        and len(RECEIVED) == 2
        and sorted(tuple(r) for r in rows) == [(10, "sent", 1), (60, "sent", 1)]
    )
    log("RESULT: OK" if ok else "RESULT: FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
