"""Voice health advisor endpoint (the Groq call is replaced in tests)."""
from app.services import advisor
from tests.test_portals import bearer, clinic_patient_with_code, doctor_token  # noqa: F401


def patient_token(client, token):
    p, code = clinic_patient_with_code(client, token)
    client.post(
        f"/api/v1/patients/{p['id']}/prescriptions",
        json={"drug_name": "Amoxicillin 500mg", "dose_instructions": "1 capsule",
              "times": ["08:00", "14:00", "20:00"], "start_date": "2026-10-12", "duration_days": 7},
        headers=bearer(token),
    )
    return client.post("/api/patient/v1/login", json={"code": code}).json()["token"]


def with_key(client):
    s = client.app.state.settings
    client.app.state.settings = s.__class__(**{**s.__dict__, "groq_api_key": "test-key"})


QUESTION = {"messages": [{"role": "user", "content": "Can I take it with food?"}], "lang": "en"}


def test_advisor_without_key_says_not_switched_on(client, doctor_token):
    tok = patient_token(client, doctor_token)
    r = client.post("/api/patient/v1/advisor", json=QUESTION, headers=bearer(tok))
    assert r.status_code == 503
    assert "isn't switched on" in r.json()["detail"]


def test_advisor_answers_with_prescription_context(client, doctor_token, monkeypatch):
    tok = patient_token(client, doctor_token)
    with_key(client)
    seen = {}

    def fake(messages, settings):
        seen["messages"] = messages
        return "Yes, taking it with food can ease an upset stomach."

    monkeypatch.setattr(advisor, "call_groq", fake)
    r = client.post("/api/patient/v1/advisor", json={**QUESTION, "lang": "sw"}, headers=bearer(tok))
    assert r.status_code == 200, r.text
    assert r.json()["reply"].startswith("Yes")
    system = seen["messages"][0]
    assert system["role"] == "system"
    assert "Amoxicillin 500mg" in system["content"] and "Kiswahili" in system["content"]
    assert seen["messages"][-1] == QUESTION["messages"][0]


def test_advisor_busy_and_failures_are_friendly(client, doctor_token, monkeypatch):
    tok = patient_token(client, doctor_token)
    with_key(client)

    def busy(messages, settings):
        raise advisor.AdvisorBusy()

    monkeypatch.setattr(advisor, "call_groq", busy)
    assert client.post("/api/patient/v1/advisor", json=QUESTION, headers=bearer(tok)).status_code == 429

    def broken(messages, settings):
        raise advisor.AdvisorFailed("boom")

    monkeypatch.setattr(advisor, "call_groq", broken)
    assert client.post("/api/patient/v1/advisor", json=QUESTION, headers=bearer(tok)).status_code == 502


def test_advisor_needs_patient_login(client):
    assert client.post("/api/patient/v1/advisor", json=QUESTION, headers=bearer("made-up")).status_code == 401
