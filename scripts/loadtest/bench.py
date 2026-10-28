"""Измерения производительности Notetaker на нагрузочной БД.

Запуск (нагрузочная БД уже заполнена scripts/loadtest/generate.sql):
    .venv/bin/python scripts/loadtest/bench.py --db postgresql+psycopg://load:load@127.0.0.1:55432/notetaker_load

Поднимает отдельный uvicorn (планировщик выключен, порт 8013), измеряет задержки HTTP-запросов,
время скана напоминаний, параллельную смешанную нагрузку и одновременные правки с проверкой
отсутствия потерянных обновлений. Результат — JSON в stdout и таблица в stderr.
"""

import argparse
import asyncio
import json
import os
import statistics
import subprocess
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

import httpx
from sqlalchemy import create_engine, text

ROOT = Path(__file__).resolve().parents[2]
PORT = 8013
API = f"http://127.0.0.1:{PORT}/api"


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def start_backend(db: str) -> subprocess.Popen:
    env = os.environ | {"NOTETAKER_DATABASE_URL": db, "NOTETAKER_SCHEDULER_ENABLED": "false",
                        "NOTETAKER_LOG_LEVEL": "WARNING"}
    p = subprocess.Popen([str(ROOT / ".venv/bin/uvicorn"), "app.main:app", "--port", str(PORT), "--workers", "4",
                          "--log-level", "warning"], cwd=ROOT / "backend", env=env)
    for _ in range(200):
        try:
            if httpx.get(f"{API}/health", timeout=2).status_code == 200:
                return p
        except httpx.HTTPError:
            time.sleep(0.1)
    p.kill()
    raise RuntimeError("backend did not start")


def pct(values, q):
    s = sorted(values)
    return s[min(len(s) - 1, int(round(q * (len(s) - 1))))]


def measure(client: httpx.Client, name: str, path: str, params=None, runs: int = 7, timeout: float = 120):
    times, info = [], {}
    for i in range(runs):
        t0 = time.perf_counter()
        try:
            r = client.get(f"{API}{path}", params=params, timeout=timeout)
        except httpx.TimeoutException:
            times.append(timeout)
            info = {"error": f"timeout {timeout}s"}
            break
        dt = time.perf_counter() - t0
        times.append(dt)
        if r.status_code != 200:
            info = {"error": f"HTTP {r.status_code}: {r.text[:200]}"}
            break
        body = r.json()
        if isinstance(body, dict):
            info = {k: body[k] for k in ("total", "overdue_total") if k in body}
            for k in ("items", "today", "week", "overdue"):
                if k in body:
                    info[f"n_{k}"] = len(body[k])
        elif isinstance(body, list):
            info = {"n": len(body)}
    res = {"name": name, "p50_ms": round(statistics.median(times) * 1000, 1), "p95_ms": round(pct(times, 0.95) * 1000, 1),
           "max_ms": round(max(times) * 1000, 1), "runs": len(times), **info}
    log(f"  {name:<46} p50 {res['p50_ms']:>9} ms  p95 {res['p95_ms']:>9} ms  {info}")
    return res


async def mixed_load(paths: list[tuple[str, dict]], clients: int, seconds: float):
    lat, errors, done = [], 0, 0
    deadline = time.perf_counter() + seconds

    async def worker(i):
        nonlocal errors, done
        async with httpx.AsyncClient(timeout=60) as c:
            k = i
            while time.perf_counter() < deadline:
                path, params = paths[k % len(paths)]
                k += 7
                t0 = time.perf_counter()
                try:
                    r = await c.get(f"{API}{path}", params=params)
                    if r.status_code != 200:
                        errors += 1
                except httpx.HTTPError:
                    errors += 1
                lat.append(time.perf_counter() - t0)
                done += 1

    t0 = time.perf_counter()
    await asyncio.gather(*(worker(i) for i in range(clients)))
    wall = time.perf_counter() - t0
    return {"clients": clients, "seconds": round(wall, 1), "requests": done, "rps": round(done / wall, 1),
            "p50_ms": round(statistics.median(lat) * 1000, 1), "p95_ms": round(pct(lat, 0.95) * 1000, 1),
            "p99_ms": round(pct(lat, 0.99) * 1000, 1), "errors": errors}


