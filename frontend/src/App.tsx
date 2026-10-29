import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ActiveTab, DemoStatus, DeviceAck, DeviceSync, Dose, Intervention, Patient, PrescribeForm,
  Prescription, WatchAction, WatchShape, WatchState,
} from './types';
import { ApiError, clinicApi, deviceApi, store, tokenKey } from './api';
import { parseUtc } from './utils/schedule';
import { Navbar } from './components/Navbar';
import { ConnectScreen } from './components/ConnectScreen';
import { ClinicianView, type PushReceipt } from './components/ClinicianView';
import { SmartwatchFrame } from './components/SmartwatchFrame';
import { WearableView } from './components/WearableView';
import { DemoControls } from './components/DemoControls';
import { DisclaimerBanner } from './components/DisclaimerBanner';
import { CourseCompleteModal } from './components/CourseCompleteModal';
import { Sparkles, HeartPulse } from 'lucide-react';

const WATCH_POLL_MS = 4000;
const CLINIC_POLL_MS = 10000;

export const App: React.FC = () => {
  // ---------- Connection ----------
  const [apiKey, setApiKey] = useState<string>(() => store.get('medialert.key'));
  const [connected, setConnected] = useState(false);
  const api = useMemo(() => clinicApi(apiKey), [apiKey]);

  // ---------- Clinic data ----------
  const [patients, setPatients] = useState<Patient[]>([]);
  const [interventions, setInterventions] = useState<Intervention[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);
  const [doses, setDoses] = useState<Dose[]>([]);
  const [demo, setDemo] = useState<DemoStatus | null>(null);
  const [lastPush, setLastPush] = useState<PushReceipt | null>(null);
  const [notice, setNotice] = useState<string>('');

  // ---------- Watch ----------
  const [activeTab, setActiveTab] = useState<ActiveTab>('split');
  const [watchShape, setWatchShape] = useState<WatchShape>('round');
  const [watchState, setWatchState] = useState<WatchState>('idle');
  const [sync, setSync] = useState<DeviceSync | null>(null);
  const [syncOk, setSyncOk] = useState(false);
  const [clockOffsetMs, setClockOffsetMs] = useState(0); // server time - browser time
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [tokenVersion, setTokenVersion] = useState(0); // bump when a token is stored
  const completeShown = useRef<Set<number>>(new Set());
  const firstSyncForPatient = useRef(true);
  const showNewRxFor = useRef<number | null>(null); // patient whose watch should show "new prescription"

  const selected = patients.find((p) => p.id === selectedId) ?? null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const deviceToken = useMemo(() => (selectedId ? store.get(tokenKey(selectedId)) : ''), [selectedId, tokenVersion]);
  const firstName = selected ? selected.display_name.split(' ')[0] : 'there';

  const fail = useCallback((e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    if (e instanceof ApiError && e.status === 401 && msg.includes('API key')) {
      setConnected(false);
    }
    setNotice(msg);
  }, []);

  // ---------- Loading ----------
  const refreshClinic = useCallback(async () => {
    const [ps, ivs] = await Promise.all([api.listPatients(), api.listInterventions()]);
    setPatients(ps);
    setInterventions(ivs);
    if (selectedId) {
      const [rxs, ds] = await Promise.all([api.listPrescriptions(selectedId), api.listDoses(selectedId)]);
      setPrescriptions(rxs);
      setDoses(ds);
    }
  }, [api, selectedId]);

  const applySync = useCallback((s: DeviceSync) => {
    setSync(s);
    setSyncOk(true);
    setClockOffsetMs(parseUtc(s.server_time).getTime() - Date.now());
    const c = s.course;
    if (c?.complete && !completeShown.current.has(c.prescription_id)) {
      completeShown.current.add(c.prescription_id);
      setWatchState('course_complete');
      // Celebrate only when it happens live, not when opening an old finished course.
      if (!firstSyncForPatient.current) setShowCompleteModal(true);
    } else {
      setWatchState((prev) => {
        if (s.alert === 'dose' && (prev === 'idle' || prev === 'progress')) return 'reminder';
        if (prev === 'reminder' && s.alert !== 'dose') return 'idle';
        return prev;
      });
    }
    firstSyncForPatient.current = false;
  }, []);

  const refreshWatch = useCallback(async () => {
    if (!deviceToken) { setSync(null); setSyncOk(false); return null; }
    try {
      const s = await deviceApi(deviceToken).sync();
      applySync(s);
      return s;
    } catch (e) {
      setSyncOk(false);
      if (e instanceof ApiError && e.status === 401) {
        setNotice('This watch token is no longer valid (the watch was re-paired elsewhere). Pair it again.');
      }
      return null;
    }
  }, [deviceToken, applySync]);

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshClinic(), refreshWatch()]);
  }, [refreshClinic, refreshWatch]);

  // Connect
  const connect = useCallback(async (key: string) => {
    const a = clinicApi(key);
    await a.listPatients(); // throws if the key is wrong
    store.set('medialert.key', key);
    setApiKey(key);
    setConnected(true);
    a.demoStatus().then((d) => { setDemo(d); }).catch(() => setDemo(null));
  }, []);

  useEffect(() => {
    if (apiKey && !connected) connect(apiKey).catch(() => { /* show connect screen */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pick a patient automatically after connecting (highest risk first).
  useEffect(() => {
    if (connected && selectedId === null && patients.length) setSelectedId(patients[0].id);
  }, [connected, patients, selectedId]);

  useEffect(() => {
    // New patient on the watch: start from the watch face (or the "new prescription"
    // screen if we just pushed one to them).
    firstSyncForPatient.current = true;
    setWatchState(showNewRxFor.current === selectedId ? 'auto_updated' : 'idle');
    showNewRxFor.current = null;
    setSync(null);
  }, [selectedId]);

  // Polling: watch every few seconds (as a real device would), clinic data less often.
  useEffect(() => {
    if (!connected) return;
    refreshClinic().catch(fail);
    const t = setInterval(() => refreshClinic().catch(() => {}), CLINIC_POLL_MS);
    return () => clearInterval(t);
  }, [connected, refreshClinic, fail]);

  useEffect(() => {
    if (!connected) return;
    refreshWatch();
    const t = setInterval(() => { refreshWatch(); }, WATCH_POLL_MS);
    return () => clearInterval(t);
  }, [connected, refreshWatch]);

  // ---------- Clinician actions ----------
  const pairWatch = useCallback(async (patientId: number, serial: string) => {
    const r = await api.pairDevice(patientId, serial);
    store.set(tokenKey(patientId), r.device_token);
    setTokenVersion((v) => v + 1);
    return r;
  }, [api]);

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
    const needsPairing = !store.get(tokenKey(patient.id)) || patient.device?.serial !== f.wearableSerial.trim();
    if (needsPairing) await pairWatch(patient.id, f.wearableSerial.trim());

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

    setLastPush({
      patientName: patient.display_name,
      serial: f.wearableSerial.trim(),
      prescriptions: saved,
      at: new Date(),
      paired: needsPairing,
    });
    setNotice('');
    if (patient.id === selectedId) {
      setWatchState('auto_updated');
    } else {
      showNewRxFor.current = patient.id;
      setSelectedId(patient.id);
    }
    await refreshClinic();
  }, [api, selected, selectedId, pairWatch, refreshClinic]);

  const handleResolve = useCallback(async (id: number, by: string, note: string) => {
    await api.resolveIntervention(id, by, note);
    await refreshClinic();
  }, [api, refreshClinic]);

  const handleDispense = useCallback(async (rxId: number, n: number) => {
    await api.dispense(rxId, n);
    await refreshAll();
  }, [api, refreshAll]);

  const handleRunMonitor = useCallback(async () => {
    const r = await api.runMonitor();
    setNotice(`Checked ${r.patients_assessed} patient(s): ${r.doses_marked_missed} newly missed dose(s), ${r.interventions_opened} new alert(s).`);
    await refreshAll();
  }, [api, refreshAll]);

  // ---------- Watch actions ----------
  const handleWatchAction = useCallback(async (action: WatchAction): Promise<DeviceAck | null> => {
    if (!deviceToken) return null;
    try {
      const ack = await deviceApi(deviceToken).ack(action);
      if (ack.accepted && ack.course?.complete && !completeShown.current.has(ack.course.prescription_id)) {
        completeShown.current.add(ack.course.prescription_id);
        setWatchState('course_complete');
        setShowCompleteModal(true);
      }
      refreshAll().catch(() => {});
      return ack;
    } catch (e) {
      fail(e);
      return null;
    }
  }, [deviceToken, refreshAll, fail]);

  // ---------- Demo time controls ----------
  const demoRun = useCallback(async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      const d = await api.demoStatus();
      setDemo(d);
      await refreshAll();
    } catch (e) { fail(e); }
  }, [api, refreshAll, fail]);

  const demoHandlers = {
    onTriggerNextReminder: () => selectedId && demoRun(async () => {
      const r = await api.demoNextDose(selectedId);
      setNotice(r.message);
    }),
    onAdvanceOneDose: () => selectedId && demoRun(async () => {
      await api.demoNextDose(selectedId);
      const ack = await handleWatchAction('taken');
      if (ack?.accepted && !ack.course?.complete) setWatchState('progress');
      setNotice(ack?.accepted ? 'Clock moved to the next dose; the watch recorded it as taken.' : 'No dose to take.');
    }),
    onSkipDay: () => demoRun(async () => {
      const r = await api.demoAdvance(24 * 60);
      setNotice(`A day passed with no button presses. Across all patients: ${r.monitor?.doses_marked_missed ?? 0} dose(s) missed, ${r.monitor?.interventions_opened ?? 0} new nurse alert(s).`);
    }),
    onCompleteCourse: () => selectedId && demoRun(async () => {
      const r = await api.demoCompleteCourse(selectedId);
      firstSyncForPatient.current = false;
      setNotice(r.message);
    }),
    onResetDemo: () => {
      if (!window.confirm('Delete ALL demo data and return the clock to real time?')) return;
      demoRun(async () => {
        await api.demoReset();
        store.clearTokens();
        completeShown.current.clear();
        setSelectedId(null);
        setPrescriptions([]); setDoses([]); setLastPush(null);
        setTokenVersion((v) => v + 1);
        setNotice('Demo data cleared.');
      });
    },
  };

  if (!connected) {
    return <ConnectScreen initialKey={apiKey} onConnect={connect} />;
  }

  const selectedRxIsOngoing = (() => {
    const rx = prescriptions.find((r) => r.id === sync?.course?.prescription_id) ?? prescriptions.find((r) => r.status === 'active');
    return rx ? rx.duration_days === null : true;
  })();

  const watch = (
    <SmartwatchFrame
      shape={watchShape}
      setShape={setWatchShape}
      wearableSerial={selected?.device?.serial ?? '—'}
      synced={syncOk}
      battery={selected?.device?.battery_pct ?? null}
    >
      <WearableView
        patient={selected}
        firstName={firstName}
        hasToken={!!deviceToken}
        sync={sync}
        clockOffsetMs={clockOffsetMs}
        watchState={watchState}
        setWatchState={setWatchState}
        onAction={handleWatchAction}
        onPair={(serial) => selected && pairWatch(selected.id, serial).then(() => refreshAll()).catch(fail)}
        onTriggerNextReminder={demo?.enabled ? demoHandlers.onTriggerNextReminder : undefined}
      />
    </SmartwatchFrame>
  );

  const clinician = (
    <ClinicianView
      patients={patients}
      selected={selected}
      onSelect={setSelectedId}
      prescriptions={prescriptions}
      doses={doses}
      interventions={interventions}
      lastPush={lastPush}
      onPush={handlePush}
      onResolve={handleResolve}
      onDispense={handleDispense}
      onRunMonitor={handleRunMonitor}
    />
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between font-sans selection:bg-cyan-500 selection:text-white">
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        synced={syncOk}
        wearableSerial={selected?.device?.serial ?? null}
        facility={selected?.facility ?? null}
      />

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6">
        <div className="bg-gradient-to-r from-slate-900 via-slate-900 to-slate-950 border border-slate-800 rounded-2xl p-4 sm:p-5 mb-6 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-start space-x-3">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 flex-shrink-0 mt-0.5">
              <HeartPulse className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h1 className="text-base sm:text-lg font-bold text-slate-100 font-heading flex items-center gap-2 flex-wrap">
                MEDIALERT Adherence System
                <span className="text-xs bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 px-2 py-0.5 rounded-full font-normal">
                  Live backend · Simulated wearable
                </span>
              </h1>
              <p className="text-xs text-slate-400 mt-0.5 max-w-3xl">
                Prescribe → Dispense → Monitor → Predict → Intervene. The clinician confirms a prescription, the wearable
                syncs its schedule, every button press is recorded, and patients at risk of missing doses go to the nurse queue.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs font-mono text-cyan-300 bg-cyan-950/60 border border-cyan-500/30 px-3 py-1.5 rounded-xl self-stretch md:self-auto justify-center">
            <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
            <span>Clinic → Wearable Sync</span>
          </div>
        </div>

        <p role="status" aria-live="polite" className={`text-xs mb-4 min-h-[1rem] ${notice ? 'text-cyan-300' : ''}`}>{notice}</p>

        {activeTab === 'split' && (
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start">
            <div className="xl:col-span-7">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-cyan-400" />
                  View 1: Hospital / Clinician Workstation
                </h2>
              </div>
              {clinician}
            </div>
            <div className="xl:col-span-5 flex flex-col items-center xl:sticky xl:top-20">
              <div className="w-full mb-3 flex items-center justify-between px-2">
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  View 2: Patient Wearable
                </h2>
                <span className="text-[11px] text-cyan-400 font-mono">Simulated Device</span>
              </div>
              <div className="bg-slate-900/60 border border-slate-800 rounded-3xl p-4 sm:p-6 w-full flex flex-col items-center shadow-xl overflow-hidden">
                {watch}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'clinician' && <div className="max-w-5xl mx-auto">{clinician}</div>}

        {activeTab === 'wearable' && (
          <div className="max-w-xl mx-auto flex flex-col items-center py-4">
            <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-4 sm:p-8 w-full flex flex-col items-center shadow-2xl overflow-hidden">
              {watch}
            </div>
          </div>
        )}
      </main>

      <DemoControls
        demo={demo}
        hasPatient={!!selected && !!deviceToken}
        isOngoing={selectedRxIsOngoing}
        watchShape={watchShape}
        setWatchShape={setWatchShape}
        {...demoHandlers}
      />

      {showCompleteModal && sync?.course && (
        <CourseCompleteModal
          firstName={firstName}
          course={sync.course}
          onClose={() => setShowCompleteModal(false)}
        />
      )}

      <DisclaimerBanner />
    </div>
  );
};
