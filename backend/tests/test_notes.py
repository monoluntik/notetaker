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
