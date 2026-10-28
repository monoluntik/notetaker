def test_settings_roundtrip(client):
    assert client.get("/api/settings").json() == {"email": None, "timezone": "UTC"}
    r = client.patch("/api/settings", json={"email": "me@example.com", "timezone": "Asia/Almaty"})
    assert r.json() == {"email": "me@example.com", "timezone": "Asia/Almaty"}
    # Частичное обновление не трогает другие поля
    assert client.patch("/api/settings", json={"timezone": "UTC"}).json()["email"] == "me@example.com"
    # Пустой email очищает его
    assert client.patch("/api/settings", json={"email": ""}).json()["email"] is None


def test_settings_validation(client):
    assert client.patch("/api/settings", json={"email": "not-an-email"}).status_code == 422
    assert client.patch("/api/settings", json={"timezone": "Nowhere/City"}).status_code == 422
    tzs = client.get("/api/timezones").json()
    assert "Asia/Almaty" in tzs and "UTC" in tzs
