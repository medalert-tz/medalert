"""Hospital / clinician API: Prescribe, Dispense, review risk, work the intervention queue."""
from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Device, Dispensation, DoseEvent, Intervention, Patient, Prescription
from app.schemas import (
    DevicePairIn,
    DevicePairOut,
    DispenseIn,
    DoseOut,
    InterventionOut,
    MonitorOut,
    PatientIn,
    PatientOut,
    PrescriptionIn,
    PrescriptionOut,
    ResolveIn,
    RiskOut,
    SupplyOut,
)
from app.security import hash_token, new_device_token, require_api_key
from app.services.adherence import latest_assessment, run_monitor
from app.services.schedule import ensure_slots, expected_total_doses, supply_status

router = APIRouter(prefix="/api/v1", tags=["clinician"], dependencies=[Depends(require_api_key)])


def _now(request: Request):
    return request.app.state.clock()


def _patient_or_404(db: Session, patient_id: int) -> Patient:
    p = db.get(Patient, patient_id)
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Patient not found")
    return p


def _rx_or_404(db: Session, rx_id: int) -> Prescription:
    rx = db.get(Prescription, rx_id)
    if rx is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Prescription not found")
    return rx


def _patient_out(db: Session, p: Patient) -> PatientOut:
    out = PatientOut.model_validate(p)
    ra = latest_assessment(db, p.id)
    out.risk = RiskOut.model_validate(ra) if ra else None
    out.open_intervention = db.scalars(
        select(Intervention.id).where(Intervention.patient_id == p.id, Intervention.status == "open")
    ).first() is not None
    return out


def _rx_out(db: Session, rx: Prescription, request: Request) -> PrescriptionOut:
    out = PrescriptionOut.model_validate(rx)
    out.doses_total = expected_total_doses(rx, request.app.state.settings)
    s = supply_status(db, rx, request.app.state.settings)
    out.supply = SupplyOut(**s.__dict__)
    return out


# ---------- Patients & devices ----------

@router.post("/patients", response_model=PatientOut, status_code=201)
def create_patient(body: PatientIn, request: Request, db: Session = Depends(get_db)):
    p = Patient(**body.model_dump(), created_at=_now(request))
    db.add(p)
    db.commit()
    db.refresh(p)
    return _patient_out(db, p)


@router.get("/patients", response_model=list[PatientOut])
def list_patients(db: Session = Depends(get_db)):
    patients = db.scalars(select(Patient).order_by(Patient.display_name)).all()
    out = [_patient_out(db, p) for p in patients]
    # Highest risk first: that's what a nurse needs to see.
    out.sort(key=lambda o: -(o.risk.score if o.risk else -1))
    return out


@router.get("/patients/{patient_id}", response_model=PatientOut)
def get_patient(patient_id: int, db: Session = Depends(get_db)):
    return _patient_out(db, _patient_or_404(db, patient_id))


@router.post("/patients/{patient_id}/device", response_model=DevicePairOut, status_code=201)
def pair_device(patient_id: int, body: DevicePairIn, request: Request, db: Session = Depends(get_db)):
    """Pair (or re-pair) a wearable. Re-pairing revokes the previous token."""
    p = _patient_or_404(db, patient_id)
    token = new_device_token()
    if p.device:
        p.device.serial = body.serial
        p.device.token_hash = hash_token(token)
        p.device.paired_at = _now(request)
        p.device.last_seen_at = None
    else:
        db.add(Device(patient_id=p.id, serial=body.serial, token_hash=hash_token(token), paired_at=_now(request)))
    db.commit()
    return DevicePairOut(serial=body.serial, device_token=token)


# ---------- Prescribe & Dispense ----------

