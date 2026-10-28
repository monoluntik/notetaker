from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import health, notes, notifications, occurrences, settings as settings_api, tags
from app.config import Settings, get_settings
from app.db import make_engine, make_sessionmaker
from app.email import make_sender
from app.errors import DomainError
from app.realtime import Hub
from app.services.scheduler import ReminderScheduler
from app.timeutil import utcnow


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    engine = make_engine(settings.database_url)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.scheduler = ReminderScheduler(
            app.state.sessionmaker, app.state.email_sender, app.state.hub,
            lambda: app.state.clock(), settings.scheduler_interval_seconds,
        )
        if settings.scheduler_enabled:
            app.state.scheduler.start()
        yield
        await app.state.scheduler.stop()
        engine.dispose()

    app = FastAPI(title="Notetaker API", version="0.1.0", lifespan=lifespan)
    app.state.settings = settings
    app.state.engine = engine
    app.state.sessionmaker = make_sessionmaker(engine)
    app.state.clock = utcnow
    app.state.hub = Hub()
    app.state.email_sender = make_sender(settings)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(DomainError)
    async def domain_error_handler(_: Request, exc: DomainError):
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})

    @app.middleware("http")
    async def broadcast_changes(request: Request, call_next):
        # После любого успешного изменения данных открытые вкладки перечитывают их (D11)
        response = await call_next(request)
        if (
            request.method in ("POST", "PATCH", "PUT", "DELETE")
            and request.url.path.startswith("/api/")
            and not request.url.path.startswith("/api/notifications")
            and response.status_code < 400
        ):
            await app.state.hub.broadcast({"type": "changed", "path": request.url.path})
        return response

    for router in (health.router, tags.router, notes.router, occurrences.router, settings_api.router,
                   notifications.router):
        app.include_router(router, prefix="/api")
    app.include_router(notifications.ws_router)
    return app


app = create_app()
