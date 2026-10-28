from tests.helpers import make_note, make_tag


def test_create_and_get_note_has_all_fields(client):
    t1, t2 = make_tag(client, "a"), make_tag(client, "b")
    n = make_note(client, [t1["id"], t2["id"]], title="  Plan  ", body="text",
                  start_at="2026-11-02T15:00:00+06:00", timezone="Asia/Almaty")
    assert n["title"] == "Plan"
    assert n["body"] == "text"
    assert n["start_at"].startswith("2026-11-02T09:00:00")  # хранится и отдаётся в UTC
    assert n["timezone"] == "Asia/Almaty"
    assert n["is_active"] is True
    assert n["deleted_at"] is None
    assert n["created_at"] and n["updated_at"]
    assert {t["name"] for t in n["tags"]} == {"a", "b"}

    got = client.get(f"/api/notes/{n['id']}").json()
    assert got == n


def test_note_timezone_defaults_to_user_setting(client):
    client.patch("/api/settings", json={"timezone": "Europe/Moscow"})
    t = make_tag(client)
    assert make_note(client, [t["id"]])["timezone"] == "Europe/Moscow"


def test_note_validation(client):
    t = make_tag(client)
    base = {"title": "x", "start_at": "2026-11-02T09:00:00Z", "tag_ids": [t["id"]]}
    assert client.post("/api/notes", json=base | {"title": " "}).status_code == 422
    assert client.post("/api/notes", json=base | {"tag_ids": []}).status_code == 422
    assert client.post("/api/notes", json=base | {"tag_ids": [999]}).status_code == 422
    assert client.post("/api/notes", json=base | {"start_at": "2026-11-02T09:00:00"}).status_code == 422
    assert client.post("/api/notes", json=base | {"timezone": "Mars/Base"}).status_code == 422
    assert client.post("/api/notes", json={k: v for k, v in base.items() if k != "title"}).status_code == 422
    assert client.get("/api/notes/999").status_code == 404


def test_update_note_and_toggle_active(client):
    a, b = make_tag(client, "a"), make_tag(client, "b")
    n = make_note(client, [a["id"]])
    r = client.patch(f"/api/notes/{n['id']}", json={"title": "New", "tag_ids": [b["id"]], "is_active": False})
    assert r.status_code == 200
    u = r.json()
    assert u["title"] == "New" and u["is_active"] is False and [t["name"] for t in u["tags"]] == ["b"]
    assert u["updated_at"] > n["updated_at"]
    assert u["body"] == n["body"] and u["start_at"] == n["start_at"]  # не переданные поля не меняются

    assert client.patch(f"/api/notes/{n['id']}", json={"is_active": True}).json()["is_active"] is True
    assert client.patch(f"/api/notes/{n['id']}", json={"tag_ids": []}).status_code == 422


def test_trash_restore_purge(client):
    t = make_tag(client)
    n = make_note(client, [t["id"]], title="Trash me")
    keep = make_note(client, [t["id"]], title="Keep")

    r = client.delete(f"/api/notes/{n['id']}")
    assert r.status_code == 200 and r.json()["deleted_at"] is not None

    listed = client.get("/api/notes").json()
    assert [x["title"] for x in listed["items"]] == ["Keep"] and listed["total"] == 1
    trash = client.get("/api/trash").json()
    assert [x["title"] for x in trash["items"]] == ["Trash me"]

    # Редактировать заметку в корзине нельзя; окончательно удалить активную — нельзя
    assert client.patch(f"/api/notes/{n['id']}", json={"title": "x"}).status_code == 409
    assert client.delete(f"/api/notes/{keep['id']}/purge").status_code == 409

    r = client.post(f"/api/notes/{n['id']}/restore")
    assert r.status_code == 200 and r.json()["deleted_at"] is None
    assert client.get("/api/notes").json()["total"] == 2

    client.delete(f"/api/notes/{n['id']}")
    assert client.delete(f"/api/notes/{n['id']}/purge").status_code == 204
    assert client.get(f"/api/notes/{n['id']}").status_code == 404


def test_empty_trash(client):
    t = make_tag(client)
    for i in range(3):
        n = make_note(client, [t["id"]], title=f"n{i}")
        if i < 2:
            client.delete(f"/api/notes/{n['id']}")
    assert client.delete("/api/trash").json() == {"deleted": 2}
    assert client.get("/api/trash").json()["total"] == 0
    assert client.get("/api/notes").json()["total"] == 1