async def concurrent_edits(note_ids: list[int], clients_per_note: int):
    """Каждый клиент читает версию и сохраняет свою правку; проигравшие гонку перечитывают и повторяют.
    Проверка: итоговая версия = исходная + число успешных сохранений (ни одна правка не потеряна молча)."""
    results = {"writes_ok": 0, "conflicts_409": 0, "lost_updates": 0, "notes": len(note_ids), "clients_per_note": clients_per_note}
    async with httpx.AsyncClient(timeout=60) as c:
        start_versions = {n: (await c.get(f"{API}/notes/{n}")).json()["version"] for n in note_ids}

        async def client(note_id, k):
            for _attempt in range(50):
                v = (await c.get(f"{API}/notes/{note_id}")).json()["version"]
                r = await c.patch(f"{API}/notes/{note_id}", json={"body": f"правка клиента {k}", "version": v})
                if r.status_code == 200:
                    results["writes_ok"] += 1
                    return
                if r.status_code == 409:
                    results["conflicts_409"] += 1
                    continue
                raise RuntimeError(r.text)

        t0 = time.perf_counter()
        await asyncio.gather(*(client(n, k) for n in note_ids for k in range(clients_per_note)))
        results["seconds"] = round(time.perf_counter() - t0, 2)
        for n in note_ids:
            v = (await c.get(f"{API}/notes/{n}")).json()["version"]
            if v != start_versions[n] + clients_per_note:
                results["lost_updates"] += 1
    return results


