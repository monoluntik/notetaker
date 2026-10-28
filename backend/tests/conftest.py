"""Тесты работают на реальном PostgreSQL (БД notetaker_test), схема — через миграции Alembic."""

import os

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
    eng = create_engine(migrated_db)
    with eng.begin() as conn:
        tables = conn.execute(
            text("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> 'alembic_version'")
        ).scalars().all()
        conn.execute(text(f"TRUNCATE {', '.join(tables)} RESTART IDENTITY CASCADE"))
        conn.execute(text("INSERT INTO user_settings (id, timezone) VALUES (1, 'UTC')"))
    yield eng
    eng.dispose()


@pytest.fixture()
def settings(engine):
    from app.config import Settings

    return Settings(database_url=engine.url.render_as_string(hide_password=False), scheduler_enabled=False)


@pytest.fixture()
def app(settings):
    from app.main import create_app

    return create_app(settings)


@pytest.fixture()
def client(app):
    with TestClient(app) as c:
        yield c
