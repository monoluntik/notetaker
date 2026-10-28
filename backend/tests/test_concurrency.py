"""Оптимистическая блокировка (D14): два клиента загрузили одну версию, A сохранил, B — нет.

Используется raw_client — версия ничем не подставляется, как у настоящего браузера.
"""
import threading

import pytest
from fastapi.testclient import TestClient

from tests.helpers import make_note, make_tag

OCC = "2026-11-02T09:00:00Z"


@pytest.fixture()
def series(raw_client):
    t = make_tag(raw_client, "series-tag")
    return make_note(raw_client, [t["id"]], title="Серия", start_at="2026-11-01T09:00:00Z", timezone="UTC",
                     recurrence={"freq": "daily", "until": "2026-11-10"})


@pytest.fixture()
def single(raw_client):
    t = make_tag(raw_client)
    return make_note(raw_client, [t["id"]], title="Исходная", start_at="2026-11-01T09:00:00Z")


def get(c, nid):
    return c.get(f"/api/notes/{nid}").json()


def test_version_is_required_for_every_mutation(raw_client, single, series):
    n, s = single["id"], series["id"]
    for method, url, kw in [
        ("PATCH", f"/api/notes/{n}", {"json": {"title": "x"}}),
        ("DELETE", f"/api/notes/{n}", {}),
        ("POST", f"/api/notes/{n}/restore", {}),
        ("DELETE", f"/api/notes/{n}/purge", {}),
        ("PATCH", f"/api/notes/{s}/occurrences/{OCC}", {"json": {"title": "x"}}),
        ("DELETE", f"/api/notes/{s}/occurrences/{OCC}", {}),
        ("DELETE", f"/api/notes/{s}/occurrences/{OCC}/override", {}),
        ("POST", f"/api/notes/{s}/occurrences/{OCC}/split", {"json": {"title": "x"}}),
    ]:
        r = raw_client.request(method, url, **kw)
        assert r.status_code == 422, (method, url, r.text)
    assert get(raw_client, n)["title"] == "Исходная" and get(raw_client, n)["version"] == 1


def stale_case(raw_client, nid, a, b):
    """a и b — операции клиентов, оба знают версию v0. Возвращает ответ b."""
    v0 = get(raw_client, nid)["version"]
    ra = a(v0)
    assert ra.status_code < 400, ra.text
    rb = b(v0)
    assert rb.status_code == 409, rb.text
    assert "другой вкладке" in rb.json()["detail"]
    return ra


def test_two_clients_edit_same_note(raw_client, single):
    n = single["id"]
    stale_case(raw_client, n,
               lambda v: raw_client.patch(f"/api/notes/{n}", json={"title": "A", "version": v}),
               lambda v: raw_client.patch(f"/api/notes/{n}", json={"title": "B", "version": v}))
    assert get(raw_client, n)["title"] == "A"


def test_stale_activity_toggle_and_calendar_move_are_rejected(raw_client, single):
    n = single["id"]
    # A перенёс заметку в календаре, B (со старой версией) переключил активность в списке
    stale_case(raw_client, n,
               lambda v: raw_client.patch(f"/api/notes/{n}", json={"start_at": "2026-11-05T09:00:00Z", "version": v}),
               lambda v: raw_client.patch(f"/api/notes/{n}", json={"is_active": False, "version": v}))
    d = get(raw_client, n)
    assert d["start_at"] == "2026-11-05T09:00:00Z" and d["is_active"] is True


def test_stale_trash_restore_purge(raw_client, single):
    n = single["id"]
    # A изменил заголовок, B пытается удалить старую версию — не должен удалить то, чего не видел
    stale_case(raw_client, n,
               lambda v: raw_client.patch(f"/api/notes/{n}", json={"title": "A", "version": v}),
               lambda v: raw_client.delete(f"/api/notes/{n}", params={"version": v}))
    assert get(raw_client, n)["deleted_at"] is None
    v = get(raw_client, n)["version"]
    raw_client.delete(f"/api/notes/{n}", params={"version": v})
    # A восстановил, B со старой версией пытается удалить навсегда
    stale_case(raw_client, n,
               lambda v: raw_client.post(f"/api/notes/{n}/restore", params={"version": v}),
               lambda v: raw_client.delete(f"/api/notes/{n}/purge", params={"version": v}))
    assert raw_client.get(f"/api/notes/{n}").status_code == 200


def test_two_clients_edit_same_occurrence_and_series(raw_client, series):
    s = series["id"]
    url = f"/api/notes/{s}/occurrences/{OCC}"
    stale_case(raw_client, s,
               lambda v: raw_client.patch(url, json={"title": "A", "version": v}),
               lambda v: raw_client.patch(url, json={"start_at": "2026-11-02T15:00:00Z", "version": v}))
    # Правка вхождения меняет версию серии: серия со старой версией тоже отклоняется
    stale_case(raw_client, s,
               lambda v: raw_client.delete(f"{url}/override", params={"version": v}),
               lambda v: raw_client.patch(f"/api/notes/{s}", json={"title": "B", "version": v}))
    stale_case(raw_client, s,
               lambda v: raw_client.delete(url, params={"version": v}),
               lambda v: raw_client.post(f"{url}/split", json={"title": "B", "version": v}))
    occ = raw_client.get("/api/occurrences", params={"from": "2026-11-01T00:00:00Z", "to": "2026-11-11T00:00:00Z"}).json()
    assert len(occ) == 9 and all(o["title"] == "Серия" for o in occ)  # 2 ноября удалено клиентом A
    assert all(o["note_version"] == get(raw_client, s)["version"] for o in occ)


@pytest.mark.parametrize("target", ["note", "occurrence"])
def test_simultaneous_requests_exactly_one_wins(app, raw_client, series, target):
    s = series["id"]
    url = f"/api/notes/{s}" if target == "note" else f"/api/notes/{s}/occurrences/{OCC}"
    barrier = threading.Barrier(8)
    codes: list[int] = []

    def worker(i):
        with TestClient(app) as c:
            barrier.wait()
            codes.append(c.patch(url, json={"title": f"tab {i}", "version": 1}).status_code)

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(8)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert sorted(codes) == [200] + [409] * 7
    assert get(raw_client, s)["version"] == 2
