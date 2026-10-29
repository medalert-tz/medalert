"""End-to-end: Prescribe → Dispense → Monitor → Predict → Intervene."""


def dev(token):
    return {"X-Device-Token": token, "X-API-Key": ""}


def test_clinician_api_requires_key(client):
    r = client.get("/api/v1/patients", headers={"X-API-Key": "wrong"})
    assert r.status_code == 401


def test_device_api_rejects_unknown_token(client):
    r = client.post("/api/device/v1/sync", json={}, headers=dev("nope"))
    assert r.status_code == 401


def test_prescribe_creates_slots_and_skips_past_times(client, clock, patient_with_device):
    p, _ = patient_with_device
    clock.advance(hours=6)  # 14:00 local
    rx = client.post(
        f"/api/v1/patients/{p['id']}/prescriptions",
        json={"drug_name": "Amoxicillin 500mg", "times": ["20:00", "08:00"], "start_date": "2026-10-12", "duration_days": 5},
    ).json()
    assert rx["times"] == ["08:00", "20:00"]
    doses = client.get(f"/api/v1/patients/{p['id']}/doses?days=1").json()
    # Today's 08:00 is before prescribing -> skipped; 20:00 today + 2 tomorrow (horizon covers it)
    times = sorted(d["scheduled_at"] for d in doses)
    assert times[0] == "2026-10-12T17:00:00"  # 20:00 local in UTC


def test_course_never_schedules_past_its_end(client, patient_with_device):
    p, _ = patient_with_device
    client.post(
        f"/api/v1/patients/{p['id']}/prescriptions",
        json={"drug_name": "Short course", "times": ["08:00"], "start_date": "2026-10-12", "duration_days": 1},
    )
    doses = client.get(f"/api/v1/patients/{p['id']}/doses?days=30").json()
    assert len(doses) == 1


def test_full_loop(client, clock, patient_with_device):
    p, token = patient_with_device

    # Prescribe (chronic, twice daily) and dispense 10 doses
    rx = client.post(
        f"/api/v1/patients/{p['id']}/prescriptions",
        json={"drug_name": "Amlodipine 5mg", "times": ["08:00", "20:00"], "start_date": "2026-10-12"},
    ).json()
    rx = client.post(f"/api/v1/prescriptions/{rx['id']}/dispense", json={"doses_supplied": 10}).json()
    assert rx["supply"]["doses_remaining"] == 10

    # Device sync at 08:00 local -> dose alert
    s = client.post("/api/device/v1/sync", json={"battery_pct": 90}, headers=dev(token)).json()
    assert s["alert"] == "dose"
    assert s["next_dose_label"] == "Amlodipine 5mg"
    assert "display_name" not in s  # no personal data on the device channel

    # Button press confirms it; a second press has nothing to confirm
    a = client.post("/api/device/v1/ack", json={}, headers=dev(token)).json()
    assert a["accepted"] is True
    assert client.post("/api/device/v1/ack", json={}, headers=dev(token)).json()["accepted"] is False

    # Adherent so far -> low risk, no intervention
    clock.advance(hours=1)
    client.post("/api/v1/monitor/run")
    pt = client.get(f"/api/v1/patients/{p['id']}").json()
    assert pt["risk"]["level"] == "low"
    assert client.get("/api/v1/interventions").json() == []

    # Patient stops pressing for ~2 days -> misses pile up -> high risk -> intervention
    clock.advance(days=2)
    report = client.post("/api/v1/monitor/run").json()
    assert report["doses_marked_missed"] >= 3
    pt = client.get(f"/api/v1/patients/{p['id']}").json()
    assert pt["risk"]["level"] == "high"
    assert pt["open_intervention"] is True
    assert any("in a row" in f for f in pt["risk"]["factors"])

    queue = client.get("/api/v1/interventions").json()
    assert len(queue) == 1 and queue[0]["patient_name"] == "Asha M."

    # Running the monitor again does not duplicate the alert
    client.post("/api/v1/monitor/run")
    assert len(client.get("/api/v1/interventions").json()) == 1

    # Nurse resolves it
    r = client.post(
        f"/api/v1/interventions/{queue[0]['id']}/resolve",
        json={"resolved_by": "Nurse Zuhura", "note": "Called patient; device was off. Restarted."},
    )
    assert r.status_code == 200 and r.json()["status"] == "resolved"
    assert client.get("/api/v1/interventions").json() == []


def test_refill_alert(client, clock, patient_with_device):
    p, token = patient_with_device
    rx = client.post(
        f"/api/v1/patients/{p['id']}/prescriptions",
        json={"drug_name": "Salbutamol", "times": ["08:00", "20:00"], "start_date": "2026-10-12"},
    ).json()
    client.post(f"/api/v1/prescriptions/{rx['id']}/dispense", json={"doses_supplied": 4})
    clock.advance(minutes=90)  # past 08:00, before 20:00 -> no dose due now
    client.post("/api/device/v1/ack", json={}, headers=dev(token))  # takes the 08:00 dose
    s = client.post("/api/device/v1/sync", json={}, headers=dev(token)).json()
    assert s["refill_in_days"] == 1.5
    assert s["alert"] == "refill"


def test_stop_cancels_future_reminders(client, patient_with_device):
    p, token = patient_with_device
    rx = client.post(
        f"/api/v1/patients/{p['id']}/prescriptions",
        json={"drug_name": "X", "times": ["21:00"], "start_date": "2026-10-12"},
    ).json()
    client.post(f"/api/v1/prescriptions/{rx['id']}/stop")
    s = client.post("/api/device/v1/sync", json={}, headers=dev(token)).json()
    assert s["next_dose_id"] is None


def test_repairing_device_revokes_old_token(client, patient_with_device):
    p, old = patient_with_device
    client.post(f"/api/v1/patients/{p['id']}/device", json={"serial": "MA-0002"})
    assert client.post("/api/device/v1/sync", json={}, headers=dev(old)).status_code == 401


def test_invalid_times_rejected(client, patient_with_device):
    p, _ = patient_with_device
    r = client.post(
        f"/api/v1/patients/{p['id']}/prescriptions",
        json={"drug_name": "X", "times": ["8am"], "start_date": "2026-10-12"},
    )
    assert r.status_code == 422
