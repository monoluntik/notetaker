def make_tag(client, name="work", color="#2563eb") -> dict:
    r = client.post("/api/tags", json={"name": name, "color": color})
    assert r.status_code == 201, r.text
    return r.json()


def make_note(client, tag_ids, **kw) -> dict:
    payload = {
        "title": "Note",
        "body": "",
        "start_at": "2026-11-02T09:00:00Z",
        "tag_ids": tag_ids,
    } | kw
    r = client.post("/api/notes", json=payload)
    assert r.status_code == 201, r.text
    return r.json()
