"""Patient portal: log in with a code, see your medicines, and use the watch view.

Two kinds of patient:
- Clinic patients: their clinician prescribes; the portal is read-only for medicines.
- Self-managed patients (their hospital isn't on MediAlert yet): they add their own
  medicines, typed in or read from a photo of their paper prescription.
"""
from __future__ import annotations

import secrets
from datetime import timedelta

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.clinician import _rx_out
from app.db import get_db
from app.models import Device, DoseEvent, Patient, Prescription
from app.schemas import (
    DoseOut,
    PatientLoginIn,
    PatientMeOut,
    PatientRegisterIn,
    PatientSessionOut,
    PrescriptionIn,
    PrescriptionOut,
    ScanIn,
    ScanOut,
)
from app.security import (
    bearer_token,
    end_session,
    hash_access_code,
    hash_token,
    new_access_code,
    new_device_token,
    require_patient,
    start_session,
)
from app.services import vision
from app.services.schedule import ensure_slots

router = APIRouter(prefix="/api/patient/v1", tags=["patient"])


def _now(request: Request):
    return request.app.state.clock()


def _self_managed_only(patient: Patient) -> None:
    if not patient.self_managed:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Your medicines are managed by your clinic. Ask your clinician to change them.",
        )


@router.post("/login", response_model=PatientSessionOut)
def login(body: PatientLoginIn, request: Request, db: Session = Depends(get_db)):
    request.app.state.login_limiter.check(request)
    device = db.scalars(select(Device).where(Device.access_code_hash == hash_access_code(body.code))).first()
    if device is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "That code didn't work. Check it with your clinic.")
    patient = db.get(Patient, device.patient_id)
    token = start_session(db, patient=patient)
    db.commit()
    return PatientSessionOut(token=token, patient=PatientMeOut.model_validate(patient))


@router.post("/register", response_model=PatientSessionOut, status_code=201)
def register_self_managed(body: PatientRegisterIn, request: Request, db: Session = Depends(get_db)):
    """For patients whose hospital doesn't use MediAlert yet: set up your own schedule."""
    request.app.state.login_limiter.check(request)
    now = _now(request)
    patient = Patient(display_name=body.display_name.strip(), facility=None, self_managed=True, created_at=now)
    db.add(patient)
    db.flush()
    code = new_access_code()
    db.add(
        Device(
            patient_id=patient.id,
            serial=f"PHONE-{secrets.token_hex(3).upper()}",  # the phone acts as the reminder device
            token_hash=hash_token(new_device_token()),
            access_code_hash=hash_access_code(code),
            paired_at=now,
        )
    )
    token = start_session(db, patient=patient)
    db.commit()
    return PatientSessionOut(token=token, patient=PatientMeOut.model_validate(patient), access_code=code)


@router.post("/logout", status_code=204)
def logout(authorization: str | None = Header(default=None), db: Session = Depends(get_db)):
    token = bearer_token(authorization)
    if token:
        end_session(db, token)
        db.commit()


@router.get("/me", response_model=PatientMeOut)
def me(patient: Patient = Depends(require_patient)):
    return patient


@router.get("/prescriptions", response_model=list[PrescriptionOut])
def my_prescriptions(request: Request, patient: Patient = Depends(require_patient), db: Session = Depends(get_db)):
    rxs = sorted(patient.prescriptions, key=lambda r: r.created_at, reverse=True)
    return [_rx_out(db, rx, request) for rx in rxs]


@router.get("/doses", response_model=list[DoseOut])
def my_doses(
    request: Request,
    days: int = Query(7, ge=1, le=90),
    patient: Patient = Depends(require_patient),
    db: Session = Depends(get_db),
):
    now = _now(request)
    return db.scalars(
        select(DoseEvent)
        .join(Prescription)
        .where(
            Prescription.patient_id == patient.id,
            DoseEvent.scheduled_at >= now - timedelta(days=days),
            DoseEvent.scheduled_at <= now + timedelta(days=1),
        )
        .order_by(DoseEvent.scheduled_at.desc())
    ).all()


@router.post("/prescriptions", response_model=PrescriptionOut, status_code=201)
def add_my_prescription(
    body: PrescriptionIn, request: Request, patient: Patient = Depends(require_patient), db: Session = Depends(get_db)
):
    _self_managed_only(patient)
    data = body.model_dump()
    data["prescriber"] = data["prescriber"] or "Entered by patient"
    rx = Prescription(patient_id=patient.id, **data, status="active", created_at=_now(request))
    db.add(rx)
    db.flush()
    ensure_slots(db, rx, _now(request), request.app.state.settings)
    db.commit()
    db.refresh(rx)
    return _rx_out(db, rx, request)


@router.post("/prescriptions/{rx_id}/stop", response_model=PrescriptionOut)
def stop_my_prescription(
    rx_id: int, request: Request, patient: Patient = Depends(require_patient), db: Session = Depends(get_db)
):
    _self_managed_only(patient)
    rx = db.get(Prescription, rx_id)
    if rx is None or rx.patient_id != patient.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Medicine not found")
    rx.status = "stopped"
    for d in db.scalars(
        select(DoseEvent).where(
            DoseEvent.prescription_id == rx.id,
            DoseEvent.status == "pending",
            DoseEvent.scheduled_at > _now(request),
        )
    ):
        db.delete(d)
    db.commit()
    return _rx_out(db, rx, request)


@router.post("/scan", response_model=ScanOut)
def scan_prescription(body: ScanIn, request: Request, patient: Patient = Depends(require_patient)):
    """Read a photo of a paper prescription into a draft list of medicines and times.

    Nothing is saved: the patient reviews the draft, fixes anything wrong, then adds
    each medicine. The photo isn't stored.
    """
    _self_managed_only(patient)
    request.app.state.scan_limiter.check(request)
    settings = request.app.state.settings
    try:
        result = vision.read_prescription(body.image_base64, body.media_type, settings)
    except vision.VisionUnavailable:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Photo reading isn't switched on for this server. Type your medicines in below; your photo stays on screen to help.",
        ) from None
    except vision.VisionFailed as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"{e}. Try again, or type your medicines in below.") from None
    return ScanOut(**result, model=settings.vision_model)
