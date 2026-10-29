"""Demo-only time controls, so a pitch can show a whole course in two minutes.

Enabled only when MEDALERT_DEMO_MODE=1. They shift the *server's* clock (an offset
added to real time), so every rule — reminder windows, missed-dose detection, risk
scoring, interventions — runs exactly as it would in real life. Nothing is faked.
"""
from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Base, DoseEvent, Patient, Prescription
from app.schemas import DemoAdvanceIn, DemoPatientIn, DemoResultOut, DemoStatusOut, MonitorOut
from app.security import require_api_key
from app.services.adherence import apply_dose_action, find_ackable_dose, run_monitor
from app.services.schedule import complete_finished_courses, ensure_slots

router = APIRouter(prefix="/api/demo", tags=["demo"], dependencies=[Depends(require_api_key)])


class DemoClock:
    """Real UTC time plus an adjustable offset."""

    def __init__(self, base):
        self.base = base
        self.offset = timedelta()

    def __call__(self) -> datetime:
        return self.base() + self.offset


def _clock(request: Request) -> DemoClock:
    clock = request.app.state.clock
    if not request.app.state.settings.demo_mode or not isinstance(clock, DemoClock):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Demo mode is off (set MEDALERT_DEMO_MODE=1)")
    return clock


def _monitor(request: Request, db: Session) -> MonitorOut:
    r = run_monitor(db, request.app.state.clock(), request.app.state.settings, request.app.state.risk_model)
    return MonitorOut(**r.__dict__)


def _result(clock: DemoClock, message: str, monitor: MonitorOut | None = None) -> DemoResultOut:
    return DemoResultOut(now=clock(), offset_minutes=clock.offset.total_seconds() / 60, message=message, monitor=monitor)


def _next_pending(db: Session, patient_id: int) -> DoseEvent | None:
    return db.scalars(
        select(DoseEvent)
        .join(Prescription)
        .where(Prescription.patient_id == patient_id, DoseEvent.status == "pending")
        .order_by(DoseEvent.scheduled_at)
    ).first()


def _jump_to_next_dose(request: Request, db: Session, patient_id: int) -> DoseEvent | None:
    """Move the clock forward to the patient's next dose time (never backwards)."""
    clock = _clock(request)
    settings = request.app.state.settings
    for rx in db.scalars(select(Prescription).where(Prescription.patient_id == patient_id, Prescription.status == "active")):
        ensure_slots(db, rx, clock(), settings)
    db.flush()
    dose = _next_pending(db, patient_id)
    if dose is None:
        return None
    if dose.scheduled_at > clock():
        clock.offset += dose.scheduled_at - clock()
    # Generate slots for the (possibly) new day, then let the monitor resolve older doses.
    run_monitor(db, clock(), settings, request.app.state.risk_model)
    return dose


@router.get("/status", response_model=DemoStatusOut)
def demo_status(request: Request):
    clock = request.app.state.clock
    enabled = request.app.state.settings.demo_mode and isinstance(clock, DemoClock)
    offset = clock.offset.total_seconds() / 60 if enabled else 0
    return DemoStatusOut(enabled=enabled, now=clock(), offset_minutes=offset)


@router.post("/advance", response_model=DemoResultOut)
def advance(body: DemoAdvanceIn, request: Request, db: Session = Depends(get_db)):
    clock = _clock(request)
    clock.offset += timedelta(minutes=body.minutes)
    return _result(clock, f"Moved forward {body.minutes} min", _monitor(request, db))


@router.post("/next-dose", response_model=DemoResultOut)
def next_dose(body: DemoPatientIn, request: Request, db: Session = Depends(get_db)):
    clock = _clock(request)
    if db.get(Patient, body.patient_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Patient not found")
    dose = _jump_to_next_dose(request, db, body.patient_id)
    db.commit()
    if dose is None:
        return _result(clock, "No upcoming doses")
    return _result(clock, "Clock moved to the next dose time")


@router.post("/complete-course", response_model=DemoResultOut)
def complete_course(body: DemoPatientIn, request: Request, db: Session = Depends(get_db)):
    """Fast-forward through the rest of the patient's fixed course, taking every dose."""
    clock = _clock(request)
    settings = request.app.state.settings
    taken = 0
    for _ in range(500):  # safety bound
        dose = _jump_to_next_dose(request, db, body.patient_id)
        if dose is None or dose.prescription.duration_days is None:
            break
        due = find_ackable_dose(db, body.patient_id, clock(), settings, event_id=dose.id)
        if due is None:
            break
        apply_dose_action(due, "taken", clock(), 0)
        due.source = "demo"
        taken += 1
        db.flush()
        complete_finished_courses(db, clock(), settings)
    db.commit()
    return _result(clock, f"Took {taken} dose(s) to finish the course", _monitor(request, db))


@router.post("/reset", response_model=DemoResultOut)
def reset(request: Request):
    """Wipe all data and return the clock to real time. Demo databases only."""
    clock = _clock(request)
    engine = request.app.state.engine
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    clock.offset = timedelta()
    return _result(clock, "Demo data cleared")
