import React, { useState, useEffect } from 'react';
import type { DeviceAck, DeviceSync, DoseFeedbackMessage, Patient, WatchAction, WatchState } from '../types';
import { fmtTime, getRandomReminderMicrocopy, getDoseFeedback } from '../utils/schedule';
import { MediPalMascot } from './MediPalMascot';
import {
  Clock, Check, RotateCcw, X, AlertTriangle, Sparkles, Trophy, ChevronRight, Bell, Link2, PackageOpen,
} from 'lucide-react';

interface WearableViewProps {
  patient: Patient | null;
  firstName: string;
  hasToken: boolean;
  sync: DeviceSync | null;
  clockOffsetMs: number;
  watchState: WatchState;
  setWatchState: (state: WatchState) => void;
  onAction: (action: WatchAction) => Promise<DeviceAck | null>;
  onPair: (serial: string) => void;
  /** Demo mode only: jump the clock to the next dose. */
  onTriggerNextReminder?: () => void;
}

export const WearableView: React.FC<WearableViewProps> = ({
  patient, firstName, hasToken, sync, clockOffsetMs, watchState, setWatchState, onAction, onPair, onTriggerNextReminder,
}) => {
  const [currentTime, setCurrentTime] = useState('');
  const [microcopy, setMicrocopy] = useState('');
  const [feedback, setFeedback] = useState<DoseFeedbackMessage | null>(null);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');
  const [serial, setSerial] = useState(patient?.device?.serial ?? '');

  useEffect(() => setSerial(patient?.device?.serial ?? ''), [patient?.id, patient?.device?.serial]);

  // Watch clock follows the server's clock (which demo mode can move forward).
  useEffect(() => {
    const tick = () => setCurrentTime(fmtTime(new Date(Date.now() + clockOffsetMs)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [clockOffsetMs]);

  useEffect(() => {
    if (watchState === 'reminder') setMicrocopy(getRandomReminderMicrocopy(firstName));
  }, [watchState, firstName]);

  const course = sync?.course ?? null;
  const total = course?.doses_total ?? null;
  const taken = course?.doses_taken ?? 0;
  const resolved = course?.doses_resolved ?? 0;
  const progressPercent = total ? Math.round((taken / total) * 100) : resolved ? Math.round((taken / resolved) * 100) : 0;
  const doseNumber = Math.min(resolved + 1, total ?? Infinity);
  const dayLabel = course ? (course.days_total ? `Day ${course.day} of ${course.days_total}` : `Day ${course.day} · ongoing`) : '';
  const doseLabel = total ? `Dose ${doseNumber} of ${total}` : `${taken} taken`;

  const act = async (a: WatchAction) => {
    setBusy(true);
    setRefusal('');
    const ack = await onAction(a);
    setBusy(false);
    if (!ack) return;
    if (!ack.accepted) { setRefusal(ack.message); return; }
    if (ack.course?.complete) return; // App switches to the celebration screen
    setFeedback(getDoseFeedback(a, firstName));
    setWatchState('dose_logged');
  };

  // ---------- Before a watch is linked ----------
  if (!patient) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center gap-2 px-4">
        <MediPalMascot mood="calm" size="sm" />
        <p className="text-xs text-slate-300">No patient selected.</p>
        <p className="text-[10px] text-slate-500">Push a prescription from the clinician view to link a watch.</p>
      </div>
    );
  }
  if (!hasToken) {
    return (
      <form
        onSubmit={(e) => { e.preventDefault(); if (serial.trim()) onPair(serial.trim()); }}
        className="h-full flex flex-col items-center justify-center text-center gap-2 px-3"
      >
        <Link2 className="w-6 h-6 text-cyan-400" />
        <p className="text-xs font-bold text-slate-100">Pair {firstName}'s watch</p>
        <p className="text-[10px] text-slate-400 leading-snug">This browser has no token for this watch. Pairing issues a new one (the old token stops working).</p>
        <label className="sr-only" htmlFor="pair-serial">Watch serial</label>
        <input
          id="pair-serial"
          value={serial}
          onChange={(e) => setSerial(e.target.value)}
          placeholder="Serial, e.g. MA-0001"
          className="w-full px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-cyan-300 font-mono text-[11px] text-center focus:outline-none focus:border-cyan-500"
        />
        <button type="submit" className="w-full py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-bold text-xs">Pair watch</button>
      </form>
    );
  }

  return (
    <div className="h-full flex flex-col justify-between select-none text-center" aria-live="polite">

      {/* ================= IDLE / WATCH FACE ================= */}
      {watchState === 'idle' && (
        <div className="h-full flex flex-col justify-between py-2 items-center">
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-900 border border-slate-800 text-[11px] text-cyan-300">
            <MediPalMascot mood="happy" size="sm" className="w-5 h-5" />
            <span>MediPal Ready</span>
          </div>

          <div className="my-auto text-center space-y-1">
            <div className="text-4xl font-extrabold font-mono-digits text-slate-100 tracking-tight">{currentTime}</div>
            <div className="text-[11px] font-medium text-cyan-400 font-mono uppercase tracking-wider">{firstName}'s Watch Face</div>
            {sync?.alert === 'refill' && (
              <div className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[10px] font-bold">
                <PackageOpen className="w-3 h-3" /> Refill in {sync.refill_in_days} days
              </div>
            )}
          </div>

          <button
            onClick={() => (course ? setWatchState('progress') : undefined)}
            className="w-full py-2.5 px-3 rounded-2xl bg-gradient-to-r from-slate-900 to-slate-950 border border-cyan-500/40 hover:border-cyan-400 text-left flex items-center justify-between group transition-all"
          >
            <div className="flex items-center space-x-2">
              <div className="w-7 h-7 rounded-xl bg-cyan-500/20 flex items-center justify-center text-cyan-300">
                <Clock className="w-4 h-4 group-hover:animate-spin-slow" />
              </div>
              <div>
                <p className="text-[10px] text-slate-400">
                  {sync?.snoozed_until ? 'Snoozed until' : 'Next Dose Scheduled'}
                </p>
                <p className="text-xs font-bold text-slate-200">
                  {sync?.snoozed_until ? fmtTime(sync.snoozed_until)
                    : sync?.next_dose_at ? fmtTime(sync.next_dose_at)
                    : course?.complete ? 'Course finished' : sync ? 'None scheduled' : 'Syncing…'}
                </p>
              </div>
            </div>
            {course && (
              <span className="text-[10px] text-cyan-400 font-bold bg-cyan-950 px-2 py-0.5 rounded-md border border-cyan-500/30">
                {doseLabel}
              </span>
            )}
          </button>
        </div>
      )}

      {/* ================= NEW PRESCRIPTION RECEIVED ================= */}
      {watchState === 'auto_updated' && (
        <div className="h-full flex flex-col justify-between py-2 items-center text-center">
          <div className="w-12 h-12 rounded-2xl bg-cyan-500/20 border border-cyan-400/50 flex items-center justify-center text-cyan-300 my-1 animate-pulse-glow">
            <Sparkles className="w-6 h-6" />
          </div>
          <div className="space-y-1.5 px-2">
            <span className="px-2.5 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 text-[10px] font-bold uppercase tracking-wider">
              ✨ Auto-Updated
            </span>
            <h3 className="text-xs font-bold text-slate-100 font-heading">New Prescription Received!</h3>
            <p className="text-[11px] text-slate-300 leading-snug">
              Your clinician confirmed <span className="text-cyan-300 font-semibold">{course?.label ?? 'a new medicine'}</span>. Your schedule is ready!
            </p>
          </div>
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-2 w-full text-[10px] text-slate-400 flex justify-around">
            <span>{sync?.next_dose_at ? `First: ${fmtTime(sync.next_dose_at)}` : 'Schedule synced'}</span>
            <span>•</span>
            <span>{course?.days_total ? `${course.days_total} Days Total` : 'Ongoing'}</span>
          </div>
          <button
            onClick={() => setWatchState(sync?.alert === 'dose' ? 'reminder' : 'idle')}
            className="w-full py-2 px-3 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-bold text-xs shadow-md flex items-center justify-center gap-1.5"
          >
            <span>{sync?.alert === 'dose' ? 'View First Reminder' : 'Go to Watch Face'}</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ================= REMINDER ================= */}
      {watchState === 'reminder' && (
        <div className="h-full flex flex-col justify-between py-1 text-center">
          <div className="flex flex-col items-center space-y-1">
            <MediPalMascot mood="cheering" size="sm" />
            <div className="bg-slate-900/90 border border-cyan-500/40 rounded-xl p-2 text-xs text-slate-100 shadow-md">
              <p className="font-medium leading-tight text-[11px]">
                {microcopy || `Time for your dose, ${firstName} — you've got this! ✨`}
              </p>
              {sync?.next_dose_label && <p className="text-[10px] text-cyan-300 mt-0.5">{sync.next_dose_label}</p>}
            </div>
          </div>

          <div className="px-2 py-1 rounded-lg bg-cyan-950/60 border border-cyan-500/30 text-[10px] text-cyan-300 font-semibold flex items-center justify-between">
            <span>{dayLabel}</span>
            <span>•</span>
            <span>{doseLabel}</span>
          </div>

          {refusal && <p className="text-[10px] text-amber-300">{refusal}</p>}

          <div className="grid grid-cols-2 gap-1.5 pt-1">
            <button disabled={busy} onClick={() => act('taken')}
              className="py-2.5 px-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md shadow-emerald-600/30 flex items-center justify-center gap-1 active:scale-95 transition-all disabled:opacity-60">
              <Check className="w-4 h-4" /><span>Taken</span>
            </button>
            <button disabled={busy} onClick={() => act('snooze')}
              className="py-2.5 px-2 rounded-xl bg-cyan-700 hover:bg-cyan-600 text-white font-bold text-xs shadow-md shadow-cyan-700/30 flex items-center justify-center gap-1 active:scale-95 transition-all disabled:opacity-60">
              <RotateCcw className="w-3.5 h-3.5" /><span>Delay 30m</span>
            </button>
            <button disabled={busy} onClick={() => act('skipped')}
              className="py-2 px-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-500/30 font-semibold text-[11px] flex items-center justify-center gap-1 active:scale-95 transition-all disabled:opacity-60">
              <X className="w-3.5 h-3.5" /><span>Skipped</span>
            </button>
            <button disabled={busy} onClick={() => act('missed')}
              className="py-2 px-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 font-semibold text-[11px] flex items-center justify-center gap-1 active:scale-95 transition-all disabled:opacity-60">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400" /><span>Missed</span>
            </button>
          </div>
        </div>
      )}

      {/* ================= DOSE LOGGED ================= */}
      {watchState === 'dose_logged' && feedback && (
        <div className="h-full flex flex-col justify-between py-2 text-center">
          <MediPalMascot mood={feedback.mascotMood} size="sm" className="mx-auto" />
          <div className="space-y-1.5">
            <span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold ${feedback.badgeColor}`}>{feedback.title}</span>
            <p className="text-[11px] text-slate-200 leading-snug px-1">{feedback.message}</p>
          </div>
          <div className="space-y-1.5">
            <button onClick={() => setWatchState('progress')}
              className="w-full py-2 px-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs shadow-md flex items-center justify-center gap-1.5">
              <span>View Course Progress</span><ChevronRight className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => setWatchState('idle')} className="text-[10px] text-slate-400 hover:text-slate-200">Back to Watch Face</button>
          </div>
        </div>
      )}

      {/* ================= PROGRESS ================= */}
      {watchState === 'progress' && (
        <div className="h-full flex flex-col justify-between py-1 text-center">
          <div className="text-xs font-bold text-slate-200 font-heading">{firstName}'s Adherence Ring</div>
          <div className="relative w-28 h-28 mx-auto flex items-center justify-center">
            <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36" aria-hidden>
              <path className="text-slate-800" strokeWidth="3.5" stroke="currentColor" fill="none"
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
              <path className="text-cyan-400 transition-all duration-700 ease-out" strokeDasharray={`${progressPercent}, 100`}
                strokeWidth="3.5" strokeLinecap="round" stroke="currentColor" fill="none"
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-sm font-extrabold text-cyan-300 font-mono">{total ? `${taken}/${total}` : `${progressPercent}%`}</span>
              <span className="text-[9px] text-slate-400 font-semibold uppercase">{total ? 'Doses' : 'On time'}</span>
            </div>
          </div>
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-2 text-[10px] text-slate-300 space-y-0.5">
            <p className="font-bold text-cyan-300">{dayLabel}</p>
            <p className="text-slate-400">{total ? `${Math.max(total - resolved, 0)} doses left` : `${taken} of ${resolved} doses taken so far`}</p>
          </div>
          <div className="flex gap-1.5">
            {onTriggerNextReminder && (
              <button onClick={onTriggerNextReminder}
                className="flex-1 py-2 px-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-[11px] shadow-sm flex items-center justify-center gap-1">
                <Bell className="w-3.5 h-3.5" /><span>Next Dose</span>
              </button>
            )}
            <button onClick={() => setWatchState('idle')} className="flex-1 py-2 px-3 rounded-xl bg-slate-800 text-slate-300 font-medium text-[11px]">Watch Face</button>
          </div>
        </div>
      )}

      {/* ================= COURSE COMPLETE ================= */}
      {watchState === 'course_complete' && (
        <div className="h-full flex flex-col justify-between py-2 text-center">
          <div className="w-10 h-10 rounded-2xl bg-amber-500/20 border border-amber-400/50 flex items-center justify-center text-amber-300 mx-auto animate-bounce">
            <Trophy className="w-5 h-5" />
          </div>
          <div className="space-y-1">
            <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[9px] font-bold uppercase">🏆 Course Complete!</span>
            <h3 className="text-xs font-bold text-slate-100 font-heading">Fantastic Job, {firstName}!</h3>
            <p className="text-[10px] text-slate-300 leading-snug">
              You took {taken} of {total ?? resolved} doses of {course?.label}.
            </p>
          </div>
          <MediPalMascot mood="celebrate" size="sm" className="mx-auto" />
          <button onClick={() => setWatchState('idle')} className="w-full py-2 px-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shadow-md">
            Finished • Back to Face
          </button>
        </div>
      )}
    </div>
  );
};
