"""Login portals: clinician accounts, patient codes, self-managed patients, photo reading."""
import pytest

from app.services import vision

DOCTOR = {"username": "dr.amina", "display_name": "Dr. Amina Juma", "password": "safe-password-1"}


def bearer(token):
    # Empty X-API-Key so the shared hospital key in the test client isn't used.
    return {"Authorization": f"Bearer {token}", "X-API-Key": ""}


@pytest.fixture
def doctor_token(client):
    r = client.post("/api/v1/auth/setup", json=DOCTOR)
    assert r.status_code == 201, r.text
    return r.json()["token"]


def clinic_patient_with_code(client, token):
    h = bearer(token)
    p = client.post("/api/v1/patients", json={"display_name": "Neema (synthetic)"}, headers=h).json()
    pair = client.post(f"/api/v1/patients/{p['id']}/device", json={"serial": "MA-1234"}, headers=h).json()
    return p, pair["access_code"]


# ---------- Clinician accounts ----------

def test_first_run_setup_then_closed(client):
    assert client.get("/api/v1/auth/status").json() == {"needs_setup": True}
    assert client.post("/api/v1/auth/setup", json=DOCTOR).status_code == 201
    assert client.get("/api/v1/auth/status").json() == {"needs_setup": False}
    again = client.post("/api/v1/auth/setup", json={**DOCTOR, "username": "someone.else"})
    assert again.status_code == 409


def test_login_logout_and_bearer_access(client, doctor_token):
    bad = client.post("/api/v1/auth/login", json={"username": "dr.amina", "password": "wrong"})
    assert bad.status_code == 401
    unknown = client.post("/api/v1/auth/login", json={"username": "nobody", "password": "x"})
    assert unknown.status_code == 401

    r = client.post("/api/v1/auth/login", json={"username": "DR.AMINA", "password": DOCTOR["password"]})
    assert r.status_code == 200
    token = r.json()["token"]
    assert client.get("/api/v1/auth/me", headers=bearer(token)).json()["display_name"] == "Dr. Amina Juma"
    assert client.get("/api/v1/patients", headers=bearer(token)).status_code == 200

    client.post("/api/v1/auth/logout", headers=bearer(token))
    assert client.get("/api/v1/patients", headers=bearer(token)).status_code == 401


def test_clinician_api_needs_login(client):
    assert client.get("/api/v1/patients", headers={"X-API-Key": ""}).status_code == 401
    assert client.get("/api/v1/patients", headers=bearer("made-up")).status_code == 401


def test_logged_in_clinician_can_add_colleague(client, doctor_token):
    r = client.post(
        "/api/v1/auth/clinicians",
        json={"username": "nurse.baraka", "display_name": "Nurse Baraka", "password": "another-pass-2"},
        headers=bearer(doctor_token),
    )
    assert r.status_code == 201
    assert client.post("/api/v1/auth/login", json={"username": "nurse.baraka", "password": "another-pass-2"}).status_code == 200
    # Password too short is rejected
    short = client.post(
        "/api/v1/auth/clinicians",
        json={"username": "x.y.z", "display_name": "X", "password": "short"},
        headers=bearer(doctor_token),
    )
    assert short.status_code == 422


def test_prescriber_defaults_to_logged_in_clinician(client, doctor_token):
    p, _ = clinic_patient_with_code(client, doctor_token)
    rx = client.post(
        f"/api/v1/patients/{p['id']}/prescriptions",
        json={"drug_name": "Losartan 50mg", "times": ["08:00"], "start_date": "2026-10-12"},
        headers=bearer(doctor_token),
    ).json()
    assert rx["prescriber"] == "Dr. Amina Juma"


def test_login_is_rate_limited(client):
    for _ in range(10):
        client.post("/api/v1/auth/login", json={"username": "x", "password": "y"})
    assert client.post("/api/v1/auth/login", json={"username": "x", "password": "y"}).status_code == 429


# ---------- Clinic patients ----------

def test_patient_logs_in_with_code_and_sees_medicines(client, doctor_token):
    p, code = clinic_patient_with_code(client, doctor_token)
    client.post(
        f"/api/v1/patients/{p['id']}/prescriptions",
        json={"drug_name": "Metformin 500mg", "times": ["08:00", "20:00"], "start_date": "2026-10-12"},
        headers=bearer(doctor_token),
    )

    sloppy = code.lower().replace("-", " ")  # typed loosely still works
    r = client.post("/api/patient/v1/login", json={"code": sloppy})
    assert r.status_code == 200
    token = r.json()["token"]
    assert r.json()["patient"]["self_managed"] is False

    rxs = client.get("/api/patient/v1/prescriptions", headers=bearer(token)).json()
    assert [x["drug_name"] for x in rxs] == ["Metformin 500mg"]

    # The watch view works with the patient session.
    s = client.post("/api/device/v1/sync", json={}, headers=bearer(token)).json()
    assert s["alert"] == "dose" and s["next_dose_label"] == "Metformin 500mg"
    a = client.post("/api/device/v1/ack", json={}, headers=bearer(token)).json()
    assert a["accepted"]

    # Clinic patients can't change what the clinician prescribed.
    add = client.post(
        "/api/patient/v1/prescriptions",
        json={"drug_name": "Something", "times": ["09:00"], "start_date": "2026-10-12"},
        headers=bearer(token),
    )
    assert add.status_code == 403


