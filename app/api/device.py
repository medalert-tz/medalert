"""Wearable protocol. Two calls, small payloads, no patient-identifying data.

Assumption (not in the presentation): a one-button device presses `ack` with the
default action "taken". Devices with a screen (like the web watch simulator) may also
snooze or report a skipped/missed dose. Transport (GSM/SMS gateway, LoRa, BLE hub) is
undecided; whichever bridge is used would translate to these two HTTP calls.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Device, DoseEvent
from app.schemas import CourseOut, DeviceAckIn, DeviceAckOut, DeviceSyncIn, DeviceSyncOut
from app.security import require_device
from app.services.adherence import (
    active_prescriptions,
    apply_dose_action,
    course_progress,
    find_ackable_dose,
    mark_missed,
    next_pending_dose,
)
from app.services.schedule import complete_finished_courses, ensure_slots, supply_status

router = APIRouter(prefix="/api/device/v1", tags=["device"])

SNOOZE_MINUTES = 30
MESSAGES = {
    "taken": "Dose recorded",
    "snooze": f"Reminder snoozed for {SNOOZE_MINUTES} minutes",
    "skipped": "Skipped dose recorded",
    "missed": "Missed dose recorded",
}


def _course(db: Session, patient_id: int, now, settings, focus: DoseEvent | None) -> CourseOut | None:
    cp = course_progress(db, patient_id, now, settings, focus)
    return CourseOut(**cp.__dict__) if cp else None


@router.post("/sync", response_model=DeviceSyncOut)
def sync(body: DeviceSyncIn, request: Request, device: Device = Depends(require_device), db: Session = Depends(get_db)):
    settings = request.app.state.settings
    now = request.app.state.clock()
    device.last_seen_at = now
    if body.battery_pct is not None:
        device.battery_pct = body.battery_pct

    rxs = active_prescriptions(db, device.patient_id)
    for rx in rxs:
        ensure_slots(db, rx, now, settings)
    db.flush()
    mark_missed(db, now, settings)
    complete_finished_courses(db, now, settings)
    db.flush()

    due = find_ackable_dose(db, device.patient_id, now, settings)
    snoozed = due is not None and due.snoozed_until is not None and due.snoozed_until > now
    due_now = due is not None and due.scheduled_at <= now and not snoozed
    nxt = due or next_pending_dose(db, device.patient_id, now, settings)

    supplies = [s for rx in rxs if rx.status == "active" for s in [supply_status(db, rx, settings)] if s.days_remaining is not None]
    refill_days = min((s.days_remaining for s in supplies), default=None)
    refill_due = any(s.refill_due for s in supplies)

    course = _course(db, device.patient_id, now, settings, nxt)
    db.commit()
    return DeviceSyncOut(
        server_time=now,
        alert="dose" if due_now else ("refill" if refill_due else "none"),
        next_dose_id=nxt.id if nxt else None,
        next_dose_at=nxt.scheduled_at if nxt else None,
        next_dose_label=nxt.prescription.drug_name[:24] if nxt else None,
        snoozed_until=due.snoozed_until if snoozed else None,
        refill_in_days=round(refill_days, 1) if refill_days is not None else None,
        course=course,
    )


@router.post("/ack", response_model=DeviceAckOut)
def ack(body: DeviceAckIn, request: Request, device: Device = Depends(require_device), db: Session = Depends(get_db)):
    settings = request.app.state.settings
    now = request.app.state.clock()
    device.last_seen_at = now
    dose = find_ackable_dose(db, device.patient_id, now, settings, event_id=body.dose_id)
    if dose is None:
        db.commit()
        return DeviceAckOut(accepted=False, dose_id=body.dose_id, message="No dose due right now")
    apply_dose_action(dose, body.action, now, SNOOZE_MINUTES)
    db.flush()
    complete_finished_courses(db, now, settings)
    course = _course(db, device.patient_id, now, settings, dose)
    db.commit()
    return DeviceAckOut(accepted=True, dose_id=dose.id, action=body.action, message=MESSAGES[body.action], course=course)
