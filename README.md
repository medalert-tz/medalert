# MediAlert — MVP

Low-cost wearable + hospital/clinician API that keeps patients on their full course —
no smartphone needed. This repo is the first working slice of
**Prescribe → Dispense → Monitor → Predict → Intervene**.

![MediAlert clinic workstation and wearable](docs/dashboard.png)

See [`docs/MVP_SPEC.md`](docs/MVP_SPEC.md) for requirements, assumptions, open questions
and architecture.

## What works

| Step | What happens | Where |
|---|---|---|
| Prescribe | Clinician registers patient, pairs the watch, sets drug + daily times, fixed course or ongoing | `POST /api/v1/patients/{id}/prescriptions` |
| Dispense | Doses handed out recorded → supply & refill estimate | `POST /api/v1/prescriptions/{id}/dispense` |
| Monitor | Wearable `sync` gets next dose / buzz / refill alert + course progress; `ack` records **taken**, **snooze 30 min**, **skipped** or **missed**; unconfirmed doses become *missed* after a grace window | `/api/device/v1/sync`, `/api/device/v1/ack` |
| Predict | Transparent risk score (0–1) with plain-language reasons; skipped doses count as not taken; swappable for a trained model | `app/services/risk.py` |
| Intervene | High-risk patients appear in the nurse queue (one open alert per patient); nurse records the follow-up | `/api/v1/interventions` |

**Two interfaces, same backend:**
- **`/`** — the React clinic workstation + simulated smartwatch (`frontend/`).
- **`/classic`** — the original plain HTML dashboard (no build step).
- **`/docs`** — interactive API docs.

## Run it

```bash
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\Activate.ps1
pip install -r requirements.txt -r requirements-dev.txt
```

Create a `.env` file (never commit it):

```
MEDALERT_DEMO_MODE=1
# Optional: lets self-managed patients photograph a paper prescription and have it read.
# Without it they type their medicines in (the photo stays on screen beside the form).
ANTHROPIC_API_KEY=
# Optional: only for hospital systems calling the API directly (X-API-Key header).
MEDALERT_API_KEY=
# Optional: the "Ask MediPal" voice advisor on the watch (free key from console.groq.com).
GROQ_API_KEY=
```

`MEDALERT_DEMO_MODE=1` turns on the demo time controls (fast-forward to the next dose,
skip a day, finish a course, reset). Leave it out for anything except demos.

```bash
python -m scripts.seed_demo        # optional: 4 fictional patients with a week of history
cd frontend && npm install && npm run build && cd ..   # builds the UI the server shows at /
uvicorn app.main:app --reload      # open http://localhost:8000
```

## Voice advisor ("Ask MediPal")

On the patient's watch face, **Ask MediPal** opens a voice advisor: the browser listens
(Chrome or Edge), the server asks a free Groq model for a short, general answer using the
patient's active medicines as context, and the watch reads it aloud in English or Swahili.
It never changes a dose and points emergencies to urgent care. Needs `GROQ_API_KEY` on the
server; without it the watch says the advisor isn't switched on. Endpoint:
`POST /api/patient/v1/advisor`.

## Put it online (free)

The `Dockerfile` builds the UI and runs the server in one container. On **Render**:
**New → Blueprint** → pick this repo (it reads `render.yaml`) → paste your `GROQ_API_KEY`
→ **Apply**. The free plan keeps the SQLite database only until the service restarts, which
is fine for demos; use Postgres (`DATABASE_URL`) for anything longer.

## Logging in

The front page has two portals:

- **Clinician portal** — username + password. The very first visit asks you to create the
  first clinician account; after that, logged-in clinicians add colleagues
  (`POST /api/v1/auth/clinicians`, or `/docs`). Clinicians see a **Dashboard** of all their
  patients' progress and a **Prescribe & patients** page.
- **Patient portal** — the patient types the code their clinician gave them (shown once when
  the clinician links their watch; **New patient code** issues a fresh one). They see their
  watch, their medicines and their doses.
- **My hospital doesn't use MediAlert yet** — a patient sets up their own reminders by
  photographing their paper prescription (read by Claude if `ANTHROPIC_API_KEY` is set) or
  typing it in. They check every medicine and time before saving. These self-managed
  patients don't appear in any clinic's dashboard.

### Changing the React UI

Needs Node.js 18+.

```bash
cd frontend
npm install
npm run dev        # http://localhost:3000 — hot reload; /api calls go to the server on :8000
npm run build      # type-checks, then rebuilds frontend/dist that the server serves at /
```

Keep `uvicorn` running in another terminal while using `npm run dev`.

## Demo script (2 minutes)

Use two browser windows side by side: one logged in as a clinician, one as the patient.

1. Log in as a clinician. The **Dashboard** shows every patient's progress.
2. **Prescribe & patients** → fill the form for a new patient (add as many medicines and times as needed) → **Confirm**. Note the **patient portal code**.
3. In the other window, open the **Patient portal** with that code. Back in the clinician window, **Trigger Next Reminder** → the patient's watch buzzes. Try **Delay 30m**, then **Taken**.
4. **Skip a Day** → doses become missed, risk rises, nurse alerts open.
5. **Jump to Complete** → course finishes, celebration.
6. In **Needs attention**, enter your name + outcome → **Mark followed up**.

## Test

```bash
pytest -q                          # backend tests
cd frontend && npm run typecheck   # UI: TypeScript strict mode
```

## Layout

```
app/
  main.py              app factory, background monitor, serves React build + classic page
  config.py            env/.env settings (no secret defaults)
  models.py            SQLAlchemy tables
  schemas.py           request/response models incl. the tiny device protocol
  security.py          passwords, sessions, patient codes, device tokens (all hashed), rate limits
  api/auth.py          /api/v1/auth — clinician setup, login, logout, add colleagues
  api/clinician.py     /api/v1 — dashboard, patients, prescriptions, dispensing, doses, interventions
  api/patient.py       /api/patient/v1 — patient login, self-managed medicines, prescription photo
  api/device.py        /api/device/v1 — sync, ack (taken/snooze/skipped/missed)
  api/demo.py          /api/demo — time controls, only when MEDALERT_DEMO_MODE=1
  services/schedule.py dose slots (local time → UTC), course totals, completion, refills
  services/adherence.py monitor → features → risk → interventions, course progress
  services/risk.py     RiskModel interface + HeuristicRiskModel v0
  services/vision.py   reads a prescription photo with Claude (draft only; patient confirms)
  static/              classic dashboard (/classic)
frontend/              React + Vite + Tailwind UI (src/), built output in dist/
  src/api.ts           all calls to the backend
  src/App.tsx          login page or the right portal
  src/components/      LoginPage, ClinicianPortal, PatientPortal, ProgressDashboard,
                       ClinicianView, AddMedicines, WearableView, …
scripts/seed_demo.py   fictional demo data
tests/                 backend tests
docs/MVP_SPEC.md       requirements, assumptions, architecture
```

## Plugging in a trained model

Implement `predict(features: AdherenceFeatures) -> RiskResult` with a `version` string and
pass it to `create_app(risk_model=...)`. Every assessment stores its input features and
model version in `risk_assessments`, which doubles as a training/evaluation log.

## Not production-ready yet

No roles yet (every clinician account can do everything); SQLite + `create_all` instead of
Postgres + migrations; no audit log; no HTTPS termination; no consent capture; demo mode
must stay off with real patients. See the spec's *Deferred* and *Privacy* sections.
