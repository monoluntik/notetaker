import time

from sqlalchemy import text

from tests.helpers import make_note, make_tag


def titles(resp):
    assert resp.status_code == 200, resp.text
    return [n["title"] for n in resp.json()["items"]]


def test_search_title_and_body_case_insensitive(client):
    t = make_tag(client)
    make_note(client, [t["id"]], title="Купить молоко", body="")
    make_note(client, [t["id"]], title="Звонок", body="обсудить МОЛОКО и хлеб")
    make_note(client, [t["id"]], title="Другое", body="ничего")
    assert sorted(titles(client.get("/api/notes", params={"q": "молок"}))) == ["Звонок", "Купить молоко"]
    assert titles(client.get("/api/notes", params={"q": "  "})) != []  # пустой поиск = без фильтра


def test_search_escapes_like_wildcards(client):
    t = make_tag(client)
    make_note(client, [t["id"]], title="100% done")
    make_note(client, [t["id"]], title="1000 items")
    assert titles(client.get("/api/notes", params={"q": "100%"})) == ["100% done"]
    assert titles(client.get("/api/notes", params={"q": "_"})) == []


def test_filter_by_tags_any_of(client):
    a, b, c = make_tag(client, "a"), make_tag(client, "b"), make_tag(client, "c")
    make_note(client, [a["id"]], title="A")
    make_note(client, [b["id"], c["id"]], title="BC")
    make_note(client, [c["id"]], title="C")
    r = client.get("/api/notes", params=[("tag", a["id"]), ("tag", b["id"])])
    assert sorted(titles(r)) == ["A", "BC"]
    assert r.json()["total"] == 2  # без дублей из-за join по нескольким тегам


def test_filter_by_activity_and_period(client):
    t = make_tag(client)
    make_note(client, [t["id"]], title="Oct", start_at="2026-10-31T23:59:00Z")
    make_note(client, [t["id"]], title="Nov1", start_at="2026-11-01T00:00:00Z")
    make_note(client, [t["id"]], title="Nov30", start_at="2026-11-30T12:00:00Z", is_active=False)
    make_note(client, [t["id"]], title="Dec", start_at="2026-12-01T00:00:00Z")
    nov = {"from": "2026-11-01T00:00:00Z", "to": "2026-12-01T00:00:00Z"}
    assert titles(client.get("/api/notes", params=nov)) == ["Nov1", "Nov30"]  # [from, to)
    assert titles(client.get("/api/notes", params=nov | {"active": "true"})) == ["Nov1"]
    assert titles(client.get("/api/notes", params={"active": "false"})) == ["Nov30"]
    assert client.get("/api/notes", params={"from": "2026-11-01T00:00:00"}).status_code == 422  # без смещения


def test_sorting(client):
    t = make_tag(client)
    a = make_note(client, [t["id"]], title="A", start_at="2026-11-03T00:00:00Z")
    make_note(client, [t["id"]], title="B", start_at="2026-11-01T00:00:00Z")
    make_note(client, [t["id"]], title="C", start_at="2026-11-02T00:00:00Z")
    assert titles(client.get("/api/notes", params={"sort": "start_at", "order": "asc"})) == ["B", "C", "A"]
    assert titles(client.get("/api/notes", params={"sort": "start_at", "order": "desc"})) == ["A", "C", "B"]
    client.patch(f"/api/notes/{a['id']}", json={"body": "edited"})
    assert titles(client.get("/api/notes", params={"sort": "updated_at", "order": "desc"}))[0] == "A"
    assert client.get("/api/notes", params={"sort": "title"}).status_code == 422


def test_pagination_is_stable_and_complete(client):
    t = make_tag(client)
    for i in range(25):  # одинаковые даты: порядок определяется тай-брейком по id
        make_note(client, [t["id"]], title=f"n{i:02d}", start_at="2026-11-01T00:00:00Z")
    seen = []
    for page in (1, 2, 3):
        r = client.get("/api/notes", params={"page": page, "page_size": 10}).json()
        assert r["total"] == 25 and r["page"] == page
        seen += [n["title"] for n in r["items"]]
    assert seen == [f"n{i:02d}" for i in range(25)]
    assert client.get("/api/notes", params={"page": 0}).status_code == 422
    assert client.get("/api/notes", params={"page_size": 500}).status_code == 422


def test_search_applies_to_whole_database_not_page(client):
    t = make_tag(client)
    for i in range(30):
        make_note(client, [t["id"]], title=f"filler {i}", start_at="2026-11-01T00:00:00Z")
    make_note(client, [t["id"]], title="needle", start_at="2027-01-01T00:00:00Z")  # в конце сортировки
    r = client.get("/api/notes", params={"q": "needle", "page_size": 5}).json()
    assert r["total"] == 1 and r["items"][0]["title"] == "needle"


def test_performance_with_5000_notes(client, engine):
    t = make_tag(client)
    with engine.begin() as conn:
        conn.execute(text("""
            INSERT INTO notes (title, body, start_at, timezone)
            SELECT 'Note ' || g, 'body text number ' || g || CASE WHEN g % 100 = 0 THEN ' special' ELSE '' END,
                   timestamptz '2026-01-01 00:00Z' + (g || ' hours')::interval, 'UTC'
            FROM generate_series(1, 5000) g
        """))
        conn.execute(text("INSERT INTO note_tags SELECT id, :t FROM notes"), {"t": t["id"]})

    timings = {}
    for name, params in {
        "page1": {"page_size": 50},
        "last_page": {"page_size": 50, "page": 100},
        "search": {"q": "special"},
        "tag+period+sort": {"tag": t["id"], "from": "2026-03-01T00:00:00Z", "to": "2026-04-01T00:00:00Z",
                            "sort": "updated_at", "order": "desc"},
    }.items():
        t0 = time.perf_counter()
        r = client.get("/api/notes", params=params)
        timings[name] = time.perf_counter() - t0
        assert r.status_code == 200
    assert client.get("/api/notes", params={"q": "special"}).json()["total"] == 50
    print("timings, s:", {k: round(v, 3) for k, v in timings.items()})
    assert max(timings.values()) < 1.0, timings
