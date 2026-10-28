import threading
import time
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.email import MemoryEmailSender
from app.services import reminders
from tests.helpers import make_note, make_tag


def T(s: str) -> datetime:
    return datetime.fromisoformat(s).replace(tzinfo=UTC)


@pytest.fixture()
def tag(client):
    client.patch("/api/settings", json={"email": "me@example.com"})
    return make_tag(client)


def scan(app, now: str):
    with app.state.sessionmaker() as db:
        return reminders.scan(db, T(now))


def deliver(app, now: str, sender=None):
    with app.state.sessionmaker() as db:
        return reminders.deliver_pending(db, sender or app.state.email_sender, T(now))


def rows(engine):
    with engine.connect() as c:
        return [dict(r._mapping) for r in c.execute(text(
            "SELECT note_id, original_start, offset_minutes, fire_at, status, late, attempts "
            "FROM reminder_deliveries ORDER BY fire_at, id"))]


def emails(app):
    return app.state.email_sender.sent


def test_reminders_api_validation(client, tag):
    n = make_note(client, [tag["id"]], reminders=[60, 10, 10, 1440])
    assert n["reminders"] == [10, 60, 1440]
    assert client.patch(f"/api/notes/{n['id']}", json={"reminders": [10]}).json()["reminders"] == [10]
    r = client.post("/api/notes", json={"title": "x", "start_at": "2026-11-02T09:00:00Z", "tag_ids": [tag["id"]],
                                        "reminders": [30]})
    assert r.status_code == 422


def test_each_reminder_is_delivered_exactly_once(client, app, engine, tag):
    make_note(client, [tag["id"]], title="Demo", start_at="2026-11-04T10:00:00Z", reminders=[10, 60, 1440])
    scan(app, "2026-11-03T09:00:00")  # первый запуск — водяной знак
    for now in ["2026-11-03T10:00:00", "2026-11-03T10:00:00", "2026-11-03T10:00:15"]:
        scan(app, now)
        deliver(app, now)
    assert len(emails(app)) == 1 and "Demo" in emails(app)[0].subject

    for now in ["2026-11-04T09:00:00", "2026-11-04T09:00:10", "2026-11-04T09:50:00", "2026-11-04T09:50:00",
                "2026-11-04T09:55:00", "2026-11-04T10:30:00"]:
        scan(app, now)
        deliver(app, now)
    assert [e.to for e in emails(app)] == ["me@example.com"] * 3
    assert [(r["offset_minutes"], r["status"], r["late"]) for r in rows(engine)] == [
        (1440, "sent", False), (60, "sent", False), (10, "sent", False)]
    # Повторная обработка того же события ничего не создаёт
    assert scan(app, "2026-11-04T09:50:00").created == []
    assert deliver(app, "2026-11-04T09:50:00") == 0


