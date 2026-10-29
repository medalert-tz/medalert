"""Authentication for the two API surfaces.

- Clinician/hospital API: shared key from the MEDALERT_API_KEY env var (MVP only —
  replace with per-user accounts and roles before a pilot).
- Device API: per-device random token, shown once at pairing, stored only as a hash.
"""
from __future__ import annotations

import hashlib
import hmac
import secrets

from fastapi import Depends, Header, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Device


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def new_device_token() -> str:
    return secrets.token_urlsafe(24)


def require_api_key(request: Request, x_api_key: str | None = Header(default=None)) -> None:
    configured = request.app.state.settings.api_key
    if not configured:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Server has no MEDALERT_API_KEY configured; clinician API is disabled.",
        )
    if not x_api_key or not hmac.compare_digest(x_api_key, configured):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or missing API key")


def require_device(
    x_device_token: str | None = Header(default=None), db: Session = Depends(get_db)
) -> Device:
    if not x_device_token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing device token")
    device = db.scalars(
        select(Device).where(Device.token_hash == hash_token(x_device_token))
    ).first()
    if device is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Unknown device")
    return device