@router.post("/patients/{patient_id}/prescriptions", response_model=PrescriptionOut, status_code=201)
def prescribe(patient_id: int, body: PrescriptionIn, request: Request, db: Session = Depends(get_db)):
    p = _patient_or_404(db, patient_id)
    rx = Prescription(patient_id=p.id, **body.model_dump(), status="active", created_at=_now(request))
    db.add(rx)
    db.flush()
    ensure_slots(db, rx, _now(request), request.app.state.settings)
    db.commit()
    db.refresh(rx)
    return _rx_out(db, rx, request)


@router.get("/patients/{patient_id}/prescriptions", response_model=list[PrescriptionOut])
def list_prescriptions(patient_id: int, request: Request, db: Session = Depends(get_db)):
    p = _patient_or_404(db, patient_id)
    return [_rx_out(db, rx, request) for rx in sorted(p.prescriptions, key=lambda r: r.created_at, reverse=True)]


@router.post("/prescriptions/{rx_id}/dispense", response_model=PrescriptionOut, status_code=201)
def dispense(rx_id: int, body: DispenseIn, request: Request, db: Session = Depends(get_db)):
    rx = _rx_or_404(db, rx_id)
    if rx.status != "active":
        raise HTTPException(status.HTTP_409_CONFLICT, f"Prescription is {rx.status}")
    db.add(Dispensation(prescription_id=rx.id, dispensed_at=_now(request), **body.model_dump()))
    db.commit()
    return _rx_out(db, rx, request)


@router.post("/prescriptions/{rx_id}/stop", response_model=PrescriptionOut)
def stop_prescription(rx_id: int, request: Request, db: Session = Depends(get_db)):
    rx = _rx_or_404(db, rx_id)
    rx.status = "stopped"
    # Future reminders for a stopped regimen are cancelled (deleted, never taken/missed).
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


# ---------- Monitor ----------

@router.get("/patients/{patient_id}/doses", response_model=list[DoseOut])
def list_doses(
    patient_id: int,
    request: Request,
    days: int = Query(7, ge=1, le=90),
    db: Session = Depends(get_db),
):
    _patient_or_404(db, patient_id)
    now = _now(request)
    return db.scalars(
        select(DoseEvent)
        .join(Prescription)
        .where(
            Prescription.patient_id == patient_id,
            DoseEvent.scheduled_at >= now - timedelta(days=days),
            DoseEvent.scheduled_at <= now + timedelta(days=1),
        )
        .order_by(DoseEvent.scheduled_at.desc())
    ).all()


@router.post("/monitor/run", response_model=MonitorOut)
def monitor_now(request: Request, db: Session = Depends(get_db)):
    """Run Monitor → Predict → Intervene immediately (it also runs on a timer)."""
    report = run_monitor(db, _now(request), request.app.state.settings, request.app.state.risk_model)
    return MonitorOut(**report.__dict__)


# ---------- Intervene ----------

@router.get("/interventions", response_model=list[InterventionOut])
def list_interventions(
    status_: str = Query("open", alias="status", pattern="^(open|resolved|all)$"),
    db: Session = Depends(get_db),
):
    q = select(Intervention, Patient.display_name).join(Patient, Patient.id == Intervention.patient_id)
    if status_ != "all":
        q = q.where(Intervention.status == status_)
    q = q.order_by(Intervention.score.desc(), Intervention.created_at)
    out = []
    for iv, name in db.execute(q).all():
        item = InterventionOut.model_validate(iv)
        item.patient_name = name
        out.append(item)
    return out


@router.post("/interventions/{iv_id}/resolve", response_model=InterventionOut)
def resolve_intervention(iv_id: int, body: ResolveIn, request: Request, db: Session = Depends(get_db)):
    iv = db.get(Intervention, iv_id)
    if iv is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Intervention not found")
    if iv.status != "open":
        raise HTTPException(status.HTTP_409_CONFLICT, "Already resolved")
    iv.status = "resolved"
    iv.resolved_at = _now(request)
    iv.resolved_by = body.resolved_by
    iv.note = body.note
    db.commit()
    out = InterventionOut.model_validate(iv)
    out.patient_name = db.get(Patient, iv.patient_id).display_name
    return out
