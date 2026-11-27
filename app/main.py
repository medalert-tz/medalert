"""MediAlert API + clinician dashboard.

Run:  uvicorn app.main:app --reload
"""
from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import Callable
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI
from sqlalchemy import inspect, text
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

from app.api import advisor, auth, clinician, demo, device, patient
from app.config import Settings
from app.db import make_engine, make_sessionmaker
from app.models import Base
from app.security import RateLimiter
from app.services.adherence import run_monitor
from app.services.risk import HeuristicRiskModel, RiskModel

log = logging.getLogger("medialert")
STATIC = Path(__file__).parent / "static"  # classic dashboard (no build step)
FRONTEND_DIST = Path(__file__).parent.parent / "frontend" / "dist"  # React UI build


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def create_app(
    settings: Settings | None = None,
    clock: Callable[[], datetime] = utcnow,
    risk_model: RiskModel | None = None,
) -> FastAPI:
    settings = settings or Settings.from_env()
    engine = make_engine(settings.database_url)
    Base.metadata.create_all(engine)  # MVP; use Alembic migrations before the pilot.
    _add_missing_columns(engine)
    if settings.demo_mode and not isinstance(clock, demo.DemoClock):
        clock = demo.DemoClock(clock)
    SessionLocal = make_sessionmaker(engine)
    model = risk_model or HeuristicRiskModel(threshold=settings.risk_threshold)

    def monitor_once() -> None:
        with SessionLocal() as db:
            r = run_monitor(db, clock(), settings, model)
            if r.doses_marked_missed or r.interventions_opened:
                log.info("monitor: %s", r)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        task = None
        if settings.monitor_interval_seconds > 0:
            async def loop():
                while True:
                    try:
                        await run_in_threadpool(monitor_once)
                    except Exception:  # keep the loop alive; surface in logs
                        log.exception("monitor run failed")
                    await asyncio.sleep(settings.monitor_interval_seconds)
            task = asyncio.create_task(loop())
        yield
        if task:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
        engine.dispose()

    app = FastAPI(
        title="MediAlert API",
        version="0.1.0",
        description="Prescribe → Dispense → Monitor → Predict → Intervene. "
        "Clinicians log in at `/api/v1/auth/login` and send `Authorization: Bearer <token>` "
        "(hospital systems may use the `X-API-Key` header). Patients log in with their clinic "
        "code at `/api/patient/v1/login`; physical wearables use `X-Device-Token`.",
        lifespan=lifespan,
    )
    app.state.settings = settings
    app.state.clock = clock
    app.state.risk_model = model
    app.state.SessionLocal = SessionLocal
    app.state.engine = engine
    app.state.login_limiter = RateLimiter(limit=10, window=300)
    app.state.scan_limiter = RateLimiter(limit=20, window=3600)
    app.state.advisor_limiter = RateLimiter(limit=40, window=3600)

    app.include_router(auth.router)
    app.include_router(clinician.router)
    app.include_router(patient.router)
    app.include_router(advisor.router)
    app.include_router(device.router)
    app.include_router(demo.router)

    @app.get("/healthz", include_in_schema=False)
    def healthz():
        return {"ok": True}

    app.mount("/static", StaticFiles(directory=STATIC), name="static")

    @app.get("/classic", include_in_schema=False)
    def classic():
        return FileResponse(STATIC / "index.html")

    if (FRONTEND_DIST / "index.html").is_file():
        # React UI (built with `npm run build` in frontend/)
        app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

        @app.get("/", include_in_schema=False)
        def index():
            return FileResponse(FRONTEND_DIST / "index.html")
    else:
        @app.get("/", include_in_schema=False)
        def index_classic():
            return FileResponse(STATIC / "index.html")

    return app


def _add_missing_columns(engine) -> None:
    """Tiny stand-in for migrations so databases from earlier versions keep working."""
    wanted = {
        "dose_events": {"snoozed_until": "DATETIME"},
        "patients": {"self_managed": "BOOLEAN NOT NULL DEFAULT FALSE"},
        "devices": {"access_code_hash": "VARCHAR(64)"},
    }
    insp = inspect(engine)
    for table, columns in wanted.items():
        existing = {c["name"] for c in insp.get_columns(table)}
        for name, ddl in columns.items():
            if name not in existing:
                with engine.begin() as conn:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))


app = create_app()
