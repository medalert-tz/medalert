// ---------- Shapes returned by the MediAlert backend (see app/schemas.py) ----------

export type RiskLevel = 'low' | 'medium' | 'high';

export interface Risk {
  score: number;
  level: RiskLevel;
  factors: string[];
  model_version: string;
  computed_at: string;
}

export interface Device {
  serial: string;
  paired_at: string;
  last_seen_at: string | null;
  battery_pct: number | null;
}

export interface Patient {
  id: number;
  display_name: string;
  phone: string | null;
  condition: string | null;
  facility: string | null;
  self_managed: boolean;
  created_at: string;
  device: Device | null;
  risk: Risk | null;
  open_intervention: boolean;
}

export interface Supply {
  doses_supplied: number;
  doses_taken: number;
  doses_remaining: number;
  days_remaining: number | null;
  refill_due: boolean;
}

export interface Prescription {
  id: number;
  patient_id: number;
  drug_name: string;
  dose_instructions: string | null;
  times: string[]; // "HH:MM", local time
  start_date: string;
  duration_days: number | null; // null = ongoing / chronic
  prescriber: string | null;
  status: 'active' | 'completed' | 'stopped';
  created_at: string;
  doses_total: number | null;
  supply: Supply | null;
}

/** Server statuses. 'pending' = not yet due or still inside its window. */
export type DoseStatus = 'pending' | 'taken' | 'skipped' | 'missed';

export interface Dose {
  id: number;
  prescription_id: number;
  scheduled_at: string; // naive UTC
  status: DoseStatus;
  taken_at: string | null;
  source: string | null;
}

export interface Intervention {
  id: number;
  patient_id: number;
  patient_name: string | null;
  reason: string;
  score: number;
  status: 'open' | 'resolved';
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  note: string | null;
}

export interface Course {
  prescription_id: number;
  label: string;
  day: number;
  days_total: number | null;
  doses_taken: number;
  doses_resolved: number;
  doses_total: number | null;
  complete: boolean;
}

export interface DeviceSync {
  server_time: string;
  alert: 'none' | 'dose' | 'refill';
  next_dose_id: number | null;
  next_dose_at: string | null;
  next_dose_label: string | null;
  snoozed_until: string | null;
  refill_in_days: number | null;
  course: Course | null;
}

/** What the patient can tap on the watch. Maps to DeviceAckIn.action. */
export type WatchAction = 'taken' | 'snooze' | 'skipped' | 'missed';

export interface DeviceAck {
  accepted: boolean;
  dose_id: number | null;
  action: WatchAction | null;
  message: string;
  course: Course | null;
}

export interface MonitorReport {
  slots_created: number;
  doses_marked_missed: number;
  patients_assessed: number;
  interventions_opened: number;
}

export interface DemoStatus {
  enabled: boolean;
  now: string;
  offset_minutes: number;
}

export interface DemoResult {
  now: string;
  offset_minutes: number;
  message: string;
  monitor: MonitorReport | null;
}

// ---------- Accounts and portals ----------

export interface Clinician {
  id: number;
  username: string;
  display_name: string;
}

export interface PatientMe {
  id: number;
  display_name: string;
  facility: string | null;
  self_managed: boolean;
}

/** What the browser remembers about who is logged in. */
export type StoredSession =
  | { kind: 'clinician'; token: string; name: string }
  | { kind: 'patient'; token: string; name: string };

export interface AccessCode {
  access_code: string;
}

export interface PatientProgress {
  patient: Patient;
  active_medicines: string[];
  doses_taken: number;
  doses_missed: number;
  adherence_pct: number | null;
  next_dose_at: string | null;
  refill_due: boolean;
}

export interface ScannedMedicine {
  drug_name: string;
  dose_instructions: string | null;
  times: string[];
  duration_days: number | null;
  confidence: 'high' | 'medium' | 'low';
  note: string | null;
}

export interface ScanResult {
  is_prescription: boolean;
  medicines: ScannedMedicine[];
  warnings: string[];
  model: string;
}

// ---------- UI-only types ----------

export type WatchState =
  | 'idle'
  | 'auto_updated'
  | 'reminder'
  | 'dose_logged'
  | 'progress'
  | 'course_complete'
  | 'advisor';

export type WatchShape = 'round' | 'square';

export type ClinicianTab = 'dashboard' | 'prescribe';

export interface DoseFeedbackMessage {
  title: string;
  message: string;
  badgeColor: string;
  mascotMood: 'happy' | 'cheering' | 'supportive' | 'calm';
}

/** One medicine line in the prescribe form. A patient can get several at once. */
export interface MedicineLine {
  medicationName: string;
  dosage: string;
  times: string[]; // "HH:MM", local time, chosen by the clinician
  ongoing: boolean;
  durationDays: number;
  dosesDispensed: number;
}

/** Everything the "Confirm and Push" form collects. */
export interface PrescribeForm {
  target: 'new' | 'selected';
  patientName: string;
  condition: string;
  facility: string;
  wearableSerial: string;
  startDate: string;
  prescriber: string;
  notes: string;
  medicines: MedicineLine[];
}

// ---------- Voice health advisor ----------
export type AdvisorLang = 'en' | 'sw';

export interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
}
