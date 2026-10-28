from datetime import UTC, datetime

import pytest

from tests.helpers import make_note, make_tag


@pytest.fixture()
def at(app):
    def set_now(iso: str):
        now = datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(UTC)
        app.state.clock = lambda: now
    return set_now


def sections(client):
    r = client.get("/api/upcoming")
    assert r.status_code == 200, r.text
    d = r.json()
    return {k: [o["title"] for o in d[k]] for k in ("today", "week", "overdue")}


def test_upcoming_sections_in_user_timezone(client, at):
    client.patch("/api/settings", json={"timezone": "Asia/Almaty"})  # UTC+5
    t = make_tag(client)
    # Сейчас: среда 2026-11-04 12:00 по Алматы (07:00Z). Неделя: пн 02.11 – вс 08.11.
    at("2026-11-04T07:00:00Z")
    make_note(client, [t["id"]], title="past-today", start_at="2026-11-04T03:00:00Z")        # 08:00 сегодня
    make_note(client, [t["id"]], title="later-today", start_at="2026-11-04T18:30:00Z")       # 23:30 сегодня
    make_note(client, [t["id"]], title="tomorrow-local", start_at="2026-11-04T19:30:00Z")    # 00:30 чт (в UTC ещё среда!)
    make_note(client, [t["id"]], title="sunday", start_at="2026-11-08T18:00:00Z")            # вс 23:00
    make_note(client, [t["id"]], title="next-monday", start_at="2026-11-08T19:00:00Z")       # пн 00:00 — уже не эта неделя
    make_note(client, [t["id"]], title="old-active", start_at="2026-10-20T10:00:00Z")
    make_note(client, [t["id"]], title="old-inactive", start_at="2026-10-21T10:00:00Z", is_active=False)
    make_note(client, [t["id"]], title="too-old", start_at="2026-09-01T10:00:00Z")           # > 30 дней — всё равно показывается

    assert sections(client) == {
        "today": ["later-today"],
        "week": ["tomorrow-local", "sunday"],
        "overdue": ["past-today", "old-active", "too-old"],  # давность не ограничена
    }


def test_note_moves_to_overdue_when_time_passes(client, at):
    t = make_tag(client)
    make_note(client, [t["id"]], title="meeting", start_at="2026-11-04T10:00:00Z")
    at("2026-11-04T09:59:59Z")
    assert sections(client)["today"] == ["meeting"]
    at("2026-11-04T10:00:01Z")
    assert sections(client) == {"today": [], "week": [], "overdue": ["meeting"]}


def test_upcoming_excludes_trash(client, at):
    t = make_tag(client)
    n = make_note(client, [t["id"]], title="x", start_at="2026-11-04T10:00:00Z")
    at("2026-11-04T09:00:00Z")
    client.delete(f"/api/notes/{n['id']}")
    assert sections(client) == {"today": [], "week": [], "overdue": []}


def test_sunday_has_empty_week_section(client, at):
    t = make_tag(client)
    at("2026-11-08T10:00:00Z")  # воскресенье (UTC)
    make_note(client, [t["id"]], title="sun-evening", start_at="2026-11-08T20:00:00Z")
    make_note(client, [t["id"]], title="monday", start_at="2026-11-09T08:00:00Z")
    assert sections(client) == {"today": ["sun-evening"], "week": [], "overdue": []}


def test_occurrences_window_validation(client):
    assert client.get("/api/occurrences", params={"from": "2026-11-01T00:00:00Z", "to": "2026-10-01T00:00:00Z"}).status_code == 422
    assert client.get("/api/occurrences", params={"from": "2026-01-01T00:00:00Z", "to": "2026-06-01T00:00:00Z"}).status_code == 422
    assert client.get("/api/occurrences", params={"from": "2026-11-01T00:00:00Z", "to": "2026-12-01T00:00:00Z"}).json() == []


