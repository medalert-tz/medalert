"""Voice health advisor for the patient's watch (POST /api/patient/v1/advisor)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Patient, Prescription
from app.schemas import AdvisorIn, AdvisorOut
from app.security import require_patient
from app.services import advisor

router = APIRouter(prefix="/api/patient/v1", tags=["patient"])

MESSAGES = {
    "unavailable": {
        "en": "The voice advisor isn't switched on for this server yet.",
        "sw": "Mshauri wa sauti bado hajawashwa kwenye seva hii.",
    },
    "busy": {
        "en": "The free AI quota is busy. Try again in a minute.",
        "sw": "Huduma ya AI ina shughuli nyingi. Jaribu tena baada ya dakika moja.",
    },
    "failed": {
        "en": "I couldn't reach the AI advisor. Please try again.",
        "sw": "Sikuweza kumfikia mshauri wa AI. Tafadhali jaribu tena.",
    },
}


def patient_context(db: Session, patient: Patient) -> str:
    """One line about the patient's active medicines, so answers fit their situation."""
    rxs = db.scalars(
        select(Prescription).where(Prescription.patient_id == patient.id, Prescription.status == "active")
    ).all()
    first = (patient.display_name or "The patient").split(" ")[0]
    if not rxs:
        return ""
    parts = []
    for rx in rxs[:5]:
        how = f" ({rx.dose_instructions})" if rx.dose_instructions else ""
        course = f" for {rx.duration_days} days" if rx.duration_days else ", ongoing"
        parts.append(f"{rx.drug_name}{how} {len(rx.times)} times daily{course}")
    return f"{first} takes " + "; ".join(parts) + "."


@router.post("/advisor", response_model=AdvisorOut)
def ask_advisor(
    body: AdvisorIn, request: Request, patient: Patient = Depends(require_patient), db: Session = Depends(get_db)
):
    """Answer a spoken question with short, general, safe guidance. Nothing is stored."""
    request.app.state.advisor_limiter.check(request)
    settings = request.app.state.settings
    messages = [m.model_dump() for m in body.messages]
    try:
        reply = advisor.ask(messages, body.lang, patient_context(db, patient), settings)
    except advisor.AdvisorUnavailable:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, MESSAGES["unavailable"][body.lang]) from None
    except advisor.AdvisorBusy:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, MESSAGES["busy"][body.lang]) from None
    except advisor.AdvisorFailed:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, MESSAGES["failed"][body.lang]) from None
    return AdvisorOut(reply=reply)
