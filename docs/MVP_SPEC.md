# MediAlert — Project Understanding & MVP Spec

Source of truth: `MEDALERT.pptx` (9 slides). Only slide text was readable; slides 5
(Business Model) and 6 (Competition) contain no extractable text (likely images), so
nothing in this spec is derived from them.

Legend: **[P]** = stated in the presentation · **[I]** = inferred / assumption.

---

## 1. Understanding the project

### Problem [P]
Patients don't take what they're prescribed ("Prescribed ≠ Taken"), skip doses, and stop
treatment early ("Missed ≠ Harmless"). Chronic illness requires long-term adherence.
"Non-adherence is the gap."

### Intended users
| User | Source | Role in the system |
|---|---|---|
| Patients | [P] | Wear a low-cost device; get reminders. **No smartphone required.** System is **free for patients**. |
| Clinicians / hospitals | [P] | Prescribe and consume the "hospital/Clinician API". |
| Nurses / care workers | [P] | Intervene early for high-risk patients. |
| Pharmacy / dispensing staff | [I] | "Dispense" is a pipeline step; someone records it. |
| Insurers, NGOs, pharma partners | [P] | Paying customers for adherence data / outcomes. Not users of the MVP. |

### Core value [P]
Keep patients on their full course by combining a cheap wearable reminder with AI-based
risk detection, so scarce nurse time goes only to patients likely to miss doses.

### Main workflow [P]
**Prescribe → Dispense → Monitor → Predict → Intervene**
1. Clinician prescribes. 2. Medication dispensed. 3. Wearable tracks medication use.
4. AI model detects adherence patterns / at-risk patients. 5. Most patients get normal
reminders; high-risk patients trigger a nurse/care-worker intervention.

### Functional requirements
Explicit [P]:
- F1 Wearable reminds patient and **tracks medication use** — without a smartphone.
- F2 Hospital/clinician **API** (integration surface for facilities).
- F3 Prescription and dispensing are captured as pipeline stages.
- F4 AI model scores **risk of missing doses** from adherence patterns.
- F5 Routing: normal reminders for most; **early intervention** for high-risk.
- F6 Adherence data usable by insurers/NGOs/pharma (aggregate reporting).
- Roadmap: data pipeline (Q1) → model validation (Q2) → pilot (Q3) → first partner (Q4).

Inferred [I]:
- F7 Refill reminders when supply runs low (from earlier project notes, not the deck).
- F8 Nurse needs to see *why* a patient was flagged and record the outcome.
- F9 Device pairing/identity per patient.

### Non-functional requirements
- Low-cost hardware, no smartphone [P] → device protocol must be tiny, tolerant of
  intermittent connectivity, and not assume a screen or app [I].
- Free for patients [P] → no patient-side payments in software.
- Health data → confidentiality, auditability, data minimisation [I].
- Tanzania-first deployment [P: SAM] → `Africa/Dar_es_Salaam` timezone, Swahili UI later [I].

### Contradictions & gaps
1. **Antibiotic course vs chronic illness.** Slide 1 says "full antibiotic course"; slides
   2 and 4 target chronic illness (SAM = hypertension). Earlier notes mention cancer and
   asthma. *MVP supports both*: fixed-duration courses and open-ended chronic regimens.
2. **Leftover template text.** Slide 1 says "AI-Powered Language Learning App" — clearly a
   template remnant; should be removed from the deck.
3. **Name spelling.** "MEDIALERT" vs "MEDALERT" used interchangeably.
4. **Roadmap ordering.** Data pipeline and model validation (Q1–Q2) precede the pilot
   (Q3) — but the model needs pilot data. Plan: pretrain/validate on external datasets,
   ship a transparent baseline scorer first (this MVP does that).
5. **"Tracks medication use" is undefined.** A wristband can't see a pill being swallowed.
   *Assumption:* patient presses a button to confirm ("self-report"). A smart pill-box
   sensor could replace this later.
6. **Missing details:** device connectivity (GSM/SMS? LoRa? BLE→gateway?), who records
   dispensing, how nurses are reached, consent model, data-sharing terms for partners,
   which EMR/HIS systems to integrate (e.g., DHIS2, OpenMRS, GoT-HoMIS).
7. **Market sizing.** TAM ($5.2B) and SOM ($200K) are not directly comparable to SAM
   ($4.3M, per-patient pricing) vs SOM (per-institution pricing) — two different pricing
   models. Worth reconciling for the pitch; doesn't block software.

