"""A patient can be on several medicines at once, each with its own clinician-chosen times."""


def dev(token):
    return {"X-Device-Token": token, "X-API-Key": ""}


def prescribe(client, pid, drug, times, **extra):
    r = client.post(
        f"/api/v1/patients/{pid}/prescriptions",
        json={"drug_name": drug, "times": times, "start_date": "2026-10-12", **extra},
    )
    assert r.status_code == 201, r.text
    return r.json()


def test_two_medicines_with_custom_times(client, clock, patient_with_device):
    p, _ = patient_with_device
    a = prescribe(client, p["id"], "Metformin 500mg", ["19:45", "07:30"])
    b = prescribe(client, p["id"], "Amlodipine 5mg", ["09:15"], duration_days=3)

    assert a["times"] == ["07:30", "19:45"]  # any times the clinician picks, sorted
    rxs = client.get(f"/api/v1/patients/{p['id']}/prescriptions").json()
    assert {r["drug_name"] for r in rxs} == {"Metformin 500mg", "Amlodipine 5mg"}
    assert all(r["status"] == "active" for r in rxs)

    doses = client.get(f"/api/v1/patients/{p['id']}/doses?days=1").json()
    by_rx = {a["id"]: set(), b["id"]: set()}
    for d in doses:
        by_rx[d["prescription_id"]].add(d["scheduled_at"][11:16])
    # Stored in UTC: Dar es Salaam is UTC+3. 07:30 local is before "now" (08:00) so it's skipped today.
    assert "16:45" in by_rx[a["id"]]  # 19:45 local
    assert "06:15" in by_rx[b["id"]]  # 09:15 local


def test_doses_at_the_same_time_are_confirmed_one_by_one(client, clock, patient_with_device):
    p, token = patient_with_device
    clock.advance(minutes=-30)  # 07:30 local, before the first doses
    prescribe(client, p["id"], "Metformin 500mg", ["08:00"])
    prescribe(client, p["id"], "Losartan 50mg", ["08:00"])
    clock.advance(minutes=30)  # 08:00 local: both due

    s = client.post("/api/device/v1/sync", json={}, headers=dev(token)).json()
    assert s["alert"] == "dose"

    first = client.post("/api/device/v1/ack", json={}, headers=dev(token)).json()
    second = client.post("/api/device/v1/ack", json={}, headers=dev(token)).json()
    third = client.post("/api/device/v1/ack", json={}, headers=dev(token)).json()
    assert first["accepted"] and second["accepted"]
    assert first["dose_id"] != second["dose_id"]
    assert not third["accepted"]  # nothing left to confirm


def test_adding_a_medicine_keeps_the_existing_one(client, patient_with_device):
    p, _ = patient_with_device
    prescribe(client, p["id"], "Metformin 500mg", ["08:00", "20:00"])
    prescribe(client, p["id"], "Atorvastatin 20mg", ["22:00"])
    rxs = client.get(f"/api/v1/patients/{p['id']}/prescriptions").json()
    assert len(rxs) == 2
    assert all(r["status"] == "active" for r in rxs)
