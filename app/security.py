"""Authentication for the three kinds of caller.

- Clinicians: username + password -> session token (`Authorization: Bearer ...`).
  Hospital systems may instead send the shared `X-API-Key` (MEDALERT_API_KEY).
- Patients: a short access code from their clinic (or from self-registration)
  -> session token. The patient portal uses it for the watch view.
- Physical wearables: per-device random token in `X-Device-Token`.

Every secret (passwords, session tokens, device tokens, access codes) is stored only
as a hash. Sessions use real time, not the demo clock, so fast-forwarding a demo
doesn't log people out.
"""
from __future__ import annotations

import hashlib
import hmac
import secrets
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from fastapi import Depends, Header, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import AuthSession, Clinician, Device, Patient

CLINICIAN_SESSION_HOURS = 12
PATIENT_SESSION_DAYS = 90
PBKDF2_ITERATIONS = 240_000
# No 0/O, 1/I/L: easy to read aloud and type.
CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
CODE_LENGTH = 8


def real_utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def new_device_token() -> str:
    return secrets.token_urlsafe(24)


# ---------- Passwords ----------

def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, iterations, salt, expected = stored.split("$")
    except ValueError:
        return False
    if algo != "pbkdf2_sha256":
        return False
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), int(iterations))
    return hmac.compare_digest(digest.hex(), expected)


# ---------- Patient access codes ----------

def new_access_code() -> str:
    """e.g. 'K7QM-4XTP'. Shown once; only its hash is stored."""
    raw = "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))
    return f"{raw[:4]}-{raw[4:]}"


def normalize_access_code(code: str) -> str:
    """Accept 'k7qm 4xtp', 'K7QM4XTP', 'K7QM-4XTP' alike."""
    raw = "".join(ch for ch in code.upper() if ch.isalnum())
    return f"{raw[:4]}-{raw[4:]}" if len(raw) == CODE_LENGTH else raw


def hash_access_code(code: str) -> str:
    return hash_token("code:" + normalize_access_code(code))


# ---------- Sessions ----------

def start_session(db: Session, *, clinician: Clinician | None = None, patient: Patient | None = None) -> str:
    token = secrets.token_urlsafe(32)
    now = real_utcnow()
    life = timedelta(hours=CLINICIAN_SESSION_HOURS) if clinician else timedelta(days=PATIENT_SESSION_DAYS)
    db.add(
        AuthSession(
            token_hash=hash_token(token),
            kind="clinician" if clinician else "patient",
            clinician_id=clinician.id if clinician else None,
            patient_id=patient.id if patient else None,
            created_at=now,
            expires_at=now + life,
        )
    )
    return token


def end_session(db: Session, token: str) -> None:
    s = db.scalars(select(AuthSession).where(AuthSession.token_hash == hash_token(token))).first()
    if s:
        db.delete(s)


def end_patient_sessions(db: Session, patient_id: int) -> None:
    for s in db.scalars(select(AuthSession).where(AuthSession.patient_id == patient_id)):
        db.delete(s)


def bearer_token(authorization: str | None) -> str | None:
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip() or None
    return None


def _session(db: Session, token: str | None, kind: str) -> AuthSession | None:
    if not token:
        return None
    s = db.scalars(
        select(AuthSession).where(AuthSession.token_hash == hash_token(token), AuthSession.kind == kind)
    ).first()
    if s is None or s.expires_at <= real_utcnow():
        return None
    return s


@dataclass
class Caller:
    """Who is calling the clinician API: a logged-in clinician, or a hospital system (API key)."""

    clinician: Clinician | None

    @property
    def name(self) -> str | None:
        return self.clinician.display_name if self.clinician else None


def require_clinician(
    request: Request,
    authorization: str | None = Header(default=None),
    x_api_key: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> Caller:
    s = _session(db, bearer_token(authorization), "clinician")
    if s is not None:
        clinician = db.get(Clinician, s.clinician_id)
        if clinician is not None:
            return Caller(clinician)
    configured = request.app.state.settings.api_key
    if x_api_key and configured and hmac.compare_digest(x_api_key, configured):
        return Caller(None)
    raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Please log in as a clinician")


# Kept for any older imports.
require_api_key = require_clinician


def require_patient(
    authorization: str | None = Header(default=None), db: Session = Depends(get_db)
) -> Patient:
    s = _session(db, bearer_token(authorization), "patient")
    patient = db.get(Patient, s.patient_id) if s else None
    if patient is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Please log in with your patient code")
    return patient


def require_device(
    x_device_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> Device:
    """A physical wearable (X-Device-Token) or the patient portal (patient session)."""
    if x_device_token:
        device = db.scalars(select(Device).where(Device.token_hash == hash_token(x_device_token))).first()
        if device is None:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Unknown device")
        return device
    s = _session(db, bearer_token(authorization), "patient")
    if s is not None:
        device = db.scalars(select(Device).where(Device.patient_id == s.patient_id)).first()
        if device is not None:
            return device
    raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing device token")


# ---------- Brute-force protection for login endpoints ----------

class RateLimiter:
    """At most `limit` attempts per `window` seconds per client. In-memory (one server)."""

    def __init__(self, limit: int = 10, window: float = 300):
        self.limit, self.window = limit, window
        self.hits: dict[str, deque[float]] = defaultdict(deque)

    def check(self, request: Request) -> None:
        key = request.client.host if request.client else "unknown"
        now = time.monotonic()
        q = self.hits[key]
        while q and now - q[0] > self.window:
            q.popleft()
        if len(q) >= self.limit:
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many attempts. Wait a few minutes and try again.")
        q.append(now)

    def reset(self) -> None:
        self.hits.clear()
