"""Wearable actions (snooze / skip / missed), course progress, and demo time controls."""
from datetime import datetime

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from tests.conftest import TEST_KEY, FakeClock


def dev(token):
    return {"X-Device-Token": token, "X-API-Key": ""}


def setup_course(client, days=2, times=("08:00", "20:00")):
    p = client.post("/api/v1/patients", json={"display_name": "Juma H."}).json()
    token = client.post(f"/api/v1/patients/{p['id']}/device", json={"serial": "W-1"}).json()["device_token"]
    rx = client.post(
        f"/api/v1/patients/{p['id']}/prescriptions",
        json={"drug_name": "Amoxicillin 500mg", "times": list(times), "start_date": "2026-10-12", "duration_days": days},
    ).json()
    return p, token, rx


def test_sync_reports_course_progress(client):
    _, token, rx = setup_course(client, days=3)
    assert rx["doses_total"] == 6
    s = client.post("/api/device/v1/sync", json={}, headers=dev(token)).json()
    assert s["course"] == {
        "prescription_id": rx["id"], "label": "Amoxicillin 500mg", "day": 1, "days_total": 3,
        "doses_taken": 0, "doses_resolved": 0, "doses_total": 6, "complete": False,
    }
    a = client.post("/api/device/v1/ack", json={}, headers=dev(token)).json()
    assert a["course"]["doses_taken"] == 1


def test_snooze_silences_alert_but_keeps_dose_pending(client, clock):
    _, token, _ = setup_course(client)
    assert client.post("/api/device/v1/sync", json={}, headers=dev(token)).json()["alert"] == "dose"
    a = client.post("/api/device/v1/ack", json={"action": "snooze"}, headers=dev(token)).json()
    assert a["accepted"] and a["action"] == "snooze"
    s = client.post("/api/device/v1/sync", json={}, headers=dev(token)).json()
    assert s["alert"] == "none" and s["snoozed_until"] is not None
    clock.advance(minutes=31)
    assert client.post("/api/device/v1/sync", json={}, headers=dev(token)).json()["alert"] == "dose"
    # Still takeable after snoozing
    assert client.post("/api/device/v1/ack", json={}, headers=dev(token)).json()["action"] == "taken"


def test_skipped_doses_count_against_adherence(client, clock):
    p, token, _ = setup_course(client, days=5)
    for _ in range(3):
        r = client.post("/api/device/v1/ack", json={"action": "skipped"}, headers=dev(token)).json()
        assert r["accepted"]
        clock.advance(hours=12)
    client.post("/api/v1/monitor/run")
    risk = client.get(f"/api/v1/patients/{p['id']}").json()["risk"]
    assert risk["level"] == "high"
    assert any("in a row" in f for f in risk["factors"])
    doses = client.get(f"/api/v1/patients/{p['id']}/doses").json()
    assert sum(d["status"] == "skipped" for d in doses) == 3


def test_course_completes_when_last_dose_resolved(client, clock):
    _, token, rx = setup_course(client, days=1, times=("08:00",))
    a = client.post("/api/device/v1/ack", json={}, headers=dev(token)).json()
    assert a["course"]["complete"] is True
    pres = client.get(f"/api/v1/patients/{rx['patient_id']}/prescriptions").json()
    assert pres[0]["status"] == "completed"
    s = client.post("/api/device/v1/sync", json={}, headers=dev(token)).json()
    assert s["course"]["complete"] is True and s["next_dose_id"] is None


def test_demo_endpoints_hidden_when_demo_mode_off(client):
    assert client.get("/api/demo/status").json()["enabled"] is False
    assert client.post("/api/demo/advance", json={"minutes": 5}).status_code == 404


def make_demo_client(tmp_path):
    settings = Settings(database_url=f"sqlite:///{tmp_path/'demo.db'}", api_key=TEST_KEY,
                        monitor_interval_seconds=0, demo_mode=True)
    c = TestClient(create_app(settings=settings, clock=FakeClock(datetime(2026, 10, 12, 5, 0))))
    c.headers.update({"X-API-Key": TEST_KEY})
    return c


def test_demo_next_dose_and_complete_course(tmp_path):
    with make_demo_client(tmp_path) as c:
        p, token, rx = setup_course(c, days=3)
        c.post("/api/device/v1/ack", json={}, headers=dev(token))  # take the 08:00 dose

        r = c.post("/api/demo/next-dose", json={"patient_id": p["id"]}).json()
        assert r["offset_minutes"] == 12 * 60  # jumped to 20:00
        assert c.post("/api/device/v1/sync", json={}, headers=dev(token)).json()["alert"] == "dose"

        r = c.post("/api/demo/complete-course", json={"patient_id": p["id"]}).json()
        assert "Took 5" in r["message"]
        s = c.post("/api/device/v1/sync", json={}, headers=dev(token)).json()
        assert s["course"]["complete"] and s["course"]["doses_taken"] == 6


def test_demo_advance_produces_misses_and_alert(tmp_path):
    with make_demo_client(tmp_path) as c:
        p, token, _ = setup_course(c, days=7)
        r = c.post("/api/demo/advance", json={"minutes": 48 * 60}).json()
        assert r["monitor"]["interventions_opened"] == 1
        assert c.get(f"/api/v1/patients/{p['id']}").json()["risk"]["level"] == "high"


def test_demo_reset_clears_everything(tmp_path):
    with make_demo_client(tmp_path) as c:
        setup_course(c)
        c.post("/api/demo/advance", json={"minutes": 60})
        r = c.post("/api/demo/reset").json()
        assert r["offset_minutes"] == 0
        assert c.get("/api/v1/patients").json() == []


def test_short_course_with_full_pack_is_not_refill_due(client):
    _, _, rx = setup_course(client, days=3)
    r = client.post(f"/api/v1/prescriptions/{rx['id']}/dispense", json={"doses_supplied": 6}).json()
    assert r["supply"]["days_remaining"] <= 3       # within the warning window...
    assert r["supply"]["refill_due"] is False      # ...but the pack covers the course
    _, _, rx2 = setup_course(client, days=3)
    r2 = client.post(f"/api/v1/prescriptions/{rx2['id']}/dispense", json={"doses_supplied": 2}).json()
    assert r2["supply"]["refill_due"] is True      # 2 pills for a 6-dose course
