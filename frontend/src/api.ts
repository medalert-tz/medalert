// Thin client for the MediAlert backend. Clinician calls use the clinic API key;
// watch calls use the per-device token issued at pairing (never the API key).
import type {
  DemoResult,
  DemoStatus,
  DeviceAck,
  DeviceSync,
  Dose,
  Intervention,
  MonitorReport,
  Patient,
  Prescription,
  WatchAction,
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
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const d = data?.detail;
    const msg = Array.isArray(d) ? d.map((x: { msg: string }) => x.msg).join('; ') : d;
    throw new ApiError(msg || `Request failed (${res.status})`, res.status);
  }
  return data as T;
}

// ---------- Small storage helpers (sessionStorage can throw in private modes) ----------
export const store = {
  get(k: string): string {
    try { return sessionStorage.getItem(k) || ''; } catch { return ''; }
  },
  set(k: string, v: string) {
    try { sessionStorage.setItem(k, v); } catch { /* unavailable */ }
  },
  clearTokens() {
    try {
      Object.keys(sessionStorage).filter((k) => k.startsWith('medialert.tok.')).forEach((k) => sessionStorage.removeItem(k));
    } catch { /* unavailable */ }
  },
};
export const tokenKey = (patientId: number) => `medialert.tok.${patientId}`;

// ---------- Clinician / hospital API ----------
export function clinicApi(key: string) {
  const h = { 'X-API-Key': key };
  const get = <T,>(p: string) => request<T>(p, { headers: h });
  const post = <T,>(p: string, json?: unknown) => request<T>(p, { method: 'POST', headers: h, json: json ?? {} });

  return {
    listPatients: () => get<Patient[]>('/api/v1/patients'),
    createPatient: (body: { display_name: string; condition?: string; facility?: string }) =>
      post<Patient>('/api/v1/patients', body),
    pairDevice: (patientId: number, serial: string) =>
      post<{ serial: string; device_token: string }>(`/api/v1/patients/${patientId}/device`, { serial }),
    listPrescriptions: (patientId: number) => get<Prescription[]>(`/api/v1/patients/${patientId}/prescriptions`),
    prescribe: (patientId: number, body: {
      drug_name: string; dose_instructions?: string; times: string[]; start_date: string;
      duration_days: number | null; prescriber?: string;
    }) => post<Prescription>(`/api/v1/patients/${patientId}/prescriptions`, body),
    dispense: (rxId: number, doses: number) => post<Prescription>(`/api/v1/prescriptions/${rxId}/dispense`, { doses_supplied: doses }),
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

// ---------- Wearable protocol ----------
export function deviceApi(token: string) {
  const h = { 'X-Device-Token': token };
  return {
    sync: () => request<DeviceSync>('/api/device/v1/sync', { method: 'POST', headers: h, json: {} }),
    ack: (action: WatchAction) => request<DeviceAck>('/api/device/v1/ack', { method: 'POST', headers: h, json: { action } }),
  };
}
