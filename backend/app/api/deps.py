from collections.abc import Iterator

from fastapi import Request
from sqlalchemy.orm import Session


def get_db(request: Request) -> Iterator[Session]:
    with request.app.state.sessionmaker() as session:
        yield session


def get_now(request: Request):
    """Текущий момент (UTC). В тестах подменяется через app.state.clock."""
    return request.app.state.clock()