def scan_timing(db: str):
    sys.path.insert(0, str(ROOT / "backend"))
    from app.db import make_engine, make_sessionmaker
    from app.services import reminders

    factory = make_sessionmaker(make_engine(db))
    out = []
    for _ in range(3):
        with factory() as s:
            s.execute(text("UPDATE scheduler_state SET last_scan_at = now() - interval '15 seconds'"))
            s.commit()
            t0 = time.perf_counter()
            r = reminders.scan(s, datetime.now(UTC))
            out.append(time.perf_counter() - t0)
            s.rollback()
    res = {"name": "scheduler scan (1 tick)", "p50_ms": round(statistics.median(out) * 1000, 1),
           "max_ms": round(max(out) * 1000, 1), "created": len(r.created)}
    log(f"  {res['name']:<46} p50 {res['p50_ms']:>9} ms  max {res['max_ms']} ms")
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True)
    ap.add_argument("--quick", action="store_true", help="меньше повторов (для пилота)")
    ap.add_argument("--skip", default="", help="через запятую: mixed,edits,scan")
    args = ap.parse_args()
    skip = set(args.skip.split(","))

    eng = create_engine(args.db)
    with eng.connect() as c:
        stats = dict(c.execute(text("""
            SELECT (SELECT count(*) FROM notes) notes, (SELECT count(*) FROM note_reminders) reminders,
                   (SELECT count(*) FROM reminder_deliveries) deliveries,
                   pg_size_pretty(pg_database_size(current_database())) db_size""")).mappings().one())
        heavy = c.execute(text("SELECT uid, count(*) FROM lt_owner GROUP BY 1 ORDER BY 2 DESC LIMIT 1")).one()
        median_user = c.execute(text("""SELECT uid, n FROM (SELECT uid, count(*) n FROM lt_owner GROUP BY 1) t
                                        ORDER BY n OFFSET 500 LIMIT 1""")).one()
        sample_notes = [r[0] for r in c.execute(text(
            "SELECT id FROM notes WHERE deleted_at IS NULL AND recurrence_freq = 'none' ORDER BY id DESC LIMIT 20"))]
    log(f"dataset: {stats}; heavy user tag={heavy[0]} ({heavy[1]} notes), median user tag={median_user[0]} ({median_user[1]})")

    p = start_backend(args.db)
    runs = 3 if args.quick else 7
    report = {"dataset": {**stats, "heavy_user_notes": heavy[1], "median_user_notes": median_user[1]},
              "measured_at": datetime.now().isoformat(timespec="seconds"), "latency": []}
    try:
        with httpx.Client() as client:
            client.patch(f"{API}/settings", json={"timezone": "Europe/Moscow"})
            now = datetime.now(UTC)
            month_from = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            cases = [
                ("list: page 1, sort by date", "/notes", {"page_size": 20}),
                ("list: page 1, sort by updated desc", "/notes", {"page_size": 20, "sort": "updated_at", "order": "desc"}),
                ("list: page 500 (offset 10k)", "/notes", {"page_size": 20, "page": 500}),
                ("list: page 50000 (offset 1M)", "/notes", {"page_size": 20, "page": 50000}),
                ("search: frequent word «отчёт»", "/notes", {"q": "отчёт", "page_size": 20}),
                ("search: rare word «квазар»", "/notes", {"q": "квазар", "page_size": 20}),
                ("search: by title «#12345»", "/notes", {"q": "#12345", "page_size": 20}),
                ("filter: heavy user (tag), page 1", "/notes", {"tag": heavy[0], "page_size": 20}),
                ("filter: median user (tag), page 1", "/notes", {"tag": median_user[0], "page_size": 20}),
                ("filter: heavy user + active + month", "/notes", {"tag": heavy[0], "active": "true",
                                                                   "from": month_from.isoformat(), "to": now.isoformat()}),
                ("filter: median user + search", "/notes", {"tag": median_user[0], "q": "созвон"}),
                ("trash: page 1", "/trash", {"page_size": 50}),
                ("calendar: week window", "/occurrences", {"from": now.isoformat(), "to": (now.replace(microsecond=0) + __import__('datetime').timedelta(days=7)).isoformat()}),
                ("calendar: month window", "/occurrences", {"from": month_from.isoformat(),
                                                            "to": (month_from + __import__('datetime').timedelta(days=31)).isoformat()}),
                ("calendar: month, heavy user (tag)", "/occurrences", {"from": month_from.isoformat(), "tag": heavy[0],
                                                                       "to": (month_from + __import__('datetime').timedelta(days=31)).isoformat()}),
                ("calendar: month, median user (tag)", "/occurrences", {"from": month_from.isoformat(), "tag": median_user[0],
                                                                        "to": (month_from + __import__('datetime').timedelta(days=31)).isoformat()}),
                ("upcoming (today/week/overdue)", "/upcoming", {"overdue_limit": 50}),
                ("tags with counts (1020 tags)", "/tags", None),
                ("tags without counts (forms, filters)", "/tags", {"with_counts": "false"}),
                ("note by id", f"/notes/{sample_notes[0]}", None),
            ]
            log("latency:")
            for name, path, params in cases:
                report["latency"].append(measure(client, name, path, params, runs=runs))

        if "scan" not in skip:
            report["scan"] = scan_timing(args.db)
        if "mixed" not in skip:
            paths = [(c[1], c[2] or {}) for c in cases if "50000" not in c[0] and "upcoming" not in c[0] and "month window" not in c[0]]
            log("mixed read load (50 clients, 20 s)...")
            report["mixed_load"] = asyncio.run(mixed_load(paths, clients=50, seconds=20))
            log(f"  {report['mixed_load']}")
        if "edits" not in skip:
            log("concurrent edits (20 notes × 10 clients)...")
            report["concurrent_edits"] = asyncio.run(concurrent_edits(sample_notes, 10))
            log(f"  {report['concurrent_edits']}")
    finally:
        p.terminate()
        p.wait()
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