def test_wrong_code_rejected_and_new_code_revokes_old(client, doctor_token):
    p, code = clinic_patient_with_code(client, doctor_token)
    assert client.post("/api/patient/v1/login", json={"code": "AAAA-BBBB"}).status_code == 401
    token = client.post("/api/patient/v1/login", json={"code": code}).json()["token"]

    new = client.post(f"/api/v1/patients/{p['id']}/access-code", headers=bearer(doctor_token)).json()["access_code"]
    assert new != code
    assert client.post("/api/patient/v1/login", json={"code": code}).status_code == 401
    assert client.get("/api/patient/v1/me", headers=bearer(token)).status_code == 401
    assert client.post("/api/patient/v1/login", json={"code": new}).status_code == 200


def test_dashboard_shows_progress(client, clock, doctor_token):
    p, code = clinic_patient_with_code(client, doctor_token)
    h = bearer(doctor_token)
    client.post(
        f"/api/v1/patients/{p['id']}/prescriptions",
        json={"drug_name": "Amlodipine 5mg", "times": ["08:00"], "start_date": "2026-10-12"},
        headers=h,
    )
    token = client.post("/api/patient/v1/login", json={"code": code}).json()["token"]
    client.post("/api/device/v1/ack", json={}, headers=bearer(token))  # takes today's 08:00

    rows = client.get("/api/v1/dashboard", headers=h).json()
    assert len(rows) == 1
    row = rows[0]
    assert row["active_medicines"] == ["Amlodipine 5mg"]
    assert row["doses_taken"] == 1 and row["doses_missed"] == 0
    assert row["adherence_pct"] == 100.0
    assert row["next_dose_at"] is not None


# ---------- Self-managed patients ----------

def register(client, name="Juma (synthetic)"):
    r = client.post("/api/patient/v1/register", json={"display_name": name})
    assert r.status_code == 201, r.text
    return r.json()


def test_self_managed_patient_builds_own_schedule(client, doctor_token):
    me = register(client)
    assert me["patient"]["self_managed"] is True
    assert me["access_code"]  # shown once, to log in on another phone
    h = bearer(me["token"])

    rx = client.post(
        "/api/patient/v1/prescriptions",
        json={"drug_name": "Amoxicillin 500mg", "times": ["14:00", "21:00", "07:00"],
              "start_date": "2026-10-12", "duration_days": 5},
        headers=h,
    )
    assert rx.status_code == 201
    assert rx.json()["times"] == ["07:00", "14:00", "21:00"]
    assert client.get("/api/patient/v1/doses", headers=h).json()
    assert client.post("/api/device/v1/sync", json={}, headers=h).status_code == 200

    stopped = client.post(f"/api/patient/v1/prescriptions/{rx.json()['id']}/stop", headers=h).json()
    assert stopped["status"] == "stopped"

    # Logging in again with the code works.
    assert client.post("/api/patient/v1/login", json={"code": me["access_code"]}).status_code == 200

    # Clinics don't see self-managed patients.
    assert client.get("/api/v1/patients", headers=bearer(doctor_token)).json() == []
    assert client.get(f"/api/v1/patients/{me['patient']['id']}", headers=bearer(doctor_token)).status_code == 404


def test_patient_cannot_touch_someone_elses_medicine(client):
    a = register(client, "A (synthetic)")
    b = register(client, "B (synthetic)")
    rx = client.post(
        "/api/patient/v1/prescriptions",
        json={"drug_name": "Med", "times": ["08:00"], "start_date": "2026-10-12"},
        headers=bearer(a["token"]),
    ).json()
    r = client.post(f"/api/patient/v1/prescriptions/{rx['id']}/stop", headers=bearer(b["token"]))
    assert r.status_code == 404


# ---------- Photo reading ----------

FAKE_IMAGE = "A" * 200


def test_scan_without_key_says_type_it_in(client):
    me = register(client)
    r = client.post("/api/patient/v1/scan", json={"image_base64": FAKE_IMAGE}, headers=bearer(me["token"]))
    assert r.status_code == 503
    assert "Type your medicines" in r.json()["detail"]


def test_scan_returns_cleaned_draft(client, monkeypatch):
    me = register(client)
    client.app.state.settings = client.app.state.settings.__class__(
        **{**client.app.state.settings.__dict__, "anthropic_api_key": "test-key"}
    )

    def fake_call(image_base64, media_type, settings):
        assert settings.anthropic_api_key == "test-key"
        return {
            "is_prescription": True,
            "medicines": [
                {"drug_name": "Amoxicillin 500mg", "dose_instructions": "1 capsule", "times": ["21:00", "07:00", "14:00"],
                 "duration_days": 5, "confidence": "high"},
                {"drug_name": "Paracetamol 1g", "times": ["25:99", "08:00"], "confidence": "weird"},
                {"drug_name": "", "times": []},
            ],
            "warnings": ["Check the strength with your pharmacist."],
        }

    monkeypatch.setattr(vision, "call_anthropic", fake_call)
    r = client.post("/api/patient/v1/scan", json={"image_base64": FAKE_IMAGE}, headers=bearer(me["token"]))
    assert r.status_code == 200, r.text
    body = r.json()
    assert [m["drug_name"] for m in body["medicines"]] == ["Amoxicillin 500mg", "Paracetamol 1g"]
    assert body["medicines"][0]["times"] == ["07:00", "14:00", "21:00"]
    assert body["medicines"][1]["times"] == ["08:00"]  # invalid time dropped
    assert body["medicines"][1]["confidence"] == "low"
    assert body["warnings"]


def test_scan_only_for_self_managed(client, doctor_token):
    _, code = clinic_patient_with_code(client, doctor_token)
    token = client.post("/api/patient/v1/login", json={"code": code}).json()["token"]
    r = client.post("/api/patient/v1/scan", json={"image_base64": FAKE_IMAGE}, headers=bearer(token))
    assert r.status_code == 403
