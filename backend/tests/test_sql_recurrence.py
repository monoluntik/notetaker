"""Сверка SQL-развёртки серий (миграция 0005) с эталонным Python-генератором services/recurrence.py."""
import random
from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import text

from app.services.recurrence import iter_occurrence_starts

ZONES = ["UTC", "America/New_York", "Europe/Berlin", "Asia/Almaty", "Australia/Sydney", "Europe/Moscow"]
FREQS = ["daily", "weekly", "monthly"]
FAR = datetime(2000, 1, 1, tzinfo=UTC)


def py_count_before(start, tz, freq, until, x):
    return sum(1 for _ in iter_occurrence_starts(start, tz, freq, until, FAR, x))


def random_series(rng: random.Random):
    tz = rng.choice(ZONES)
    freq = rng.choice(FREQS)
    # Специально попадаем на DST-переходы, концы месяцев и неоднозначные часы
    day = rng.choice([date(2026, 3, 8), date(2026, 10, 25), date(2026, 11, 1), date(2028, 1, 31),
                      date(2026, 4, 5), date(2027, 2, 28)]) if rng.random() < 0.5 else date(2026, 1, 1) + timedelta(days=rng.randint(0, 900))
    hour, minute = rng.choice([(1, 30), (2, 30), (0, 0), (23, 45), (rng.randint(0, 23), rng.choice([0, 15, 30]))])
    from zoneinfo import ZoneInfo
    local = datetime(day.year, day.month, day.day, hour, minute, tzinfo=ZoneInfo(tz))
    start = local.astimezone(UTC)
    until = day + timedelta(days=rng.randint(0, 800))
    return start, tz, freq, until


def test_count_before_matches_python(engine):
    rng = random.Random(20261028)
    cases, mismatches = 0, []
    with engine.connect() as c:
        for _ in range(400):
            start, tz, freq, until = random_series(rng)
            xs = [start - timedelta(hours=1), start, start + timedelta(seconds=1)]
            xs += [start + timedelta(hours=rng.randint(0, 24 * 900)) for _ in range(6)]
            for x in xs:
                sql = c.execute(text("SELECT nt_count_before(:s, :tz, :f, :u, :x)"),
                                {"s": start, "tz": tz, "f": freq, "u": until, "x": x}).scalar()
                py = py_count_before(start, tz, freq, until, x)
                cases += 1
                if sql != py:
                    mismatches.append((start.isoformat(), tz, freq, str(until), x.isoformat(), sql, py))
    assert not mismatches, f"{len(mismatches)}/{cases} mismatches, e.g. {mismatches[:3]}"
    assert cases >= 3000


@pytest.mark.parametrize("seed", [1, 2, 3])
def test_kth_occurrence_matches_python(engine, seed):
    rng = random.Random(seed)
    with engine.connect() as c:
        for _ in range(60):
            start, tz, freq, until = random_series(rng)
            py = list(iter_occurrence_starts(start, tz, freq, until, FAR, start + timedelta(days=3000)))[:40]
            sql = c.execute(text("SELECT nt_occurrence(:s, :tz, :f, k) FROM generate_series(0, :n - 1) k ORDER BY k"),
                            {"s": start, "tz": tz, "f": freq, "n": len(py)}).scalars().all()
            assert [d.astimezone(UTC) for d in sql] == py, (start, tz, freq)


def test_window_listing_and_count_match_python_with_exceptions(client, app):
    """Случайные серии с исключениями: SQL-окно = Python-развёртка, быстрый подсчёт = длине списка."""
    from app.models import Note
    from app.services.occurrences import count_occurrences, note_occurrences, occurrences_between

    rng = random.Random(7)
    tag = client.post("/api/tags", json={"name": "parity"}).json()
    for i in range(40):
        start, tz, freq, until = random_series(rng)
        until = min(until, start.date() + timedelta(days=400))
        n = client.post("/api/notes", json={
            "title": f"s{i}", "start_at": start.isoformat(), "timezone": tz, "tag_ids": [tag["id"]],
            "is_active": rng.random() < 0.8, "recurrence": {"freq": freq, "until": until.isoformat()}}).json()
        occs = list(iter_occurrence_starts(start, tz, freq, until, FAR, start + timedelta(days=500)))
        for o in rng.sample(occs, min(len(occs), 4)):
            url = f"/api/notes/{n['id']}/occurrences/{o.isoformat().replace('+00:00', 'Z')}"
            kind = rng.choice(["cancel", "move", "inactive", "title"])
            if kind == "cancel":
                client.delete(url)
            elif kind == "move":
                r = client.patch(url, json={"start_at": (o + timedelta(hours=rng.choice([-5, 3, 20]))).isoformat()})
                assert r.status_code in (200, 409)  # 409 — перенос нарушил бы правила серии
            elif kind == "inactive":
                client.patch(url, json={"is_active": False})
            else:
                client.patch(url, json={"title": "изменено"})
    for i in range(30):  # обычные заметки
        client.post("/api/notes", json={"title": f"n{i}", "start_at": (datetime(2026, 1, 1, tzinfo=UTC) + timedelta(hours=rng.randint(0, 24 * 700))).isoformat(),
                                        "tag_ids": [tag["id"]], "is_active": rng.random() < 0.7})

    with app.state.sessionmaker() as db:
        notes = db.query(Note).filter(Note.deleted_at.is_(None)).all()
        for _ in range(25):
            a = datetime(2026, 1, 1, tzinfo=UTC) + timedelta(hours=rng.randint(0, 24 * 700))
            b = a + timedelta(hours=rng.choice([1, 24, 24 * 7, 24 * 31, 24 * 200]))
            py = sorted(((o.start_at, o.note_id, o.original_start, o.title, o.is_active)
                         for n in notes for o in note_occurrences(n, a, b)))
            sql = [(o.start_at, o.note_id, o.original_start, o.title, o.is_active) for o in occurrences_between(db, a, b)]
            assert sql == py, (a, b)
            assert count_occurrences(db, a, b) == len(py)
            assert count_occurrences(db, a, b, active_only=True) == sum(1 for x in py if x[4])
            assert len(occurrences_between(db, a, b, limit=5, descending=True)) == min(5, len(py))
