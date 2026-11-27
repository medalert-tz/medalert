import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KeyRound, Pill, Plus, CalendarClock } from 'lucide-react';
import { ApiError, patientApi } from '../api';
import type { AdvisorLang, ChatMsg, DeviceSync, Dose, PatientMe, Prescription, WatchAction, WatchShape, WatchState } from '../types';
import { fmtDay, fmtTime, hhmmTo12, parseUtc } from '../utils/schedule';
import { PortalHeader } from './PortalHeader';
import { SmartwatchFrame } from './SmartwatchFrame';
import { WearableView } from './WearableView';
import { CourseCompleteModal } from './CourseCompleteModal';
import { AddMedicines } from './AddMedicines';
import { DisclaimerBanner } from './DisclaimerBanner';

const WATCH_POLL_MS = 4000;
const LIST_POLL_MS = 15000;

interface Props {
  token: string;
  name: string;
  /** Just registered: show the code once so they can log in elsewhere. */
  newCode: string | null;
  onLogout: () => void;
}

const statusPill: Record<string, string> = {
  taken: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  skipped: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  missed: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
  pending: 'bg-slate-800 text-slate-400 border-slate-700',
};

export const PatientPortal: React.FC<Props> = ({ token, name, newCode, onLogout }) => {
  const api = useMemo(() => patientApi(token), [token]);
  const [me, setMe] = useState<PatientMe | null>(null);
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);
  const [doses, setDoses] = useState<Dose[]>([]);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState('');

  // ---------- Watch ----------
  const [watchShape, setWatchShape] = useState<WatchShape>('round');
  const [watchState, setWatchState] = useState<WatchState>('idle');
  const [sync, setSync] = useState<DeviceSync | null>(null);
  const [syncOk, setSyncOk] = useState(false);
  const [clockOffsetMs, setClockOffsetMs] = useState(0);
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const completeShown = useRef<Set<number>>(new Set());
  const firstSync = useRef(true);

  const firstName = name.split(' ')[0];

  const fail = useCallback((e: unknown) => {
    if (e instanceof ApiError && e.status === 401) { onLogout(); return; }
    setNotice(e instanceof Error ? e.message : String(e));
  }, [onLogout]);

  const refreshLists = useCallback(async () => {
    const [m, rxs, ds] = await Promise.all([api.me(), api.prescriptions(), api.doses(7)]);
    setMe(m);
    setPrescriptions(rxs);
    setDoses(ds);
  }, [api]);

  const refreshWatch = useCallback(async () => {
    try {
      const s = await api.sync();
      setSync(s);
      setSyncOk(true);
      setClockOffsetMs(parseUtc(s.server_time).getTime() - Date.now());
      const c = s.course;
      if (c?.complete && !completeShown.current.has(c.prescription_id)) {
        completeShown.current.add(c.prescription_id);
        setWatchState('course_complete');
        if (!firstSync.current) setShowCompleteModal(true); // celebrate only when it happens live
      } else {
        setWatchState((prev) => {
          if (s.alert === 'dose' && (prev === 'idle' || prev === 'progress')) return 'reminder';
          if (prev === 'reminder' && s.alert !== 'dose') return 'idle';
          return prev;
        });
      }
      firstSync.current = false;
    } catch (e) {
      setSyncOk(false);
      if (e instanceof ApiError && e.status === 401) onLogout();
    }
  }, [api, onLogout]);

  useEffect(() => {
    refreshLists().catch(fail);
    refreshWatch();
    const a = setInterval(() => { refreshWatch(); }, WATCH_POLL_MS);
    const b = setInterval(() => refreshLists().catch(() => {}), LIST_POLL_MS);
    return () => { clearInterval(a); clearInterval(b); };
  }, [refreshLists, refreshWatch, fail]);

  const askAdvisor = useCallback(async (messages: ChatMsg[], lang: AdvisorLang) => {
    try {
      return (await api.askAdvisor(messages, lang)).reply;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onLogout();
      throw e;
    }
  }, [api, onLogout]);

  const handleWatchAction = useCallback(async (action: WatchAction) => {
    try {
      const ack = await api.ack(action);
      if (ack.accepted && ack.course?.complete && !completeShown.current.has(ack.course.prescription_id)) {
        completeShown.current.add(ack.course.prescription_id);
        setWatchState('course_complete');
        setShowCompleteModal(true);
      }
      refreshWatch();
      refreshLists().catch(() => {});
      return ack;
    } catch (e) {
      fail(e);
      return null;
    }
  }, [api, refreshWatch, refreshLists, fail]);

  const logout = () => {
    api.logout().catch(() => {});
    onLogout();
  };

  const active = prescriptions.filter((r) => r.status === 'active');
  const past = prescriptions.filter((r) => r.status !== 'active');
  const drugById = new Map(prescriptions.map((r) => [r.id, r.drug_name]));
  const selfManaged = !!me?.self_managed;
  const showAdd = selfManaged && (adding || (me !== null && prescriptions.length === 0));

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      <PortalHeader
        portal="Patient portal"
        userName={name}
        subtitle={me ? (selfManaged ? 'My own reminders' : me.facility ? `Prescribed by ${me.facility}` : 'Prescribed by my clinic') : ''}
        onLogout={logout}
      />

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {newCode && (
          <div role="status" className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-4 flex flex-wrap items-center gap-4">
            <KeyRound className="w-6 h-6 text-emerald-300" />
            <div className="flex-1 min-w-[12rem]">
              <p className="text-sm font-semibold text-emerald-100">Your code is <span className="font-mono tracking-[0.2em] text-white text-lg">{newCode}</span></p>
              <p className="text-xs text-slate-300">Write it down. You need it to open your reminders on another phone or after logging out.</p>
            </div>
          </div>
        )}
        {notice && <p role="alert" className="text-xs text-amber-300">{notice}</p>}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Watch */}
          <div className="lg:col-span-5 lg:sticky lg:top-24">
            <div className="bg-slate-900/60 border border-slate-800 rounded-3xl p-4 sm:p-6 flex flex-col items-center shadow-xl overflow-hidden">
              <SmartwatchFrame shape={watchShape} setShape={setWatchShape} wearableSerial={sync ? 'My watch' : '—'} synced={syncOk} battery={null}>
                <WearableView
                  patient={me ? { id: me.id } : null}
                  firstName={firstName}
                  hasToken
                  sync={sync}
                  clockOffsetMs={clockOffsetMs}
                  watchState={watchState}
                  setWatchState={setWatchState}
                  onAction={handleWatchAction}
                  onPair={() => {}}
                  onAskAdvisor={askAdvisor}
                />
              </SmartwatchFrame>
              <p className="text-[11px] text-slate-500 text-center mt-2">
                When a dose is due the watch buzzes. Press <strong>Taken</strong> after you take it.
              </p>
            </div>
          </div>

          {/* Medicines and schedule */}
          <div className="lg:col-span-7 space-y-6">
            {showAdd && (
              <AddMedicines
                api={api}
                onSaved={() => { setAdding(false); setNotice(''); refreshLists().catch(fail); refreshWatch(); }}
                onCancel={prescriptions.length ? () => setAdding(false) : undefined}
              />
            )}

            <section aria-labelledby="meds-h" className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h2 id="meds-h" className="text-sm font-bold text-slate-200 font-heading flex items-center gap-2">
                  <Pill className="w-4 h-4 text-cyan-400" /> My medicines
                </h2>
                {selfManaged && !showAdd && (
                  <button onClick={() => setAdding(true)}
                    className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1">
                    <Plus className="w-3.5 h-3.5" /> Add medicines
                  </button>
                )}
              </div>
              {active.length === 0 && (
                <p className="text-xs text-slate-400">
                  {selfManaged ? 'No medicines yet. Add them from your prescription above.' : 'Your clinic hasn\'t added any medicines yet.'}
                </p>
              )}
              <ul className="space-y-3">
                {active.map((rx) => (
                  <li key={rx.id} className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-semibold text-slate-100">{rx.drug_name}</p>
                      {rx.supply?.refill_due && (
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 whitespace-nowrap">Refill soon</span>
                      )}
                    </div>
                    {rx.dose_instructions && <p className="text-xs text-slate-300">{rx.dose_instructions}</p>}
                    <p className="text-xs text-cyan-300 flex items-center gap-1.5">
                      <CalendarClock className="w-3.5 h-3.5" /> {rx.times.map(hhmmTo12).join(' · ')}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {rx.duration_days ? `${rx.duration_days}-day course from ${rx.start_date}` : 'Every day, ongoing'}
                      {rx.prescriber ? ` · ${rx.prescriber}` : ''}
                    </p>
                    {selfManaged && (
                      <button
                        onClick={async () => {
                          if (!window.confirm(`Stop reminders for ${rx.drug_name}?`)) return;
                          try { await api.stopPrescription(rx.id); await refreshLists(); refreshWatch(); } catch (e) { fail(e); }
                        }}
                        className="text-[11px] text-rose-300 hover:underline">
                        Stop reminders for this medicine
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {past.length > 0 && (
                <details className="text-xs text-slate-400">
                  <summary className="cursor-pointer">Finished or stopped ({past.length})</summary>
                  <ul className="mt-2 space-y-1">
                    {past.map((rx) => <li key={rx.id}>{rx.drug_name} · {rx.status}</li>)}
                  </ul>
                </details>
              )}
            </section>

            <section aria-labelledby="doses-h" className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-3">
              <h2 id="doses-h" className="text-sm font-bold text-slate-200 font-heading">My doses (last 7 days and today)</h2>
              {doses.length === 0 && <p className="text-xs text-slate-400">No doses yet.</p>}
              <ul className="space-y-2 max-h-80 overflow-y-auto pr-1">
                {doses.slice(0, 40).map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-slate-950/80 border border-slate-800 text-xs">
                    <span className="min-w-0 flex items-center gap-2">
                      <span className="font-semibold text-slate-200 whitespace-nowrap">{fmtDay(d.scheduled_at)}</span>
                      <span className="text-slate-400 truncate">{drugById.get(d.prescription_id) ?? ''}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="text-[11px] text-slate-400 font-mono">{fmtTime(d.scheduled_at)}</span>
                      <span className={`px-2 py-0.5 text-[10px] rounded-md font-bold uppercase border ${statusPill[d.status]}`}>
                        {d.status === 'pending' ? 'upcoming' : d.status}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </div>
      </main>

      {showCompleteModal && sync?.course && (
        <CourseCompleteModal firstName={firstName} course={sync.course} onClose={() => setShowCompleteModal(false)} />
      )}
      <DisclaimerBanner />
    </div>
  );
};