def test_overdue_has_no_hidden_cutoff(client, at):
    """Давно прошедшие активные заметки не пропадают; при ограничении ответа есть общее число."""
    t = make_tag(client)
    at("2026-11-04T12:00:00Z")
    make_note(client, [t["id"]], title="year-ago", start_at="2025-11-01T10:00:00Z")
    make_note(client, [t["id"]], title="3-months", start_at="2026-08-01T10:00:00Z")
    make_note(client, [t["id"]], title="inactive-old", start_at="2026-07-01T10:00:00Z", is_active=False)
    s = make_note(client, [t["id"]], title="old-series", start_at="2026-06-01T10:00:00Z", timezone="UTC",
                  recurrence={"freq": "monthly", "until": "2026-08-31"})
    d = client.get("/api/upcoming").json()
    # 1 августа 10:00 — и «3-months», и вхождение серии; при равном времени порядок по note_id (D10)
    assert [o["title"] for o in d["overdue"]] == ["old-series", "3-months", "old-series", "old-series", "year-ago"]
    assert d["overdue_total"] == 5

    d = client.get("/api/upcoming", params={"overdue_limit": 2}).json()
    assert [o["title"] for o in d["overdue"]] == ["old-series", "3-months"] and d["overdue_total"] == 5
    assert client.get("/api/upcoming", params={"overdue_limit": 0}).status_code == 422

    client.patch(f"/api/notes/{s['id']}", json={"is_active": False})  # неактивная серия уходит
    assert client.get("/api/upcoming").json()["overdue_total"] == 2


def test_overdue_performance(client, engine, at):
    import time
    from sqlalchemy import text
    t = make_tag(client)
    at("2026-11-04T12:00:00Z")
    with engine.begin() as conn:
        conn.execute(text("""
            INSERT INTO notes (title, body, start_at, timezone)
            SELECT 'Past ' || g, '', timestamptz '2026-11-04 00:00Z' - (g || ' hours')::interval, 'UTC'
            FROM generate_series(1, 5000) g"""))
        conn.execute(text("INSERT INTO note_tags SELECT id, :t FROM notes"), {"t": t["id"]})
    make_note(client, [t["id"]], title="daily", start_at="2025-01-01T08:00:00Z", timezone="UTC",
              recurrence={"freq": "daily", "until": "2026-12-31"})
    t0 = time.perf_counter()
    d = client.get("/api/upcoming").json()
    elapsed = time.perf_counter() - t0
    print("upcoming with 5000 past notes + 2-year daily series:", round(elapsed, 3), "s")
    assert d["overdue_total"] == 5000 + 673 and len(d["overdue"]) == 50
    assert elapsed < 2.0


def test_calendar_window_is_capped_with_honest_total(client):
    t = make_tag(client)
    make_note(client, [t["id"]], title="daily", start_at="2026-11-01T08:00:00Z", timezone="UTC",
              recurrence={"freq": "daily", "until": "2026-11-30"})
    for i in range(5):
        make_note(client, [t["id"]], title=f"n{i}", start_at=f"2026-11-0{i + 1}T09:00:00Z")
    r = client.get("/api/occurrences", params={"from": "2026-11-01T00:00:00Z", "to": "2026-12-01T00:00:00Z", "limit": 10})
    assert r.status_code == 200 and len(r.json()) == 10
    assert r.headers["X-Truncated"] == "true" and r.headers["X-Total-Count"] == "35"
    r = client.get("/api/occurrences", params={"from": "2026-11-01T00:00:00Z", "to": "2026-12-01T00:00:00Z"})
    assert len(r.json()) == 35 and "X-Truncated" not in r.headers


def test_upcoming_sections_are_capped_with_exact_totals(client, at):
    import app.services.upcoming as up
    t = make_tag(client)
    at("2026-11-04T07:00:00Z")
    for i in range(8):
        make_note(client, [t["id"]], title=f"today{i}", start_at=f"2026-11-04T1{i}:00:00Z")
    old = up.SECTION_LIMIT
    up.SECTION_LIMIT = 3
    try:
        d = client.get("/api/upcoming").json()
    finally:
        up.SECTION_LIMIT = old
    assert [o["title"] for o in d["today"]] == ["today0", "today1", "today2"] and d["today_total"] == 8
    assert d["week_total"] == 0
