import pytest

from tests.helpers import make_note, make_tag

NOV = {"from": "2026-11-01T00:00:00Z", "to": "2026-12-01T00:00:00Z"}


@pytest.fixture()
def tag(client):
    return make_tag(client)


def series(client, tag, freq="daily", until="2026-11-05", **kw):
    return make_note(client, [tag["id"]], title="Standup", start_at="2026-11-01T09:00:00Z",
                     timezone="UTC", recurrence={"freq": freq, "until": until}, **kw)


def occs(client, params=NOV):
    r = client.get("/api/occurrences", params=params)
    assert r.status_code == 200, r.text
    return r.json()


def starts(client, params=NOV):
    return [o["start_at"][:16] for o in occs(client, params)]


def test_series_is_expanded_and_returned(client, tag):
    n = series(client, tag)
    assert n["recurrence"] == {"freq": "daily", "until": "2026-11-05"}
    assert starts(client) == [f"2026-11-0{d}T09:00" for d in range(1, 6)]
    assert all(o["is_recurring"] and not o["is_exception"] for o in occs(client))


def test_recurrence_validation(client, tag):
    base = {"title": "x", "start_at": "2026-11-05T09:00:00Z", "tag_ids": [tag["id"]], "timezone": "UTC"}
    assert client.post("/api/notes", json=base | {"recurrence": {"freq": "daily"}}).status_code == 422
    assert client.post("/api/notes", json=base | {"recurrence": {"freq": "yearly", "until": "2027-01-01"}}).status_code == 422
    r = client.post("/api/notes", json=base | {"recurrence": {"freq": "daily", "until": "2026-11-04"}})
    assert r.status_code == 422 and "раньше" in r.json()["detail"]
    assert client.post("/api/notes", json=base | {"recurrence": {"freq": "daily", "until": "2033-01-01"}}).status_code == 422


def test_edit_single_occurrence_only(client, tag):
    n = series(client, tag)
    r = client.patch(f"/api/notes/{n['id']}/occurrences/2026-11-03T09:00:00Z",
                     json={"title": "Retro", "body": "special", "is_active": False})
    assert r.status_code == 200, r.text
    o = r.json()
    assert (o["title"], o["body"], o["is_active"], o["is_exception"]) == ("Retro", "special", False, True)

    by_day = {x["original_start"][:10]: x for x in occs(client)}
    assert by_day["2026-11-03"]["title"] == "Retro"
    assert [by_day[d]["title"] for d in ("2026-11-01", "2026-11-02", "2026-11-04", "2026-11-05")] == ["Standup"] * 4
    assert client.get(f"/api/notes/{n['id']}").json()["title"] == "Standup"  # серия не изменилась

    # Последующее изменение серии (не правила) не затирает исключение
    client.patch(f"/api/notes/{n['id']}", json={"title": "Daily"})
    by_day = {x["original_start"][:10]: x["title"] for x in occs(client)}
    assert by_day == {"2026-11-01": "Daily", "2026-11-02": "Daily", "2026-11-03": "Retro",
                      "2026-11-04": "Daily", "2026-11-05": "Daily"}


def test_delete_single_occurrence_and_restore_it(client, tag):
    n = series(client, tag)
    url = f"/api/notes/{n['id']}/occurrences/2026-11-02T09:00:00Z"
    assert client.delete(url).status_code == 204
    assert "2026-11-02T09:00" not in starts(client) and len(starts(client)) == 4
    assert client.get(url).status_code == 404
    assert client.patch(url, json={"title": "x"}).status_code == 404

    assert client.delete(url + "/override").status_code == 200
    assert len(starts(client)) == 5


def test_invalid_occurrence_ids(client, tag):
    n = series(client, tag)
    assert client.patch(f"/api/notes/{n['id']}/occurrences/2026-11-02T09:30:00Z", json={"title": "x"}).status_code == 404
    assert client.patch(f"/api/notes/{n['id']}/occurrences/2026-11-06T09:00:00Z", json={"title": "x"}).status_code == 404
    single = make_note(client, [tag["id"]])
    assert client.patch(f"/api/notes/{single['id']}/occurrences/{single['start_at']}", json={"title": "x"}).status_code == 409


def test_move_single_occurrence(client, tag):
    n = series(client, tag, until="2026-11-10")
    url = f"/api/notes/{n['id']}/occurrences/2026-11-03T09:00:00Z"
    # Перенос времени внутри того же дня
    assert client.patch(url, json={"start_at": "2026-11-03T15:00:00Z"}).status_code == 200
    # Нельзя на день, где уже есть вхождение серии
    r = client.patch(url, json={"start_at": "2026-11-04T15:00:00Z"})
    assert r.status_code == 409 and "уже есть" in r.json()["detail"]
    # Нельзя за пределы серии
    assert client.patch(url, json={"start_at": "2026-11-11T09:00:00Z"}).status_code == 409
    assert client.patch(url, json={"start_at": "2026-10-31T09:00:00Z"}).status_code == 409
    # Можно на день, освобождённый удалением вхождения
    client.delete(f"/api/notes/{n['id']}/occurrences/2026-11-05T09:00:00Z")
    assert client.patch(url, json={"start_at": "2026-11-05T12:00:00Z"}).status_code == 200
    s = starts(client)
    assert "2026-11-05T12:00" in s and "2026-11-03T09:00" not in s and len(s) == 9


