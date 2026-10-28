"""Изменение серии «с этого вхождения» (D17): прошлое не меняется."""
from datetime import UTC, datetime

from sqlalchemy import text

from app.services import reminders
from tests.helpers import make_note, make_tag

WIN = {"from": "2026-11-01T00:00:00Z", "to": "2026-11-11T00:00:00Z"}


def occs(c):
    return [(o["start_at"][:16], o["title"], o["note_id"]) for o in c.get("/api/occurrences", params=WIN).json()]


def mk(client, **kw):
    t = make_tag(client)
    return make_note(client, [t["id"]], title="Йога", start_at="2026-11-01T07:00:00Z", timezone="UTC",
                     recurrence={"freq": "daily", "until": "2026-11-06"}, **kw)


def test_split_changes_future_and_keeps_past(client):
    s = mk(client)
    client.patch(f"/api/notes/{s['id']}/occurrences/2026-11-02T07:00:00Z", json={"title": "Йога (зал)"})
    r = client.post(f"/api/notes/{s['id']}/occurrences/2026-11-04T07:00:00Z/split",
                    json={"title": "Пилатес", "start_at": "2026-11-04T08:00:00Z"})
    assert r.status_code == 201, r.text
    new = r.json()
    assert new["id"] != s["id"] and new["recurrence"] == {"freq": "daily", "until": "2026-11-06"}
    old = client.get(f"/api/notes/{s['id']}").json()
    assert old["recurrence"]["until"] == "2026-11-03" and old["title"] == "Йога"
    assert occs(client) == [
        ("2026-11-01T07:00", "Йога", s["id"]), ("2026-11-02T07:00", "Йога (зал)", s["id"]),
        ("2026-11-03T07:00", "Йога", s["id"]),
        ("2026-11-04T08:00", "Пилатес", new["id"]), ("2026-11-05T08:00", "Пилатес", new["id"]),
        ("2026-11-06T08:00", "Пилатес", new["id"]),
    ]


def test_split_with_same_rule_moves_future_exceptions(client):
    s = mk(client)
    client.patch(f"/api/notes/{s['id']}/occurrences/2026-11-05T07:00:00Z", json={"title": "Особая"})
    client.delete(f"/api/notes/{s['id']}/occurrences/2026-11-06T07:00:00Z")
    new = client.post(f"/api/notes/{s['id']}/occurrences/2026-11-04T07:00:00Z/split", json={"body": "новое описание"}).json()
    titles = [(d[:10], t) for d, t, _ in occs(client)]
    assert titles == [("2026-11-01", "Йога"), ("2026-11-02", "Йога"), ("2026-11-03", "Йога"),
                      ("2026-11-04", "Йога"), ("2026-11-05", "Особая")]
    assert new["body"] == "новое описание"


def test_split_on_first_occurrence_edits_whole_series(client):
    s = mk(client)
    r = client.post(f"/api/notes/{s['id']}/occurrences/2026-11-01T07:00:00Z/split", json={"title": "Все"})
    assert r.json()["id"] == s["id"] and {t for _, t, _ in occs(client)} == {"Все"}


def test_split_can_end_recurrence_and_validates(client):
    s = mk(client)
    url = f"/api/notes/{s['id']}/occurrences/2026-11-03T07:00:00Z/split"
    assert client.post(f"/api/notes/{s['id']}/occurrences/2026-11-03T07:30:00Z/split", json={}).status_code == 404
    r = client.post(url, json={"recurrence": None, "title": "Последняя"})
    assert r.json()["recurrence"] is None
    assert [t for _, t, _ in occs(client)] == ["Йога", "Йога", "Последняя"]
    single = make_note(client, [make_tag(client, "x")["id"]])
    assert client.post(f"/api/notes/{single['id']}/occurrences/{single['start_at']}/split", json={}).status_code == 409


def test_split_does_not_resend_reminders(client, app, engine):
    client.patch("/api/settings", json={"email": "me@example.com"})
    s = mk(client, reminders=[1440])
    T = lambda h: datetime(2026, 11, 3, h, 0, tzinfo=UTC)  # noqa: E731
    with app.state.sessionmaker() as db:
        reminders.scan(db, T(6))
        reminders.scan(db, T(7))  # «за день» для вхождения 4 ноября отправлено
    new = client.post(f"/api/notes/{s['id']}/occurrences/2026-11-04T07:00:00Z/split", json={"body": "уточнение"}).json()
    with app.state.sessionmaker() as db:
        assert reminders.scan(db, T(8)).created == []  # новая серия не шлёт напоминание повторно
    with engine.connect() as c:
        rows = c.execute(text("SELECT note_id, original_start::date FROM reminder_deliveries ORDER BY 2")).all()
    # 3 ноября — у старой серии (прошлое не тронуто), 4 ноября — одна запись, перешла к новой серии
    assert [(r[0], str(r[1])) for r in rows] == [(s["id"], "2026-11-03"), (new["id"], "2026-11-04")]
