"""Request/response shapes."""
from __future__ import annotations

import re
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

_HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


class PatientIn(BaseModel):
    display_name: str = Field(min_length=1, max_length=120)
    phone: str | None = Field(default=None, max_length=32)
    condition: str | None = Field(default=None, max_length=120)
    facility: str | None = Field(default=None, max_length=120)


class RiskOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    score: float
    level: str
    factors: list[str]
    model_version: str
    computed_at: datetime


class DeviceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    serial: str
    paired_at: datetime
    last_seen_at: datetime | None
    battery_pct: int | None


class PatientOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    display_name: str
    phone: str | None
    condition: str | None
    facility: str | None
    self_managed: bool = False
    created_at: datetime
    device: DeviceOut | None = None
    risk: RiskOut | None = None
    open_intervention: bool = False


class DevicePairIn(BaseModel):
    serial: str = Field(min_length=1, max_length=64)


class DevicePairOut(BaseModel):
    serial: str
    device_token: str = Field(description="Shown once. Store it on the device; it cannot be retrieved later.")
    access_code: str = Field(description="Shown once. Give it to the patient to open the patient portal.")


class AccessCodeOut(BaseModel):
    access_code: str = Field(description="Shown once. Older codes and patient logins stop working.")


# ---- Clinician accounts ----

_USERNAME = r"^[a-zA-Z0-9._-]{3,64}$"


class ClinicianOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    username: str
    display_name: str


class ClinicianCreateIn(BaseModel):
    username: str = Field(pattern=_USERNAME, description="3-64 letters, digits, dot, dash or underscore")
    display_name: str = Field(min_length=1, max_length=120, examples=["Dr. Amina Juma"])
    password: str = Field(min_length=8, max_length=200)


class LoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=200)


class ClinicianSessionOut(BaseModel):
    token: str
    clinician: ClinicianOut


class AuthStatusOut(BaseModel):
    needs_setup: bool = Field(description="True until the first clinician account exists")


# ---- Patient portal ----

class PatientLoginIn(BaseModel):
    code: str = Field(min_length=4, max_length=20, examples=["K7QM-4XTP"])


class PatientRegisterIn(BaseModel):
    display_name: str = Field(min_length=1, max_length=120)


class PatientMeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    display_name: str
    facility: str | None
    self_managed: bool


class PatientSessionOut(BaseModel):
    token: str
    patient: PatientMeOut
    access_code: str | None = Field(default=None, description="Only on self-registration: keep it to log in again")


class ScanIn(BaseModel):
    image_base64: str = Field(min_length=100, max_length=8_000_000)
    media_type: Literal["image/jpeg", "image/png", "image/webp", "image/gif"] = "image/jpeg"


class ScannedMedicine(BaseModel):
    drug_name: str
    dose_instructions: str | None = None
    times: list[str] = Field(default_factory=list, description="Suggested local HH:MM times; patient must check")
    duration_days: int | None = None
    confidence: Literal["high", "medium", "low"] = "medium"
    note: str | None = None


class ScanOut(BaseModel):
    is_prescription: bool
    medicines: list[ScannedMedicine]
    warnings: list[str]
    model: str


# ---- Clinician dashboard ----

class PatientProgressOut(BaseModel):
    patient: PatientOut
    active_medicines: list[str]
    doses_taken: int
    doses_missed: int = Field(description="Missed or skipped in the period")
    adherence_pct: float | None = Field(description="Taken / (taken + missed + skipped); None if nothing due yet")
    next_dose_at: datetime | None
    refill_due: bool


class PrescriptionIn(BaseModel):
    drug_name: str = Field(min_length=1, max_length=120)
    dose_instructions: str | None = Field(default=None, max_length=200)
    times: list[str] = Field(min_length=1, max_length=6, description='Local times, e.g. ["08:00","20:00"]')
    start_date: date
    duration_days: int | None = Field(default=None, ge=1, le=3650, description="Omit for chronic/open-ended")
    prescriber: str | None = Field(default=None, max_length=120)

    @field_validator("times")
    @classmethod
    def _check_times(cls, v: list[str]) -> list[str]:
        for t in v:
            if not _HHMM.match(t):
                raise ValueError(f"Invalid time {t!r}; use 24h HH:MM")
        if len(set(v)) != len(v):
            raise ValueError("Duplicate times")
        return sorted(v)


class SupplyOut(BaseModel):
    doses_supplied: int
    doses_taken: int
    doses_remaining: int
    days_remaining: float | None
    refill_due: bool


class PrescriptionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    patient_id: int
    drug_name: str
    dose_instructions: str | None
    times: list[str]
    start_date: date
    duration_days: int | None
    prescriber: str | None
    status: str
    created_at: datetime
    doses_total: int | None = None  # fixed courses only
    supply: SupplyOut | None = None


class DispenseIn(BaseModel):
    doses_supplied: int = Field(ge=1, le=10000)
    dispensed_by: str | None = Field(default=None, max_length=120)


class DoseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    prescription_id: int
    scheduled_at: datetime
    status: str
    taken_at: datetime | None
    source: str | None


class InterventionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    patient_id: int
    patient_name: str | None = None
    reason: str
    score: float
    status: str
    created_at: datetime
    resolved_at: datetime | None
    resolved_by: str | None
    note: str | None


class ResolveIn(BaseModel):
    resolved_by: str = Field(min_length=1, max_length=120)
    note: str = Field(min_length=1, max_length=2000)


class MonitorOut(BaseModel):
    slots_created: int
    doses_marked_missed: int
    patients_assessed: int
    interventions_opened: int


# ---- Device protocol: deliberately tiny, no personal data ----

class DeviceSyncIn(BaseModel):
    battery_pct: int | None = Field(default=None, ge=0, le=100)


class CourseOut(BaseModel):
    prescription_id: int
    label: str
    day: int
    days_total: int | None = Field(description="None = ongoing regimen")
    doses_taken: int
    doses_resolved: int
    doses_total: int | None
    complete: bool


class DeviceSyncOut(BaseModel):
    server_time: datetime
    alert: str = Field(description="none | dose | refill — what the device should buzz/beep for now")
    next_dose_id: int | None
    next_dose_at: datetime | None
    next_dose_label: str | None = Field(description="Short drug label for devices with a display")
    snoozed_until: datetime | None = None
    refill_in_days: float | None
    course: CourseOut | None = Field(default=None, description="Progress for devices with a display")


class DeviceAckIn(BaseModel):
    dose_id: int | None = Field(default=None, description="Optional; omit for a plain button press")
    action: Literal["taken", "snooze", "skipped", "missed"] = Field(
        default="taken",
        description="One-button devices only send 'taken'. Devices with a screen can also snooze "
        "(30 min) or report a skipped/missed dose.",
    )


class DeviceAckOut(BaseModel):
    accepted: bool
    dose_id: int | None
    action: str | None = None
    message: str
    course: CourseOut | None = None


# ---- Demo time controls (only when MEDALERT_DEMO_MODE=1) ----

class DemoStatusOut(BaseModel):
    enabled: bool
    now: datetime
    offset_minutes: float


class DemoAdvanceIn(BaseModel):
    minutes: int = Field(ge=1, le=60 * 24 * 30)


class DemoPatientIn(BaseModel):
    patient_id: int


class DemoResultOut(BaseModel):
    now: datetime
    offset_minutes: float
    message: str
    monitor: MonitorOut | None = None


class AdvisorMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=500)


class AdvisorIn(BaseModel):
    messages: list[AdvisorMessage] = Field(min_length=1, max_length=10)
    lang: Literal["en", "sw"] = "en"


class AdvisorOut(BaseModel):
    reply: str