def test_moved_occurrence_appears_in_other_window(client, tag):
    n = series(client, tag, until="2026-11-30")
    client.patch(f"/api/notes/{n['id']}/occurrences/2026-11-01T09:00:00Z", json={"start_at": "2026-11-01T23:00:00Z"})
    # окно, где исходного вхождения нет, но перенесённое есть
    window = {"from": "2026-11-01T20:00:00Z", "to": "2026-11-02T00:00:00Z"}
    o = occs(client, window)
    assert [(x["original_start"][:16], x["start_at"][:16]) for x in o] == [("2026-11-01T09:00", "2026-11-01T23:00")]
    # и исчезло из окна исходного момента
    assert occs(client, {"from": "2026-11-01T08:00:00Z", "to": "2026-11-01T10:00:00Z"}) == []


def test_series_rule_change_resets_exceptions_but_until_change_keeps_them(client, tag):
    n = series(client, tag, until="2026-11-10")
    client.patch(f"/api/notes/{n['id']}/occurrences/2026-11-03T09:00:00Z", json={"title": "Special"})
    client.delete(f"/api/notes/{n['id']}/occurrences/2026-11-04T09:00:00Z")

    client.patch(f"/api/notes/{n['id']}", json={"recurrence": {"freq": "daily", "until": "2026-11-05"}})
    titles = [o["title"] for o in occs(client)]
    assert titles == ["Standup", "Standup", "Special", "Standup"]  # 4-е удалено, until укоротился

    client.patch(f"/api/notes/{n['id']}", json={"start_at": "2026-11-01T10:00:00Z"})
    o = occs(client)
    assert [x["title"] for x in o] == ["Standup"] * 5 and not any(x["is_exception"] for x in o)
    assert o[0]["start_at"].startswith("2026-11-01T10:00")


def test_convert_series_to_single_and_back(client, tag):
    n = series(client, tag)
    r = client.patch(f"/api/notes/{n['id']}", json={"recurrence": None})
    assert r.json()["recurrence"] is None
    assert starts(client) == ["2026-11-01T09:00"]
    client.patch(f"/api/notes/{n['id']}", json={"recurrence": {"freq": "weekly", "until": "2026-11-15"}})
    assert starts(client) == ["2026-11-01T09:00", "2026-11-08T09:00", "2026-11-15T09:00"]


def test_trash_and_restore_whole_series_keeps_exceptions(client, tag):
    n = series(client, tag)
    client.patch(f"/api/notes/{n['id']}/occurrences/2026-11-02T09:00:00Z", json={"title": "Moved"})
    client.delete(f"/api/notes/{n['id']}/occurrences/2026-11-03T09:00:00Z")
    client.delete(f"/api/notes/{n['id']}")
    assert occs(client) == []
    assert client.patch(f"/api/notes/{n['id']}/occurrences/2026-11-04T09:00:00Z", json={"title": "x"}).status_code == 409
    client.post(f"/api/notes/{n['id']}/restore")
    assert [o["title"] for o in occs(client)] == ["Standup", "Moved", "Standup", "Standup"]


def test_inactive_series_makes_all_occurrences_inactive(client, tag):
    n = series(client, tag, is_active=False)
    client.patch(f"/api/notes/{n['id']}/occurrences/2026-11-02T09:00:00Z", json={"is_active": True})
    assert not any(o["is_active"] for o in occs(client))
    assert occs(client, NOV | {"active": "true"}) == []


def test_monthly_series_and_until_inclusive_through_api(client, tag):
    make_note(client, [tag["id"]], title="Rent", start_at="2027-01-31T06:00:00Z", timezone="UTC",
              recurrence={"freq": "monthly", "until": "2027-03-31"})
    r = occs(client, {"from": "2027-01-01T00:00:00Z", "to": "2027-03-01T00:00:00Z"})
    assert [o["start_at"][:10] for o in r] == ["2027-01-31", "2027-02-28"]
    r = occs(client, {"from": "2027-03-01T00:00:00Z", "to": "2027-04-30T00:00:00Z"})
    assert [o["start_at"][:10] for o in r] == ["2027-03-31"]


def test_list_period_filter_matches_series_overlap(client, tag):
    series(client, tag, until="2026-11-05")  # 1–5 ноября
    make_note(client, [tag["id"]], title="Single", start_at="2026-11-20T09:00:00Z")
    r = client.get("/api/notes", params={"from": "2026-11-04T00:00:00Z", "to": "2026-11-30T00:00:00Z"}).json()
    assert sorted(n["title"] for n in r["items"]) == ["Single", "Standup"]
    r = client.get("/api/notes", params={"from": "2026-11-06T00:00:00Z", "to": "2026-11-30T00:00:00Z"}).json()
    assert [n["title"] for n in r["items"]] == ["Single"]


def test_upcoming_expands_series(client, tag, app):
    from datetime import UTC, datetime
    app.state.clock = lambda: datetime(2026, 11, 3, 12, 0, tzinfo=UTC)  # вторник
    series(client, tag, until="2026-11-10")
    d = client.get("/api/upcoming").json()
    assert [o["start_at"][:10] for o in d["today"]] == []  # сегодняшнее в 09:00 уже прошло
    assert [o["start_at"][:10] for o in d["week"]] == ["2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"]
    assert [o["start_at"][:10] for o in d["overdue"]] == ["2026-11-03", "2026-11-02", "2026-11-01"]