def test_trash_autopurge_after_retention_period(client, app, engine):
    from datetime import UTC, datetime
    from sqlalchemy import text
    t = make_tag(client)
    old = make_note(client, [t["id"]], title="old", reminders=[10])
    fresh = make_note(client, [t["id"]], title="fresh")
    active = make_note(client, [t["id"]], title="active")
    client.delete(f"/api/notes/{old['id']}")
    client.delete(f"/api/notes/{fresh['id']}")
    with engine.begin() as c:
        c.execute(text("UPDATE notes SET deleted_at = '2026-10-01T00:00:00Z' WHERE id = :i"), {"i": old["id"]})
        c.execute(text("UPDATE notes SET deleted_at = '2026-10-10T00:00:00Z' WHERE id = :i"), {"i": fresh["id"]})
        # «активная» заметка с очень старой датой не затрагивается
        c.execute(text("UPDATE notes SET start_at = '2020-01-01T00:00:00Z' WHERE id = :i"), {"i": active["id"]})
    app.state.clock = lambda: datetime(2026, 10, 31, 0, 0, 1, tzinfo=UTC)  # old пролежала 30 дней + 1 с
    with client.websocket_connect("/ws") as ws:
        ws.receive_json()
        client.portal.call(app.state.scheduler.tick)
        assert ws.receive_json() == {"type": "changed", "path": "/api/trash"}
    assert client.get(f"/api/notes/{old['id']}").status_code == 404
    assert [n["title"] for n in client.get("/api/trash").json()["items"]] == ["fresh"]
    assert client.get(f"/api/notes/{active['id']}").status_code == 200
    with engine.connect() as c:
        assert c.execute(text("SELECT count(*) FROM note_reminders WHERE note_id = :i"), {"i": old["id"]}).scalar() == 0


def test_trash_autopurge_respects_configured_retention(engine, settings):
    from datetime import UTC, datetime, timedelta
    from fastapi.testclient import TestClient
    from app.main import create_app
    app = create_app(settings.model_copy(update={"trash_retention_days": 7}))
    now = datetime(2026, 10, 31, tzinfo=UTC)
    app.state.clock = lambda: now
    with TestClient(app) as c:
        t = make_tag(c)
        n = make_note(c, [t["id"]])
        c.delete(f"/api/notes/{n['id']}")
        with engine.begin() as conn:
            from sqlalchemy import text
            conn.execute(text("UPDATE notes SET deleted_at = :d"), {"d": now - timedelta(days=6)})
        c.portal.call(app.state.scheduler.tick)
        assert c.get("/api/trash").json()["total"] == 1
        app.state.clock = lambda: now + timedelta(days=1, seconds=1)
        c.portal.call(app.state.scheduler.tick)
        assert c.get("/api/trash").json()["total"] == 0
        assert c.get("/api/settings").json()["trash_retention_days"] == 7


def test_concurrent_edit_with_stale_version_is_rejected(client):
    t = make_tag(client)
    n = make_note(client, [t["id"]], title="v1")
    assert n["version"] == 1
    a = client.patch(f"/api/notes/{n['id']}", json={"title": "из вкладки A", "version": 1})
    assert a.status_code == 200 and a.json()["version"] == 2
    b = client.patch(f"/api/notes/{n['id']}", json={"title": "из вкладки B", "version": 1})
    assert b.status_code == 409 and "другой вкладке" in b.json()["detail"]
    assert client.get(f"/api/notes/{n['id']}").json()["title"] == "из вкладки A"  # правка A не потеряна
    assert client.patch(f"/api/notes/{n['id']}", json={"title": "B после обновления", "version": 2}).status_code == 200
    # Без версии (перетаскивание в календаре, старые клиенты) — правка проходит
    assert client.patch(f"/api/notes/{n['id']}", json={"is_active": False}).json()["version"] == 4


def test_simultaneous_edits_exactly_one_wins(app, client):
    import threading
    from fastapi.testclient import TestClient
    t = make_tag(client)
    n = make_note(client, [t["id"]])
    barrier = threading.Barrier(6)
    codes = []

    def worker(i):
        with TestClient(app) as c:
            barrier.wait()
            codes.append(c.patch(f"/api/notes/{n['id']}", json={"title": f"tab {i}", "version": 1}).status_code)

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(6)]
    [th.start() for th in threads]
    [th.join() for th in threads]
    assert sorted(codes) == [200, 409, 409, 409, 409, 409]
    assert client.get(f"/api/notes/{n['id']}").json()["version"] == 2


def test_version_changes_on_trash_restore_and_occurrence_edits(client):
    t = make_tag(client)
    s = make_note(client, [t["id"]], start_at="2026-11-01T09:00:00Z", timezone="UTC",
                  recurrence={"freq": "daily", "until": "2026-11-05"})
    url = f"/api/notes/{s['id']}/occurrences/2026-11-02T09:00:00Z"
    assert client.patch(url, json={"title": "A", "version": 1}).status_code == 200
    r = client.patch(url, json={"title": "B", "version": 1})  # вторая вкладка открыла вхождение раньше
    assert r.status_code == 409
    assert client.patch(f"/api/notes/{s['id']}", json={"title": "x", "version": 1}).status_code == 409
    v = client.get(f"/api/notes/{s['id']}").json()["version"]
    client.delete(f"/api/notes/{s['id']}")
    client.post(f"/api/notes/{s['id']}/restore")
    assert client.get(f"/api/notes/{s['id']}").json()["version"] == v + 2
