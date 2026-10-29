import os
from datetime import datetime

import pytest

# Keep the module-level app from touching a real database during imports.
os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("MEDALERT_MONITOR_INTERVAL", "0")

from fastapi.testclient import TestClient  # noqa: E402

from app.config import Settings  # noqa: E402
from app.main import create_app  # noqa: E402

TEST_KEY = "test-key-not-a-secret"


class FakeClock:
    """Naive-UTC clock tests can move forward."""

    def __init__(self, start: datetime):
        self.now = start

    def __call__(self) -> datetime:
        return self.now

    def advance(self, **kw):
        from datetime import timedelta
        self.now += timedelta(**kw)


@pytest.fixture
def clock():
    # 2026-10-12 05:00 UTC == 08:00 in Dar es Salaam (UTC+3)
    return FakeClock(datetime(2026, 10, 12, 5, 0))


@pytest.fixture
def client(tmp_path, clock):
    settings = Settings(
        database_url=f"sqlite:///{tmp_path/'test.db'}",
        api_key=TEST_KEY,
        monitor_interval_seconds=0,
    )
    app = create_app(settings=settings, clock=clock)
    with TestClient(app) as c:
        c.headers.update({"X-API-Key": TEST_KEY})
        yield c


@pytest.fixture
def patient_with_device(client):
    p = client.post("/api/v1/patients", json={"display_name": "Asha M.", "condition": "Hypertension"}).json()
    token = client.post(f"/api/v1/patients/{p['id']}/device", json={"serial": "MA-0001"}).json()["device_token"]
    return p, token
