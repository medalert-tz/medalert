// Thin client for the MediAlert backend.
// Clinicians and patients log in and get a session token (sent as "Authorization: Bearer ...").
import type {
  AccessCode, AdvisorLang, ChatMsg, Clinician, DemoResult, DemoStatus, DeviceAck, DeviceSync, Dose, Intervention, MonitorReport,
  Patient, PatientMe, PatientProgress, Prescription, ScanResult, StoredSession, WatchAction,
} from './types';

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const res = await fetch(path, {
    ...rest,
    headers: { 'Content-Type': 'application/json', ...(headers || {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const d = data?.detail;
    const msg = Array.isArray(d) ? d.map((x: { msg: string }) => x.msg).join('; ') : d;
    throw new ApiError(msg || `Request failed (${res.status})`, res.status);
  }
  return data as T;
}

function authed(token: string) {
  const h = { Authorization: `Bearer ${token}` };
  return {
    get: <T,>(p: string) => request<T>(p, { headers: h }),
    post: <T,>(p: string, json?: unknown) => request<T>(p, { method: 'POST', headers: h, json: json ?? {} }),
  };
}

// ---------- Remembering who is logged in (storage can throw in private modes) ----------
const SESSION_KEY = 'medialert.session';
export const sessionStore = {
  get(): StoredSession | null {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      return raw ? (JSON.parse(raw) as StoredSession) : null;
    } catch { return null; }
  },
  set(s: StoredSession) {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch { /* unavailable */ }
  },
  clear() {
    try { localStorage.removeItem(SESSION_KEY); } catch { /* unavailable */ }
  },
};

// ---------- Logging in ----------
export const authApi = {
  status: () => request<{ needs_setup: boolean }>('/api/v1/auth/status'),
  setup: (body: { username: string; display_name: string; password: string }) =>
    request<{ token: string; clinician: Clinician }>('/api/v1/auth/setup', { method: 'POST', json: body }),
  login: (username: string, password: string) =>
    request<{ token: string; clinician: Clinician }>('/api/v1/auth/login', { method: 'POST', json: { username, password } }),
  patientLogin: (code: string) =>
    request<{ token: string; patient: PatientMe }>('/api/patient/v1/login', { method: 'POST', json: { code } }),
  patientRegister: (display_name: string) =>
    request<{ token: string; patient: PatientMe; access_code: string }>('/api/patient/v1/register', { method: 'POST', json: { display_name } }),
};

// ---------- Clinician portal ----------
export function clinicApi(token: string) {
  const { get, post } = authed(token);
  return {
    me: () => get<Clinician>('/api/v1/auth/me'),
    logout: () => post<void>('/api/v1/auth/logout'),
    addClinician: (body: { username: string; display_name: string; password: string }) =>
      post<Clinician>('/api/v1/auth/clinicians', body),

    dashboard: () => get<PatientProgress[]>('/api/v1/dashboard'),
    listPatients: () => get<Patient[]>('/api/v1/patients'),
    createPatient: (body: { display_name: string; condition?: string; facility?: string }) =>
      post<Patient>('/api/v1/patients', body),
    pairDevice: (patientId: number, serial: string) =>
      post<{ serial: string; device_token: string; access_code: string }>(`/api/v1/patients/${patientId}/device`, { serial }),
    newAccessCode: (patientId: number) => post<AccessCode>(`/api/v1/patients/${patientId}/access-code`),
    listPrescriptions: (patientId: number) => get<Prescription[]>(`/api/v1/patients/${patientId}/prescriptions`),
    prescribe: (patientId: number, body: NewPrescription) =>
      post<Prescription>(`/api/v1/patients/${patientId}/prescriptions`, body),
    dispense: (rxId: number, doses: number) => post<Prescription>(`/api/v1/prescriptions/${rxId}/dispense`, { doses_supplied: doses }),
    stopPrescription: (rxId: number) => post<Prescription>(`/api/v1/prescriptions/${rxId}/stop`),
    listDoses: (patientId: number, days = 14) => get<Dose[]>(`/api/v1/patients/${patientId}/doses?days=${days}`),
    listInterventions: () => get<Intervention[]>('/api/v1/interventions?status=open'),
    resolveIntervention: (id: number, resolved_by: string, note: string) =>
      post<Intervention>(`/api/v1/interventions/${id}/resolve`, { resolved_by, note }),
    runMonitor: () => post<MonitorReport>('/api/v1/monitor/run'),

    demoStatus: () => get<DemoStatus>('/api/demo/status'),
    demoNextDose: (patient_id: number) => post<DemoResult>('/api/demo/next-dose', { patient_id }),
    demoAdvance: (minutes: number) => post<DemoResult>('/api/demo/advance', { minutes }),
    demoCompleteCourse: (patient_id: number) => post<DemoResult>('/api/demo/complete-course', { patient_id }),
    demoReset: () => post<DemoResult>('/api/demo/reset'),
  };
}
export type ClinicApi = ReturnType<typeof clinicApi>;

export interface NewPrescription {
  drug_name: string;
  dose_instructions?: string;
  times: string[];
  start_date: string;
  duration_days: number | null;
  prescriber?: string;
}

// ---------- Patient portal (also drives the watch view) ----------
export function patientApi(token: string) {
  const { get, post } = authed(token);
  return {
    me: () => get<PatientMe>('/api/patient/v1/me'),
    logout: () => post<void>('/api/patient/v1/logout'),
    prescriptions: () => get<Prescription[]>('/api/patient/v1/prescriptions'),
    doses: (days = 7) => get<Dose[]>(`/api/patient/v1/doses?days=${days}`),
    addPrescription: (body: NewPrescription) => post<Prescription>('/api/patient/v1/prescriptions', body),
    stopPrescription: (rxId: number) => post<Prescription>(`/api/patient/v1/prescriptions/${rxId}/stop`),
    scan: (image_base64: string, media_type: string) => post<ScanResult>('/api/patient/v1/scan', { image_base64, media_type }),
    sync: () => post<DeviceSync>('/api/device/v1/sync'),
    ack: (action: WatchAction) => post<DeviceAck>('/api/device/v1/ack', { action }),
    askAdvisor: (messages: ChatMsg[], lang: AdvisorLang) =>
      post<{ reply: string }>('/api/patient/v1/advisor', { messages, lang }),
  };
}
export type PatientApi = ReturnType<typeof patientApi>;
