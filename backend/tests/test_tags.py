from tests.helpers import make_note, make_tag


def test_tag_crud(client):
    t = make_tag(client, "Work", "#AABBCC")
    assert t["color"] == "#aabbcc"

    r = client.patch(f"/api/tags/{t['id']}", json={"name": "Job", "color": "#112233"})
    assert r.status_code == 200 and r.json()["name"] == "Job" and r.json()["color"] == "#112233"

    tags = client.get("/api/tags").json()
    assert [(x["name"], x["note_count"]) for x in tags] == [("Job", 0)]

    assert client.delete(f"/api/tags/{t['id']}").status_code == 204
    assert client.get("/api/tags").json() == []


def test_tag_name_unique_case_insensitive(client):
    make_tag(client, "Home")
    r = client.post("/api/tags", json={"name": "  home "})
    assert r.status_code == 409
    other = make_tag(client, "Other")
    assert client.patch(f"/api/tags/{other['id']}", json={"name": "HOME"}).status_code == 409


def test_tag_validation(client):
    assert client.post("/api/tags", json={"name": "x", "color": "red"}).status_code == 422
    assert client.post("/api/tags", json={"name": "   "}).status_code == 422
    assert client.post("/api/tags", json={"name": "x" * 51}).status_code == 422
    assert client.patch("/api/tags/999", json={"name": "a"}).status_code == 404


def test_delete_tag_unlinks_it_from_notes(client):
    """Удаление тега снимает его с заметок, включая единственный тег и заметки в корзине (D8)."""
    a = make_tag(client, "a")
    b = make_tag(client, "b")
    only = make_note(client, [a["id"]], title="Only A")
    both = make_note(client, [a["id"], b["id"]], title="A and B")
    trashed = make_note(client, [a["id"]], title="Trashed")
    client.delete(f"/api/notes/{trashed['id']}")
    assert client.delete(f"/api/tags/{a['id']}").status_code == 204
    assert client.get(f"/api/notes/{only['id']}").json()["tags"] == []
    assert [t["name"] for t in client.get(f"/api/notes/{both['id']}").json()["tags"]] == ["b"]
    assert client.get(f"/api/notes/{trashed['id']}").json()["tags"] == []


def test_note_count_excludes_trash(client):
    a = make_tag(client, "a")
    make_note(client, [a["id"]])
    n2 = make_note(client, [a["id"]])
    client.delete(f"/api/notes/{n2['id']}")
    assert client.get("/api/tags").json()[0]["note_count"] == 1
