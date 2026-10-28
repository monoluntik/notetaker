from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker


class Base(DeclarativeBase):
    pass


def make_engine(url: str) -> Engine:
    # Сессии БД всегда в UTC: результат не зависит от часового пояса сервера PostgreSQL.
    return create_engine(url, pool_pre_ping=True, future=True, connect_args={"options": "-c timezone=UTC"})


def make_sessionmaker(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, expire_on_commit=False, future=True)


def session_scope_factory(factory: sessionmaker[Session]):
    def get_db() -> Iterator[Session]:
        with factory() as session:
            yield session

    return get_db
