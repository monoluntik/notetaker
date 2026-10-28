def test_health_checks_database(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "database": "ok"}


def test_migrations_created_settings_row(engine):
    from sqlalchemy import text

    with engine.connect() as conn:
        row = conn.execute(text("SELECT id, timezone FROM user_settings")).one()
    assert tuple(row) == (1, "UTC")
