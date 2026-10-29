"""Database models. All datetimes are stored as naive UTC."""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class Patient(Base):
    __tablename__ = "patients"

    id: Mapped[int] = mapped_column(primary_key=True)
    display_name: Mapped[str] = mapped_column(String(120))
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    condition: Mapped[str | None] = mapped_column(String(120), nullable=True)
    facility: Mapped[str | None] = mapped_column(String(120), nullable=True)
    # True when the patient set up their own schedule (their hospital isn't on MediAlert).
    # Self-managed patients don't appear in any clinic's dashboard or nurse queue.
    self_managed: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime)

    device: Mapped["Device | None"] = relationship(back_populates="patient", uselist=False)
    prescriptions: Mapped[list["Prescription"]] = relationship(back_populates="patient")


class Device(Base):
    __tablename__ = "devices"

    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"), unique=True)
    serial: Mapped[str] = mapped_column(String(64))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    # Short code the patient types to open the patient portal. Stored only as a hash.
    access_code_hash: Mapped[str | None] = mapped_column(String(64), unique=True, index=True, nullable=True)
    paired_at: Mapped[datetime] = mapped_column(DateTime)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    battery_pct: Mapped[int | None] = mapped_column(Integer, nullable=True)

    patient: Mapped[Patient] = relationship(back_populates="device")


class Prescription(Base):
    __tablename__ = "prescriptions"

    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"), index=True)
    drug_name: Mapped[str] = mapped_column(String(120))
    dose_instructions: Mapped[str | None] = mapped_column(String(200), nullable=True)
    times: Mapped[list[str]] = mapped_column(JSON)  # local "HH:MM" strings
    start_date: Mapped[date] = mapped_column(Date)
    duration_days: Mapped[int | None] = mapped_column(Integer, nullable=True)  # None = chronic
    prescriber: Mapped[str | None] = mapped_column(String(120), nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="active")  # active|completed|stopped
    created_at: Mapped[datetime] = mapped_column(DateTime)

    patient: Mapped[Patient] = relationship(back_populates="prescriptions")
    dispensations: Mapped[list["Dispensation"]] = relationship(back_populates="prescription")
    doses: Mapped[list["DoseEvent"]] = relationship(back_populates="prescription")


class Dispensation(Base):
    __tablename__ = "dispensations"

    id: Mapped[int] = mapped_column(primary_key=True)
    prescription_id: Mapped[int] = mapped_column(ForeignKey("prescriptions.id"), index=True)
    doses_supplied: Mapped[int] = mapped_column(Integer)
    dispensed_at: Mapped[datetime] = mapped_column(DateTime)
    dispensed_by: Mapped[str | None] = mapped_column(String(120), nullable=True)

    prescription: Mapped[Prescription] = relationship(back_populates="dispensations")


class DoseEvent(Base):
    __tablename__ = "dose_events"
    __table_args__ = (UniqueConstraint("prescription_id", "scheduled_at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    prescription_id: Mapped[int] = mapped_column(ForeignKey("prescriptions.id"), index=True)
    scheduled_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    # pending | taken | skipped (patient said they skipped) | missed (patient said so, or
    # nobody confirmed within the grace window)
    status: Mapped[str] = mapped_column(String(16), default="pending")
    taken_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)  # when resolved
    source: Mapped[str | None] = mapped_column(String(16), nullable=True)  # device|monitor|demo
    snoozed_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    prescription: Mapped[Prescription] = relationship(back_populates="doses")


class RiskAssessment(Base):
    __tablename__ = "risk_assessments"

    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"), index=True)
    score: Mapped[float] = mapped_column(Float)
    level: Mapped[str] = mapped_column(String(8))  # low|medium|high
    factors: Mapped[list[str]] = mapped_column(JSON)
    features: Mapped[dict] = mapped_column(JSON)
    model_version: Mapped[str] = mapped_column(String(32))
    computed_at: Mapped[datetime] = mapped_column(DateTime, index=True)


class Intervention(Base):
    __tablename__ = "interventions"

    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"), index=True)
    reason: Mapped[str] = mapped_column(Text)
    score: Mapped[float] = mapped_column(Float)
    status: Mapped[str] = mapped_column(String(16), default="open")  # open|resolved
    created_at: Mapped[datetime] = mapped_column(DateTime)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    resolved_by: Mapped[str | None] = mapped_column(String(120), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)


class Clinician(Base):
    __tablename__ = "clinicians"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class AuthSession(Base):
    """A logged-in clinician or patient. Only the SHA-256 of the session token is stored."""

    __tablename__ = "auth_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    kind: Mapped[str] = mapped_column(String(16))  # clinician | patient
    clinician_id: Mapped[int | None] = mapped_column(ForeignKey("clinicians.id"), nullable=True)
    patient_id: Mapped[int | None] = mapped_column(ForeignKey("patients.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime)
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)
