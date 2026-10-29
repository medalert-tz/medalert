import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { LayoutDashboard, Pill } from 'lucide-react';
import { ApiError, clinicApi } from '../api';
import type {
  ClinicianTab, DemoStatus, Dose, Intervention, Patient, PatientProgress, PrescribeForm, Prescription,
} from '../types';
import { PortalHeader } from './PortalHeader';
import { ClinicianView, type PushReceipt } from './ClinicianView';
import { ProgressDashboard } from './ProgressDashboard';
import { DemoControls } from './DemoControls';
import { DisclaimerBanner } from './DisclaimerBanner';

const POLL_MS = 10000;

interface Props {
  token: string;
  name: string;
  onLogout: () => void;
}

export const ClinicianPortal: React.FC<Props> = ({ token, name, onLogout }) => {
  const api = useMemo(() => clinicApi(token), [token]);
  const [tab, setTab] = useState<ClinicianTab>('dashboard');
  const [rows, setRows] = useState<PatientProgress[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [interventions, setInterventions] = useState<Intervention[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);
  const [doses, setDoses] = useState<Dose[]>([]);
  const [demo, setDemo] = useState<DemoStatus | null>(null);
  const [lastPush, setLastPush] = useState<PushReceipt | null>(null);
  const [notice, setNotice] = useState('');

  const selected = patients.find((p) => p.id === selectedId) ?? null;

  const fail = useCallback((e: unknown) => {
    if (e instanceof ApiError && e.status === 401) { onLogout(); return; }
    setNotice(e instanceof Error ? e.message : String(e));
  }, [onLogout]);

  const refresh = useCallback(async () => {
    const [dash, ps, ivs] = await Promise.all([api.dashboard(), api.listPatients(), api.listInterventions()]);
    setRows(dash);
    setPatients(ps);
    setInterventions(ivs);
    if (selectedId) {
      const [rxs, ds] = await Promise.all([api.listPrescriptions(selectedId), api.listDoses(selectedId)]);
      setPrescriptions(rxs);
      setDoses(ds);
    } else {
      setPrescriptions([]);
      setDoses([]);
    }
  }, [api, selectedId]);

  useEffect(() => {
    refresh().catch(fail);
    const t = setInterval(() => refresh().catch(() => {}), POLL_MS);
    return () => clearInterval(t);
  }, [refresh, fail]);

  useEffect(() => {
    api.demoStatus().then(setDemo).catch(() => setDemo(null));
  }, [api]);

  const openPatient = (id: number) => {
    setSelectedId(id);
    setTab('prescribe');
  };

  // ---------- Actions ----------
  const handlePush = useCallback(async (f: PrescribeForm) => {
    let patient: Patient;
    if (f.target === 'selected' && selected) {
      patient = selected;
    } else {
      patient = await api.createPatient({
        display_name: f.patientName.trim(),
        condition: f.condition.trim() || undefined,
        facility: f.facility.trim() || undefined,
      });
    }
    const serial = f.wearableSerial.trim();
    const needsPairing = !patient.device || patient.device.serial !== serial;
    const accessCode = needsPairing ? (await api.pairDevice(patient.id, serial)).access_code : null;

    // One prescription per medicine line, each with its own times and dispensed doses.
    const saved: Prescription[] = [];
    for (const m of f.medicines) {
      const instructions = [m.dosage.trim(), f.notes.trim()].filter(Boolean).join('. ').slice(0, 200);
      const rx = await api.prescribe(patient.id, {
        drug_name: m.medicationName.trim(),
        dose_instructions: instructions || undefined,
        times: m.times,
        start_date: f.startDate,
        duration_days: m.ongoing ? null : m.durationDays,
        prescriber: f.prescriber.trim() || undefined,
      });
      saved.push(m.dosesDispensed > 0 ? await api.dispense(rx.id, m.dosesDispensed) : rx);
    }

    setLastPush({ patientName: patient.display_name, serial, prescriptions: saved, at: new Date(), paired: needsPairing, accessCode });
    setNotice('');
    setSelectedId(patient.id);
    await refresh();
  }, [api, selected, refresh]);

  const run = (fn: () => Promise<unknown>) => async () => {
    try { await fn(); await refresh(); } catch (e) { fail(e); }
  };

  const demoRun = (fn: () => Promise<void>) => run(async () => {
    await fn();
    setDemo(await api.demoStatus());
  })();

  const demoHandlers = {
    onTriggerNextReminder: () => { if (selectedId) demoRun(async () => setNotice((await api.demoNextDose(selectedId)).message + ' The patient\'s watch will buzz on its next sync.')); },
    onSkipDay: () => demoRun(async () => {
      const r = await api.demoAdvance(24 * 60);
      setNotice(`A day passed with no button presses: ${r.monitor?.doses_marked_missed ?? 0} dose(s) missed, ${r.monitor?.interventions_opened ?? 0} new nurse alert(s).`);
    }),
    onCompleteCourse: () => { if (selectedId) demoRun(async () => setNotice((await api.demoCompleteCourse(selectedId)).message)); },
    onResetDemo: () => {
      if (!window.confirm('Delete ALL patient data and return the clock to real time? Clinician accounts are kept.')) return;
      demoRun(async () => {
        await api.demoReset();
        setSelectedId(null);
        setLastPush(null);
        setNotice('Demo data cleared.');
      });
    },
  };

  const selectedIsOngoing = (() => {
    const rx = prescriptions.find((r) => r.status === 'active');
    return rx ? rx.duration_days === null : true;
  })();

  const logout = () => {
    api.logout().catch(() => {});
    onLogout();
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      <PortalHeader<ClinicianTab>
        portal="Clinician portal"
        userName={name}
        tabs={[
          { id: 'dashboard', label: 'Dashboard', Icon: LayoutDashboard },
          { id: 'prescribe', label: 'Prescribe & patients', Icon: Pill },
        ]}
        activeTab={tab}
        onTab={setTab}
        onLogout={logout}
      />

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6">
        <p role="status" aria-live="polite" className={`text-xs mb-4 min-h-[1rem] ${notice ? 'text-cyan-300' : ''}`}>{notice}</p>

        {tab === 'dashboard' && <ProgressDashboard rows={rows} onOpen={openPatient} />}

        {tab === 'prescribe' && (
          <div className="max-w-6xl mx-auto">
            <ClinicianView
              patients={patients}
              selected={selected}
              onSelect={setSelectedId}
              prescriptions={prescriptions}
              doses={doses}
              interventions={interventions}
              lastPush={lastPush}
              onPush={handlePush}
              onResolve={async (id, by, note) => { await api.resolveIntervention(id, by, note); await refresh(); }}
              onDispense={async (rxId, n) => { await api.dispense(rxId, n); await refresh(); }}
              onRunMonitor={async () => {
                const r = await api.runMonitor();
                setNotice(`Checked ${r.patients_assessed} patient(s): ${r.doses_marked_missed} newly missed dose(s), ${r.interventions_opened} new alert(s).`);
                await refresh();
              }}
              onNewCode={async (id) => (await api.newAccessCode(id)).access_code}
              onStop={async (rxId) => { await api.stopPrescription(rxId); await refresh(); }}
            />
          </div>
        )}
      </main>

      {demo?.enabled && (
        <DemoControls
          demo={demo}
          hasPatient={!!selected}
          isOngoing={selectedIsOngoing}
          {...demoHandlers}
        />
      )}

      <DisclaimerBanner />
    </div>
  );
};
