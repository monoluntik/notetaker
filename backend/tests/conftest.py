"""Тесты работают на реальном PostgreSQL (БД notetaker_test), схема — через миграции Alembic."""

import os
import re

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

TEST_DB_URL = os.environ.get(
    "NOTETAKER_TEST_DATABASE_URL", "postgresql+psycopg://postgres@127.0.0.1:5433/notetaker_test"
)
BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


@pytest.fixture(scope="session")
def migrated_db() -> str:
    engine = create_engine(TEST_DB_URL)
    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE; CREATE SCHEMA public;"))
    engine.dispose()

    cfg = Config(os.path.join(BACKEND_DIR, "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(BACKEND_DIR, "alembic"))
    cfg.set_main_option("sqlalchemy.url", TEST_DB_URL)
    cfg.attributes["configure_logger"] = False
    command.upgrade(cfg, "head")
    return TEST_DB_URL


@pytest.fixture()
def engine(migrated_db):
    eng = create_engine(migrated_db, connect_args={"options": "-c timezone=UTC"})
    with eng.begin() as conn:
        tables = conn.execute(
            text("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> 'alembic_version'")
        ).scalars().all()
        conn.execute(text(f"TRUNCATE {', '.join(tables)} RESTART IDENTITY CASCADE"))
        conn.execute(text("INSERT INTO user_settings (id, timezone) VALUES (1, 'UTC')"))
        conn.execute(text("INSERT INTO scheduler_state (id, last_scan_at) VALUES (1, NULL)"))
    yield eng
    eng.dispose()


@pytest.fixture()
def settings(engine):
    from app.config import Settings

    return Settings(database_url=engine.url.render_as_string(hide_password=False), scheduler_enabled=False,
                    email_backend="memory")


@pytest.fixture()
def app(settings):
    from app.main import create_app

    return create_app(settings)


NOTE_MUTATION = re.compile(r"^/api/notes/(\d+)(/restore|/purge|/occurrences/[^/]+(/override|/split)?)?$")


class SingleClient(TestClient):
    """Клиент «одной вкладки»: если тест не передал version, подставляет актуальную.

    Версия обязательна во всех изменениях заметок (D14). Большинство тестов проверяют не
    конкуренцию, а бизнес-логику, поэтому ведут себя как единственный клиент, который
    перед изменением знает текущую версию. Тесты конкуренции передают версию явно
    (или используют `raw_client`, где ничего не подставляется).
    """

    def request(self, method, url, *args, **kwargs):
        path = str(url).split("?")[0]
        m = NOTE_MUTATION.match(path)
        if m and method.upper() in ("PATCH", "DELETE", "POST"):
            params = dict(kwargs.get("params") or {})
            body = kwargs.get("json")
            has_version = "version" in params or "version=" in str(url) or (
                isinstance(body, dict) and "version" in body)
            if not has_version:
                current = super().request("GET", f"/api/notes/{m.group(1)}")
                if current.status_code == 200:
                    v = current.json()["version"]
                    if method.upper() == "PATCH" or path.endswith("/split"):
                        kwargs["json"] = {**(body or {}), "version": v}
                    else:
                        kwargs["params"] = {**params, "version": v}
        return super().request(method, url, *args, **kwargs)


@pytest.fixture()
def client(app):
    with SingleClient(app) as c:
        yield c


@pytest.fixture()
def raw_client(app):
    with TestClient(app) as c:
        yield c
