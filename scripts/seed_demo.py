"""Load fictional demo patients with a week of dose history, then run the monitor.

    python -m scripts.seed_demo            # uses DATABASE_URL (default ./medialert.db)

All names and data are made up. Prints each patient's portal code (demo only).
"""
from __future__ import annotations

import random
from datetime import timedelta

from sqlalchemy import select

from app.config import Settings
from app.db import make_engine, make_sessionmaker
from app.main import utcnow
from app.models import Base, Device, Dispensation, DoseEvent, Patient, Prescription
from app.security import hash_access_code, hash_token, new_access_code, new_device_token
from app.services.adherence import run_monitor
from app.services.risk import HeuristicRiskModel
from app.services.schedule import ensure_slots, utc_to_local
from zoneinfo import ZoneInfo

# name, condition, drug, times, duration, miss probability, device silent hours
DEMO = [
    ("Asha Mwinyi", "Hypertension", "Amlodipine 5mg", ["08:00", "20:00"], None, 0.03, 1),
    ("Juma Hassan", "Hypertension", "Losartan 50mg", ["07:00"], None, 0.2, 2),
    ("Neema Said", "Asthma", "Budesonide inhaler", ["08:00", "20:00"], None, 0.55, 30),
    ("Baraka Ali", "Pneumonia", "Amoxicillin 500mg", ["06:00", "14:00", "22:00"], 10, 0.1, 1),
]


def main() -> None:
    settings = Settings.from_env()
    engine = make_engine(settings.database_url)
    Base.metadata.create_all(engine)
    Session = make_sessionmaker(engine)
    rng = random.Random(7)
    now = utcnow()
    tz = ZoneInfo(settings.timezone)
    start = (utc_to_local(now, tz) - timedelta(days=7)).date()

    with Session() as db:
        if db.scalars(select(Patient)).first():
            print("Database already has patients; skipping seed.")
            return
        tokens = []
        for i, (name, cond, drug, times, days, p_miss, silent_h) in enumerate(DEMO, start=1):
            p = Patient(display_name=name, condition=cond, facility="Mnazi Mmoja (demo)", created_at=now - timedelta(days=8))
            db.add(p)
            db.flush()
            tok = new_device_token()
            code = new_access_code()
            db.add(Device(patient_id=p.id, serial=f"MA-{i:04d}", token_hash=hash_token(tok),
                          access_code_hash=hash_access_code(code),
                          paired_at=now - timedelta(days=8), last_seen_at=now - timedelta(hours=silent_h), battery_pct=rng.randint(40, 95)))
            rx = Prescription(patient_id=p.id, drug_name=drug, times=times, start_date=start, duration_days=days,
                              prescriber="Dr. Demo", status="active", created_at=now - timedelta(days=8))
            db.add(rx)
            db.flush()
            db.add(Dispensation(prescription_id=rx.id, doses_supplied=len(times) * (days or 14), dispensed_at=now - timedelta(days=7)))
            ensure_slots(db, rx, now, settings)
            db.flush()
            past = db.scalars(select(DoseEvent).where(DoseEvent.prescription_id == rx.id,
                                                      DoseEvent.scheduled_at < now - timedelta(minutes=settings.grace_minutes))
                              .order_by(DoseEvent.scheduled_at)).all()
            for j, d in enumerate(past):
                # The disengaging patient misses everything recently.
                recent_slump = p_miss > 0.5 and j >= len(past) - 3
                if recent_slump or rng.random() < p_miss:
                    d.status = "missed"
                else:
                    d.status, d.taken_at, d.source = "taken", d.scheduled_at + timedelta(minutes=rng.randint(0, 40)), "device"
            tokens.append((name, code))
        db.commit()
        report = run_monitor(db, now, settings, HeuristicRiskModel(settings.risk_threshold))
        print(f"Seeded {len(DEMO)} demo patients. Monitor: {report}")
        print("\nPatient portal codes (demo only):")
        for name, code in tokens:
            print(f"  {name:<14} {code}")


if __name__ == "__main__":
    main()
