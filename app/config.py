"""Runtime settings, read from environment variables. No secrets have defaults."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def load_dotenv(path: str | Path = ".env") -> None:
    """Load KEY=VALUE lines from a local .env file (if present) without overriding
    variables already set in the environment. Keeps secrets out of source code."""
    p = Path(path)
    if not p.is_file():
        return
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip().strip('"').strip("'")
        if value:
            os.environ.setdefault(key.strip(), value)


def _int(name: str, default: int) -> int:
    return int(os.environ.get(name, default))


def _float(name: str, default: float) -> float:
    return float(os.environ.get(name, default))


@dataclass(frozen=True)
class Settings:
    database_url: str = "sqlite:///./medialert.db"
    # Optional key for hospital systems calling the clinician API (X-API-Key header).
    # People log in with clinician accounts instead.
    api_key: str | None = None
    # Local timezone used to interpret prescription times like "08:00".
    timezone: str = "Africa/Dar_es_Salaam"
    # A dose can be confirmed this many minutes before its scheduled time...
    ack_early_minutes: int = 60
    # ...and is marked missed this many minutes after it, if not confirmed.
    grace_minutes: int = 120
    # How far ahead dose slots are materialised for open-ended regimens.
    schedule_horizon_days: int = 2
    # Risk score at or above which a nurse intervention is opened.
    risk_threshold: float = 0.6
    # Device/refill alert when supply falls to this many days.
    refill_warning_days: int = 3
    # Background monitor interval in seconds (0 disables it).
    monitor_interval_seconds: int = 60
    # Enables /api/demo time controls (fast-forward, reset). Never enable with real patients.
    demo_mode: bool = False
    # Reading prescription photos with Claude. Without a key, patients type the
    # prescription in themselves (the photo is still shown beside the form).
    anthropic_api_key: str | None = None
    vision_model: str = "claude-sonnet-5-5"

    @classmethod
    def from_env(cls) -> "Settings":
        load_dotenv()
        return cls(
            database_url=os.environ.get("DATABASE_URL", cls.database_url),
            api_key=os.environ.get("MEDALERT_API_KEY") or None,
            timezone=os.environ.get("MEDALERT_TIMEZONE", cls.timezone),
            ack_early_minutes=_int("MEDALERT_ACK_EARLY_MINUTES", cls.ack_early_minutes),
            grace_minutes=_int("MEDALERT_GRACE_MINUTES", cls.grace_minutes),
            schedule_horizon_days=_int("MEDALERT_SCHEDULE_HORIZON_DAYS", cls.schedule_horizon_days),
            risk_threshold=_float("MEDALERT_RISK_THRESHOLD", cls.risk_threshold),
            refill_warning_days=_int("MEDALERT_REFILL_WARNING_DAYS", cls.refill_warning_days),
            monitor_interval_seconds=_int("MEDALERT_MONITOR_INTERVAL", cls.monitor_interval_seconds),
            demo_mode=os.environ.get("MEDALERT_DEMO_MODE", "").strip().lower() in {"1", "true", "yes"},
            anthropic_api_key=os.environ.get("ANTHROPIC_API_KEY") or None,
            vision_model=os.environ.get("MEDALERT_VISION_MODEL", cls.vision_model),
        )
