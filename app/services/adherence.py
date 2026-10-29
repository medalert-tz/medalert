"""Monitor -> Predict -> Intervene: the core loop from the presentation."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.config import Settings
from app.models import (
    Device,
    DoseEvent,
    Intervention,
    Patient,
    Prescription,
    RiskAssessment,
)
from app.services.risk import AdherenceFeatures, RiskModel
from app.services.schedule import (
    complete_finished_courses,
    ensure_slots,
    expected_total_doses,
    supply_status,
    utc_to_local,
)


# ---------- Monitor ----------

NOT_TAKEN = ("missed", "skipped")


def mark_missed(db: Session, now: datetime, settings: Settings) -> int:
    cutoff = now - timedelta(minutes=settings.grace_minutes)
    result = db.execute(
        update(DoseEvent)
        .where(DoseEvent.status == "pending", DoseEvent.scheduled_at < cutoff)
        .values(status="missed", source="monitor")
    )
    return result.rowcount or 0


def apply_dose_action(dose: DoseEvent, action: str, now: datetime, snooze_minutes: int) -> None:
    """What a press on the wearable means. 'snooze' keeps the dose pending but silences
    the reminder for a while; it does not extend the missed-dose deadline."""
    if action == "snooze":
        dose.snoozed_until = now + timedelta(minutes=snooze_minutes)
        return
    dose.status = action  # taken | skipped | missed
    dose.taken_at = now
    dose.source = "device"
    dose.snoozed_until = None


def active_prescriptions(db: Session, patient_id: int) -> list[Prescription]:
    return list(
        db.scalars(
            select(Prescription).where(
                Prescription.patient_id == patient_id, Prescription.status == "active"
            )
        )
    )


def find_ackable_dose(
    db: Session, patient_id: int, now: datetime, settings: Settings, event_id: int | None = None
) -> DoseEvent | None:
    """The dose a button press refers to: the earliest pending dose inside its window."""
    q = (
        select(DoseEvent)
        .join(Prescription)
        .where(
            Prescription.patient_id == patient_id,
            DoseEvent.status == "pending",
            DoseEvent.scheduled_at <= now + timedelta(minutes=settings.ack_early_minutes),
            DoseEvent.scheduled_at >= now - timedelta(minutes=settings.grace_minutes),
        )
        .order_by(DoseEvent.scheduled_at)
    )
    if event_id is not None:
        q = q.where(DoseEvent.id == event_id)
    return db.scalars(q).first()


def next_pending_dose(db: Session, patient_id: int, now: datetime, settings: Settings) -> DoseEvent | None:
    return db.scalars(
        select(DoseEvent)
        .join(Prescription)
        .where(
            Prescription.patient_id == patient_id,
            DoseEvent.status == "pending",
            DoseEvent.scheduled_at >= now - timedelta(minutes=settings.grace_minutes),
        )
        .order_by(DoseEvent.scheduled_at)
    ).first()


@dataclass
class CourseProgress:
    prescription_id: int
    label: str
    day: int
    days_total: int | None
    doses_taken: int
    doses_resolved: int
    doses_total: int | None
    complete: bool


def course_progress(
    db: Session, patient_id: int, now: datetime, settings: Settings, focus: DoseEvent | None = None
) -> CourseProgress | None:
    """Progress for the regimen the wearable should show: the one the next dose belongs
    to, else the newest active one, else the most recently completed one."""
    rx = focus.prescription if focus is not None else None
    if rx is None:
        rx = db.scalars(
            select(Prescription)
            .where(Prescription.patient_id == patient_id, Prescription.status.in_(["active", "completed"]))
            .order_by((Prescription.status == "active").desc(), Prescription.created_at.desc())
        ).first()
    if rx is None:
        return None
    counts = dict(
        db.execute(
            select(DoseEvent.status, func.count())
            .where(DoseEvent.prescription_id == rx.id)
            .group_by(DoseEvent.status)
        ).all()
    )
    today = utc_to_local(now, ZoneInfo(settings.timezone)).date()
    day = max(1, (today - rx.start_date).days + 1)
    if rx.duration_days:
        day = min(day, rx.duration_days)
    return CourseProgress(
        prescription_id=rx.id,
        label=rx.drug_name[:24],
        day=day,
        days_total=rx.duration_days,
        doses_taken=counts.get("taken", 0),
        doses_resolved=sum(v for k, v in counts.items() if k != "pending"),
        doses_total=expected_total_doses(rx, settings),
        complete=rx.status == "completed",
    )


# ---------- Predict ----------

def compute_features(db: Session, patient: Patient, now: datetime, settings: Settings) -> AdherenceFeatures:
    rx_ids = [rx.id for rx in patient.prescriptions]
    since = now - timedelta(days=7)
    resolved = [] if not rx_ids else list(
        db.scalars(
            select(DoseEvent)
            .where(
                DoseEvent.prescription_id.in_(rx_ids),
                DoseEvent.status.in_(["taken", *NOT_TAKEN]),
                DoseEvent.scheduled_at >= since,
                DoseEvent.scheduled_at <= now,
            )
            .order_by(DoseEvent.scheduled_at.desc())
        )
    )
    # A dose the patient reports skipping is still a dose not taken.
    missed = sum(1 for d in resolved if d.status in NOT_TAKEN)
    consecutive = 0
    for d in resolved:
        if d.status not in NOT_TAKEN:
            break
        consecutive += 1

    device: Device | None = patient.device
    hours_silent = None
    if device is not None and device.last_seen_at is not None:
        hours_silent = (now - device.last_seen_at).total_seconds() / 3600

    supply_days = [
        s.days_remaining
        for rx in patient.prescriptions
        if rx.status == "active"
        for s in [supply_status(db, rx, settings)]
        if s.days_remaining is not None
    ]

    return AdherenceFeatures(
        doses_resolved_7d=len(resolved),
        miss_rate_7d=round(missed / len(resolved), 3) if resolved else 0.0,
        consecutive_misses=consecutive,
        hours_since_device_seen=round(hours_silent, 1) if hours_silent is not None else None,
        days_of_supply_left=min(supply_days) if supply_days else None,
    )


def assess_patient(
    db: Session, patient: Patient, now: datetime, settings: Settings, model: RiskModel
) -> RiskAssessment:
    feats = compute_features(db, patient, now, settings)
    result = model.predict(feats)
    ra = RiskAssessment(
        patient_id=patient.id,
        score=result.score,
        level=result.level,
        factors=result.factors,
        features=feats.to_dict(),
        model_version=result.model_version,
        computed_at=now,
    )
    db.add(ra)
    return ra


def latest_assessment(db: Session, patient_id: int) -> RiskAssessment | None:
    return db.scalars(
        select(RiskAssessment)
        .where(RiskAssessment.patient_id == patient_id)
        .order_by(RiskAssessment.computed_at.desc(), RiskAssessment.id.desc())
    ).first()


# ---------- Intervene ----------

def open_intervention_if_needed(
    db: Session, ra: RiskAssessment, now: datetime
) -> Intervention | None:
    """High-risk patients get one open intervention at a time (no duplicate alerts)."""
    if ra.level != "high":
        return None
    existing = db.scalars(
        select(Intervention).where(
            Intervention.patient_id == ra.patient_id, Intervention.status == "open"
        )
    ).first()
    if existing:
        existing.score = ra.score
        existing.reason = "; ".join(ra.factors)
        return None
    iv = Intervention(
        patient_id=ra.patient_id,
        reason="; ".join(ra.factors),
        score=ra.score,
        status="open",
        created_at=now,
    )
    db.add(iv)
    return iv


@dataclass
class MonitorReport:
    slots_created: int
    doses_marked_missed: int
    patients_assessed: int
    interventions_opened: int


def run_monitor(db: Session, now: datetime, settings: Settings, model: RiskModel) -> MonitorReport:
    created = 0
    for rx in db.scalars(select(Prescription).where(Prescription.status == "active")):
        created += ensure_slots(db, rx, now, settings)
    db.flush()
    missed = mark_missed(db, now, settings)
    complete_finished_courses(db, now, settings)
    db.flush()

    assessed = opened = 0
    patients = db.scalars(
        select(Patient).where(Patient.prescriptions.any(Prescription.status == "active"))
    ).all()
    for p in patients:
        ra = assess_patient(db, p, now, settings, model)
        assessed += 1
        if open_intervention_if_needed(db, ra, now):
            opened += 1
    db.commit()
    return MonitorReport(created, missed, assessed, opened)
