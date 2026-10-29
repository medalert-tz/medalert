"""Clinician accounts: first-run setup, login, logout, and adding colleagues."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Clinician
from app.schemas import AuthStatusOut, ClinicianCreateIn, ClinicianOut, ClinicianSessionOut, LoginIn
from app.security import (
    Caller,
    bearer_token,
    end_session,
    hash_password,
    real_utcnow,
    require_clinician,
    start_session,
    verify_password,
)

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])

# Same work as a real check, so a wrong username takes as long as a wrong password.
_DUMMY_HASH = hash_password("not-a-real-password")


def _no_clinicians(db: Session) -> bool:
    return (db.scalar(select(func.count()).select_from(Clinician)) or 0) == 0


def _create(db: Session, body: ClinicianCreateIn) -> Clinician:
    username = body.username.lower()
    if db.scalars(select(Clinician).where(Clinician.username == username)).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "That username is taken")
    c = Clinician(
        username=username,
        display_name=body.display_name.strip(),
        password_hash=hash_password(body.password),
        created_at=real_utcnow(),
    )
    db.add(c)
    db.flush()
    return c


@router.get("/status", response_model=AuthStatusOut)
def auth_status(db: Session = Depends(get_db)):
    return AuthStatusOut(needs_setup=_no_clinicians(db))


@router.post("/setup", response_model=ClinicianSessionOut, status_code=201)
def setup_first_account(body: ClinicianCreateIn, request: Request, db: Session = Depends(get_db)):
    """Create the very first clinician account. Closed once any account exists."""
    request.app.state.login_limiter.check(request)
    if not _no_clinicians(db):
        raise HTTPException(status.HTTP_409_CONFLICT, "Setup is already done. Log in instead.")
    c = _create(db, body)
    token = start_session(db, clinician=c)
    c.last_login_at = real_utcnow()
    db.commit()
    return ClinicianSessionOut(token=token, clinician=ClinicianOut.model_validate(c))


@router.post("/login", response_model=ClinicianSessionOut)
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)):
    request.app.state.login_limiter.check(request)
    c = db.scalars(select(Clinician).where(Clinician.username == body.username.strip().lower())).first()
    ok = verify_password(body.password, c.password_hash if c else _DUMMY_HASH)
    if c is None or not ok:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong username or password")
    token = start_session(db, clinician=c)
    c.last_login_at = real_utcnow()
    db.commit()
    return ClinicianSessionOut(token=token, clinician=ClinicianOut.model_validate(c))


@router.post("/logout", status_code=204)
def logout(authorization: str | None = Header(default=None), db: Session = Depends(get_db)):
    token = bearer_token(authorization)
    if token:
        end_session(db, token)
        db.commit()


@router.get("/me", response_model=ClinicianOut)
def me(caller: Caller = Depends(require_clinician)):
    if caller.clinician is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Signed in with the hospital API key, not an account")
    return caller.clinician


@router.get("/clinicians", response_model=list[ClinicianOut])
def list_clinicians(_: Caller = Depends(require_clinician), db: Session = Depends(get_db)):
    return db.scalars(select(Clinician).order_by(Clinician.display_name)).all()


@router.post("/clinicians", response_model=ClinicianOut, status_code=201)
def add_clinician(body: ClinicianCreateIn, _: Caller = Depends(require_clinician), db: Session = Depends(get_db)):
    """A logged-in clinician adds a colleague's account."""
    c = _create(db, body)
    db.commit()
    return c
