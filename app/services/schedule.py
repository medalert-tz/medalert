"""Turning prescriptions into concrete dose slots, and supply/refill estimates."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import Settings
from app.models import Dispensation, DoseEvent, Prescription


def parse_hhmm(value: str) -> time:
    hh, mm = value.split(":")
    t = time(int(hh), int(mm))
    return t


def local_to_utc(d: date, t: time, tz: ZoneInfo) -> datetime:
    """Local wall-clock date+time -> naive UTC datetime."""
    return datetime.combine(d, t, tzinfo=tz).astimezone(timezone.utc).replace(tzinfo=None)


def utc_to_local(dt: datetime, tz: ZoneInfo) -> datetime:
    return dt.replace(tzinfo=timezone.utc).astimezone(tz)


def end_date(rx: Prescription) -> date | None:
    """Last day of the course (inclusive), or None for open-ended/chronic regimens."""
    if rx.duration_days is None:
        return None
    return rx.start_date + timedelta(days=rx.duration_days - 1)


def ensure_slots(db: Session, rx: Prescription, now: datetime, settings: Settings) -> int:
    """Create any missing dose slots from the start date up to the scheduling horizon.

    Idempotent. Slots earlier than the moment the prescription was created are skipped,
    so a 14:00 prescription doesn't produce an already-missed 08:00 dose.
    Returns the number of slots created.
    """
    if rx.status != "active":
        return 0
    tz = ZoneInfo(settings.timezone)
    today_local = utc_to_local(now, tz).date()
    last = today_local + timedelta(days=settings.schedule_horizon_days)
    course_end = end_date(rx)
    if course_end is not None:
        last = min(last, course_end)

    existing = set(
        db.scalars(select(DoseEvent.scheduled_at).where(DoseEvent.prescription_id == rx.id))
    )
    created = 0
    day = rx.start_date
    times = sorted(parse_hhmm(t) for t in rx.times)
    while day <= last:
        for t in times:
            slot = local_to_utc(day, t, tz)
            if slot < rx.created_at.replace(second=0, microsecond=0) or slot in existing:
                continue
            db.add(DoseEvent(prescription_id=rx.id, scheduled_at=slot, status="pending"))
            existing.add(slot)
            created += 1
        day += timedelta(days=1)
    return created


def expected_total_doses(rx: Prescription, settings: Settings) -> int | None:
    """Total doses in a fixed course (None for ongoing regimens). Mirrors ensure_slots,
    including skipping slots that fell before the prescription was created."""
    course_end = end_date(rx)
    if course_end is None:
        return None
    tz = ZoneInfo(settings.timezone)
    created = rx.created_at.replace(second=0, microsecond=0)
    times = [parse_hhmm(t) for t in rx.times]
    total = 0
    day = rx.start_date
    while day <= course_end:
        total += sum(1 for t in times if local_to_utc(day, t, tz) >= created)
        day += timedelta(days=1)
    return total


def complete_finished_courses(db: Session, now: datetime, settings: Settings) -> list[Prescription]:
    """Mark a fixed course completed once every one of its doses exists and none is
    still pending (taken, skipped or missed all count as resolved). Returns those marked."""
    tz = ZoneInfo(settings.timezone)
    today_local = utc_to_local(now, tz).date()
    done = []
    for rx in db.scalars(select(Prescription).where(Prescription.status == "active")):
        course_end = end_date(rx)
        if course_end is None or today_local < course_end:
            continue
        counts = dict(
            db.execute(
                select(DoseEvent.status, func.count())
                .where(DoseEvent.prescription_id == rx.id)
                .group_by(DoseEvent.status)
            ).all()
        )
        if counts.get("pending", 0) == 0 and sum(counts.values()) >= (expected_total_doses(rx, settings) or 0):
            rx.status = "completed"
            done.append(rx)
    return done


@dataclass
class SupplyStatus:
    doses_supplied: int
    doses_taken: int
    doses_remaining: int
    days_remaining: float | None
    refill_due: bool


def supply_status(db: Session, rx: Prescription, settings: Settings) -> SupplyStatus:
    """Estimate remaining supply as supplied minus confirmed-taken doses.

    Assumption: confirmed doses are the best available consumption signal. Untracked
    loss (shared/sold/discarded pills) is not modelled.
    """
    supplied = db.scalar(
        select(func.coalesce(func.sum(Dispensation.doses_supplied), 0)).where(
            Dispensation.prescription_id == rx.id
        )
    ) or 0
    taken = db.scalar(
        select(func.count()).where(
            DoseEvent.prescription_id == rx.id, DoseEvent.status == "taken"
        )
    ) or 0
    remaining = max(supplied - taken, 0)
    per_day = len(rx.times) or 1
    days = remaining / per_day if supplied else None
    refill_due = rx.status == "active" and supplied > 0 and days is not None and days <= settings.refill_warning_days
    total = expected_total_doses(rx, settings)
    if refill_due and total is not None:
        # A fixed course only needs a refill if the pills on hand won't cover the
        # doses still to come (missed doses leave pills in the pack).
        resolved = db.scalar(
            select(func.count()).where(
                DoseEvent.prescription_id == rx.id, DoseEvent.status != "pending"
            )
        ) or 0
        refill_due = remaining < total - resolved
    return SupplyStatus(supplied, taken, remaining, days, refill_due)