def test_concurrent_scanners_do_not_duplicate(client, app, engine, tag):
    make_note(client, [tag["id"]], start_at="2026-11-04T10:00:00Z", reminders=[10, 60])
    scan(app, "2026-11-04T08:00:00")
    barrier = threading.Barrier(8)
    created = []

    def worker():
        barrier.wait()
        created.extend(scan(app, "2026-11-04T09:55:00").created)

    threads = [threading.Thread(target=worker) for _ in range(8)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert len(created) == 2 and len(rows(engine)) == 2


def test_unique_event_key_protects_even_with_stale_watermark(client, app, engine, tag):
    """Второй процесс с устаревшим водяным знаком (или откат состояния) не создаёт дублей."""
    make_note(client, [tag["id"]], start_at="2026-11-04T10:00:00Z", reminders=[10])
    scan(app, "2026-11-04T09:00:00")
    assert len(scan(app, "2026-11-04T09:51:00").created) == 1
    with engine.begin() as c:
        c.execute(text("UPDATE scheduler_state SET last_scan_at = '2026-11-04T09:00:00Z'"))
    assert scan(app, "2026-11-04T09:52:00").created == []
    assert len(rows(engine)) == 1


def test_concurrent_senders_send_each_email_once(client, app, engine, tag):
    for i in range(5):
        make_note(client, [tag["id"]], title=f"n{i}", start_at="2026-11-04T10:00:00Z", reminders=[10])
    scan(app, "2026-11-04T09:00:00")
    scan(app, "2026-11-04T09:50:00")

    class SlowSender(MemoryEmailSender):
        def send(self, email):
            time.sleep(0.05)
            super().send(email)

    sender = SlowSender()
    barrier = threading.Barrier(4)

    def worker():
        barrier.wait()
        deliver(app, "2026-11-04T09:50:01", sender)

    threads = [threading.Thread(target=worker) for _ in range(4)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert sorted(e.subject for e in sender.sent) == sorted({e.subject for e in sender.sent})
    assert len(sender.sent) == 5
    assert all(r["status"] == "sent" for r in rows(engine))


def test_restart_restores_schedule_without_duplicates(client, app, settings, engine, tag):
    from app.main import create_app

    make_note(client, [tag["id"]], start_at="2026-11-04T10:00:00Z", reminders=[10, 60])
    scan(app, "2026-11-04T08:00:00")
    scan(app, "2026-11-04T09:00:30")
    deliver(app, "2026-11-04T09:00:30")
    assert len(emails(app)) == 1

    # «Перезапуск»: новый экземпляр приложения на той же БД, планировщик тикает при старте
    app2 = create_app(settings)
    app2.state.clock = lambda: T("2026-11-04T09:50:10")
    with TestClient(app2) as c2:
        c2.portal.call(app2.state.scheduler.tick)
        c2.portal.call(app2.state.scheduler.tick)
    assert len(app2.state.email_sender.sent) == 1  # только 10-минутное; часовое не повторилось
    assert [r["status"] for r in rows(engine)] == ["sent", "sent"]


def test_missed_reminders_policy(client, app, engine, tag):
    make_note(client, [tag["id"]], title="started", start_at="2026-11-04T10:00:00Z", reminders=[10])
    make_note(client, [tag["id"]], title="not-started", start_at="2026-11-04T10:20:00Z", reminders=[10])
    scan(app, "2026-11-04T09:45:00")  # последний скан перед простоем
    # сервер лежал с 09:45 до 10:15
    res = scan(app, "2026-11-04T10:15:00")
    deliver(app, "2026-11-04T10:15:00")
    assert res.missed == 1
    assert [n.title for n in res.created] == ["not-started"]
    by = {r["fire_at"].hour * 60 + r["fire_at"].minute: r for r in rows(engine)}
    assert by[9 * 60 + 50]["status"] == "missed"
    assert (by[10 * 60 + 10]["status"], by[10 * 60 + 10]["late"]) == ("sent", True)
    assert [e.subject.startswith("[с опозданием]") for e in emails(app)] == [True]


def test_first_start_does_not_backfill_history(client, app, engine, tag):
    make_note(client, [tag["id"]], start_at="2026-11-04T10:00:00Z", reminders=[10])
    scan(app, "2026-11-04T12:00:00")  # первый запуск уже после события
    assert rows(engine) == []


def test_inactive_deleted_and_cancelled_get_no_reminders(client, app, engine, tag):
    make_note(client, [tag["id"]], title="inactive", start_at="2026-11-04T10:00:00Z", reminders=[10], is_active=False)
    d = make_note(client, [tag["id"]], title="deleted", start_at="2026-11-04T10:00:00Z", reminders=[10])
    client.delete(f"/api/notes/{d['id']}")
    s = make_note(client, [tag["id"]], title="series", start_at="2026-11-03T10:00:00Z", reminders=[10],
                  recurrence={"freq": "daily", "until": "2026-11-06"}, timezone="UTC")
    client.delete(f"/api/notes/{s['id']}/occurrences/2026-11-04T10:00:00Z")
    client.patch(f"/api/notes/{s['id']}/occurrences/2026-11-05T10:00:00Z", json={"is_active": False})
    scan(app, "2026-11-04T09:00:00")
    for now in ["2026-11-04T09:55:00", "2026-11-05T09:55:00", "2026-11-06T09:55:00"]:
        scan(app, now)
    assert [(r["note_id"], r["original_start"].day) for r in rows(engine)] == [(s["id"], 6)]


def test_series_reminders_follow_moved_occurrence(client, app, engine, tag):
    s = make_note(client, [tag["id"]], start_at="2026-11-03T10:00:00Z", reminders=[10], timezone="UTC",
                  recurrence={"freq": "daily", "until": "2026-11-05"})
    client.patch(f"/api/notes/{s['id']}/occurrences/2026-11-04T10:00:00Z", json={"start_at": "2026-11-04T15:00:00Z"})
    scan(app, "2026-11-03T00:00:00")
    for now in ["2026-11-03T09:50:00", "2026-11-04T09:50:00", "2026-11-04T14:50:00", "2026-11-05T09:50:00"]:
        scan(app, now)
    assert [r["fire_at"].strftime("%d %H:%M") for r in rows(engine)] == ["03 09:50", "04 14:50", "05 09:50"]


def test_rescheduling_after_send_creates_new_event_once(client, app, engine, tag):
    n = make_note(client, [tag["id"]], start_at="2026-11-04T10:00:00Z", reminders=[10])
    scan(app, "2026-11-04T09:00:00")
    scan(app, "2026-11-04T09:50:00")
    client.patch(f"/api/notes/{n['id']}", json={"start_at": "2026-11-04T11:00:00Z"})
    scan(app, "2026-11-04T09:51:00")
    scan(app, "2026-11-04T10:50:00")
    scan(app, "2026-11-04T10:51:00")
    assert [r["fire_at"].strftime("%H:%M") for r in rows(engine)] == ["09:50", "10:50"]


def test_timezone_change_does_not_move_reminder(client, app, engine, tag):
    client.patch("/api/settings", json={"timezone": "Asia/Almaty"})
    make_note(client, [tag["id"]], start_at="2026-11-04T04:00:00Z", reminders=[60])  # 09:00 по Алматы
    scan(app, "2026-11-04T00:00:00")
    client.patch("/api/settings", json={"timezone": "America/New_York"})
    assert scan(app, "2026-11-04T02:59:59").created == []
    created = scan(app, "2026-11-04T03:00:00").created
    assert [c.fire_at for c in created] == [T("2026-11-04T03:00:00")]
    deliver(app, "2026-11-04T03:00:00")
    # В письме время показано в текущем поясе пользователя (Нью-Йорк, UTC-5): 23:00 3 ноября
    assert "03.11.2026 23:00" in emails(app)[0].subject


def test_no_email_configured_gives_in_app_only(client, app, engine):
    t = make_tag(client)
    make_note(client, [t["id"]], start_at="2026-11-04T10:00:00Z", reminders=[10])
    scan(app, "2026-11-04T09:00:00")
    assert len(scan(app, "2026-11-04T09:50:00").created) == 1
    client.patch("/api/settings", json={"email": "late@example.com"})
    scan(app, "2026-11-04T09:51:00")
    deliver(app, "2026-11-04T09:51:00")
    assert emails(app) == [] and rows(engine)[0]["status"] == "no_email"


def test_email_failures_are_retried_then_sent_once(client, app, engine, tag):
    make_note(client, [tag["id"]], start_at="2026-11-04T10:00:00Z", reminders=[10])
    app.state.email_sender.fail_times = 2
    scan(app, "2026-11-04T09:00:00")
    scan(app, "2026-11-04T09:50:00")
    assert [deliver(app, "2026-11-04T09:50:00") for _ in range(4)] == [0, 0, 1, 0]
    assert len(emails(app)) == 1 and rows(engine)[0]["attempts"] == 3


def test_email_gives_up_after_max_attempts(client, app, engine, tag):
    make_note(client, [tag["id"]], start_at="2026-11-04T10:00:00Z", reminders=[10])
    app.state.email_sender.fail_times = 100
    scan(app, "2026-11-04T09:00:00")
    scan(app, "2026-11-04T09:50:00")
    for _ in range(7):
        deliver(app, "2026-11-04T09:50:00")
    assert (rows(engine)[0]["status"], rows(engine)[0]["attempts"]) == ("failed", reminders.MAX_ATTEMPTS)


def test_two_tabs_receive_same_notification_and_read_state_syncs(client, app, tag):
    make_note(client, [tag["id"]], title="Meeting", start_at="2026-11-04T10:00:00Z", reminders=[10])
    app.state.clock = lambda: T("2026-11-04T09:00:00")
    client.portal.call(app.state.scheduler.tick)
    app.state.clock = lambda: T("2026-11-04T09:50:00")
    with client.websocket_connect("/ws") as tab1, client.websocket_connect("/ws") as tab2:
        assert tab1.receive_json() == {"type": "hello"} and tab2.receive_json() == {"type": "hello"}
        client.portal.call(app.state.scheduler.tick)
        client.portal.call(app.state.scheduler.tick)  # повторный тик ничего не шлёт
        m1, m2 = tab1.receive_json(), tab2.receive_json()
        assert m1["type"] == "reminder" and m1 == m2
        nid = m1["notification"]["id"]
        assert m1["notification"]["title"] == "Meeting"

        # Вкладка, открытая позже, получает непрочитанное через API
        assert [n["id"] for n in client.get("/api/notifications").json()] == [nid]

        assert client.post("/api/notifications/read", json={"ids": [nid]}).json() == {"read": [nid]}
        assert tab1.receive_json() == {"type": "notifications_read", "ids": [nid]}
        assert tab2.receive_json() == {"type": "notifications_read", "ids": [nid]}
        assert client.get("/api/notifications").json() == []

        # Изменение данных рассылается во все вкладки
        client.post("/api/tags", json={"name": "new"})
        assert tab1.receive_json()["type"] == "changed" and tab2.receive_json()["type"] == "changed"
    assert len(emails(app)) == 1


def test_reminder_already_due_at_creation_is_sent_immediately_not_late(client, app, engine, tag):
    """Заметка через 5 минут с напоминанием «за 10 минут»: событие ещё не началось → напоминание сразу."""
    from datetime import timedelta
    from app.timeutil import utcnow
    start = (utcnow() + timedelta(minutes=5)).replace(microsecond=0)
    make_note(client, [tag["id"]], start_at=start.isoformat(), reminders=[10])
    now = utcnow().replace(tzinfo=None).isoformat()
    scan(app, now)
    deliver(app, now)
    assert [(r["status"], r["late"]) for r in rows(engine)] == [("sent", False)]
    assert not emails(app)[0].subject.startswith("[с опозданием]")