---

## 2. MVP (first buildable version)

**Goal:** one end-to-end loop that a pilot clinic could run: clinician sets up a patient
and regimen → device reminds and records confirmations → system flags at-risk patients →
nurse works a queue.

### In scope
- Patient registration (minimal fields), device pairing with one-time device token.
- Prescriptions: drug, dose instructions, daily times, start date, optional duration
  (course) or open-ended (chronic).
- Dispensing records → refill-due estimate.
- Dose schedule generation (local-time slots stored in UTC).
- Device protocol: `sync` (what's due next, refill alert) and `ack` (button press).
- Monitor job: unconfirmed doses past a grace window → missed.
- Risk scoring v0: transparent, rule-weighted logistic score with explanations, behind a
  pluggable `RiskModel` interface so a trained model can drop in.
- Intervention queue: auto-opened for high risk; nurse resolves with a note.
- Clinician web dashboard + a device simulator panel (stands in for hardware).
- Automated tests.

### Deferred
- Real firmware and radio transport (GSM/SMS/LoRa), OTA updates.
- Trained ML model (needs external datasets + pilot data; Q1–Q2 roadmap).
- SMS/voice/USSD outreach to nurses or patients; Swahili localisation.
- EMR/HIS integrations (FHIR, OpenMRS, DHIS2), pharmacy systems.
- Partner analytics & data export (insurers/NGOs/pharma) — needs consent + de-identification design.
- Multi-tenant facilities, per-user accounts/roles, audit log UI.

### Architecture
```
 [Wearable] --(sync/ack, device token)--> ┐
                                          │  FastAPI app
 [Clinician dashboard] --(API key)------> ├─ clinician API (/api/v1)
 [Hospital systems] ----(API key)-------> │  device API (/api/device/v1)
                                          ├─ services: schedule · adherence · risk · interventions
                                          ├─ background monitor loop (missed doses → risk → queue)
                                          └─ SQLAlchemy → SQLite (dev) / PostgreSQL (prod)
```
- **Python + FastAPI**: matches the team's Python/ML skills, auto-generates OpenAPI docs for
  the "clinician API", and keeps the ML model in the same language.
- **SQLAlchemy + SQLite** for dev; switch to PostgreSQL via `DATABASE_URL` for pilot.
- **Static HTML/JS dashboard** served by the backend: no build step, easy to replace with
  React later.
- **Monitor** runs in-process on an interval for the MVP; move to a scheduler/worker in prod.

### Data model
| Table | Key fields |
|---|---|
| `patients` | display_name, phone?, condition, facility |
| `devices` | patient_id (1:1), serial, token_hash, last_seen_at, battery_pct |
| `prescriptions` | patient_id, drug_name, dose_instructions, times (HH:MM list), start_date, duration_days?, prescriber, status |
| `dispensations` | prescription_id, doses_supplied, dispensed_at |
| `dose_events` | prescription_id, scheduled_at (UTC), status pending/taken/missed, taken_at, source |
| `risk_assessments` | patient_id, score, level, factors (JSON), model_version |
| `interventions` | patient_id, reason, score, status open/resolved, note, resolved_by |

### Privacy, security, accessibility, deployment
- **Secrets:** clinician API key comes from `MEDALERT_API_KEY` env var; never in code.
  Device tokens are random, shown once, stored as SHA-256 hashes.
- **Data minimisation:** device API returns no names or diagnoses — only drug label and
  times. Patient phone is optional.
- **Health data law:** Tanzania's Personal Data Protection Act (2022) — needs registration
  with the data-protection commission, consent capture, and a lawful basis before the pilot.
  Partner data sharing must be aggregated/de-identified and consented.
- **Security to-do before pilot:** per-user auth & roles (clinician/nurse/admin), HTTPS only,
  audit log, rate limiting on device endpoints, PostgreSQL with encrypted backups.
- **Accessibility:** device must work for low-literacy and visually impaired users
  (vibration + sound + single button). Dashboard uses semantic HTML, labelled forms,
  text (not only colour) for risk levels, keyboard navigation, live-region updates.
- **Deployment:** single container + managed Postgres; device traffic likely via SMS/GSM
  gateway in rural areas — protocol kept tiny for that reason.
