import React, { useEffect, useMemo, useState } from 'react';
import type { Dose, Intervention, Patient, PrescribeForm, Prescription, Risk } from '../types';
import { FREQUENCY_PRESETS, MEDICINE_SUGGESTIONS, fmtDay, fmtTime, hhmmTo12, todayLocal } from '../utils/schedule';
import {
  Send, CheckCircle2, UserCheck, Clock, Pill, Sparkles, Activity, History, RefreshCw, FileCheck,
  AlertTriangle, Users, PackagePlus, ShieldAlert,
} from 'lucide-react';

export interface PushReceipt {
  patientName: string;
  serial: string;
  prescription: Prescription;
  at: Date;
  paired: boolean;
}

interface ClinicianViewProps {
  patients: Patient[];
  selected: Patient | null;
  onSelect: (id: number) => void;
  prescriptions: Prescription[];
  doses: Dose[];
  interventions: Intervention[];
  lastPush: PushReceipt | null;
  onPush: (form: PrescribeForm) => Promise<void>;
  onResolve: (id: number, by: string, note: string) => Promise<void>;
  onDispense: (rxId: number, doses: number) => Promise<void>;
  onRunMonitor: () => Promise<void>;
}

const inputCls = 'w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 text-sm focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-colors';
const labelCls = 'block text-xs font-medium text-slate-300 mb-1';
const card = 'bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl';

export const RiskBadge: React.FC<{ risk: Risk | null }> = ({ risk }) => {
  if (!risk) return <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-800 text-slate-400 border border-slate-700">No score</span>;
  const styles = {
    high: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
    medium: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
    low: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  }[risk.level];
  const label = { high: 'High risk', medium: 'Medium', low: 'Low risk' }[risk.level];
  return (
    <span title={`Risk score ${risk.score} (${risk.model_version})`} className={`px-2 py-0.5 rounded-md text-[10px] font-bold border whitespace-nowrap ${styles}`}>
      {label} · {Math.round(risk.score * 100)}
    </span>
  );
};

const statusDot: Record<string, string> = {
  taken: 'bg-emerald-400', skipped: 'bg-amber-400', missed: 'bg-rose-400', pending: 'bg-slate-600',
};
const statusPill: Record<string, string> = {
  taken: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  skipped: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  missed: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
  pending: 'bg-slate-800 text-slate-400 border-slate-700',
};

function newSerial() {
  return `MA-${String(Math.floor(1000 + Math.random() * 9000))}`;
}

export const ClinicianView: React.FC<ClinicianViewProps> = ({
  patients, selected, onSelect, prescriptions, doses, interventions, lastPush,
  onPush, onResolve, onDispense, onRunMonitor,
}) => {
  // ---------- Prescribe form ----------
  const [target, setTarget] = useState<'new' | 'selected'>('new');
  const [patientName, setPatientName] = useState('');
  const [condition, setCondition] = useState('');
  const [facility, setFacility] = useState('');
  const [wearableSerial, setWearableSerial] = useState(newSerial);
  const [medicationName, setMedicationName] = useState('Amoxicillin 500mg');
  const [dosage, setDosage] = useState('1 capsule by mouth');
  const [frequency, setFrequency] = useState(FREQUENCY_PRESETS[1].label);
  const [ongoing, setOngoing] = useState(false);
  const [durationDays, setDurationDays] = useState(7);
  const [startDate, setStartDate] = useState(() => todayLocal());
  const [prescriber, setPrescriber] = useState('');
  const [notes, setNotes] = useState('Take with food and a full glass of water.');
  const [dispensedOverride, setDispensedOverride] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState('');

  const times = FREQUENCY_PRESETS.find((f) => f.label === frequency)?.times ?? ['08:00', '20:00'];
  const defaultDispensed = times.length * (ongoing ? 30 : durationDays);
  const dosesDispensed = dispensedOverride === null ? defaultDispensed : Math.max(0, Number(dispensedOverride) || 0);

  useEffect(() => {
    if (target === 'selected' && selected) setWearableSerial(selected.device?.serial ?? newSerial());
  }, [target, selected]);
  useEffect(() => { if (!selected) setTarget('new'); }, [selected]);

  const handleConfirmAndPush = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setFormError('');
    try {
      await onPush({
        target, patientName, condition, facility, wearableSerial, medicationName, dosage, times,
        ongoing, durationDays, startDate, prescriber, notes, dosesDispensed,
      });
      if (target === 'new') {
        setPatientName(''); setCondition(''); setWearableSerial(newSerial());
      }
      setDispensedOverride(null);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not save the prescription');
    } finally {
      setIsSubmitting(false);
    }
  };

  // ---------- Selected patient telemetry ----------
  const activeRx = prescriptions.find((r) => r.status === 'active') ?? prescriptions[0] ?? null;
  const rxDoses = useMemo(() => doses.filter((d) => !activeRx || d.prescription_id === activeRx.id), [doses, activeRx]);
  const takenCount = rxDoses.filter((d) => d.status === 'taken').length;
  const resolvedCount = rxDoses.filter((d) => d.status !== 'pending').length;
  const adherencePct = resolvedCount ? Math.round((takenCount / resolvedCount) * 100) : 0;

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try { await fn(); } finally { setBusy(''); }
  };

  return (
    <div className="space-y-6">

      {/* Header bar */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 backdrop-blur-md flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 p-0.5 shadow-md">
            <div className="w-full h-full bg-slate-900 rounded-[10px] flex items-center justify-center text-cyan-400">
              <UserCheck className="w-6 h-6" />
            </div>
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-100 font-heading">Clinic Workstation</h2>
            <p className="text-xs text-slate-400">{patients.length} patient(s) · {interventions.length} need follow-up</p>
          </div>
        </div>
        <button
          onClick={() => run('monitor', onRunMonitor)}
          disabled={busy === 'monitor'}
          className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700 flex items-center gap-1.5 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${busy === 'monitor' ? 'animate-spin' : ''}`} />
          <span>Re-check risk now</span>
        </button>
      </div>

      {/* Needs attention + patient list */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <section aria-labelledby="queue-h" className={`${card} space-y-3`}>
          <h3 id="queue-h" className="text-sm font-bold text-slate-200 font-heading flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-rose-400" /> Needs attention
          </h3>
          {interventions.length === 0 && <p className="text-xs text-slate-400">No patients need follow-up right now.</p>}
          <ul className="space-y-3 max-h-80 overflow-y-auto pr-1">
            {interventions.map((iv) => (
              <InterventionItem key={iv.id} iv={iv} onView={() => onSelect(iv.patient_id)} onResolve={onResolve} />
            ))}
          </ul>
        </section>

        <section aria-labelledby="patients-h" className={`${card} space-y-3`}>
          <h3 id="patients-h" className="text-sm font-bold text-slate-200 font-heading flex items-center gap-2">
            <Users className="w-4 h-4 text-cyan-400" /> Patients <span className="text-[11px] font-normal text-slate-500">(highest risk first)</span>
          </h3>
          {patients.length === 0 && <p className="text-xs text-slate-400">No patients yet. Use the form below to add one.</p>}
          <ul className="space-y-2 max-h-80 overflow-y-auto pr-1">
            {patients.map((p) => (
              <li key={p.id}>
                <button
                  onClick={() => onSelect(p.id)}
                  aria-current={selected?.id === p.id}
                  className={`w-full flex items-center justify-between gap-2 p-2.5 rounded-xl border text-left transition-colors ${
                    selected?.id === p.id ? 'bg-cyan-950/40 border-cyan-500/50' : 'bg-slate-950/80 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold text-slate-200 truncate">{p.display_name}</span>
                    <span className="block text-[11px] text-slate-500 truncate">{[p.condition, p.device?.serial].filter(Boolean).join(' · ') || '—'}</span>
                  </span>
                  <RiskBadge risk={p.risk} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* Prescribe form + confirmation/telemetry */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

        <div className="lg:col-span-7 bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4 gap-2">
            <div>
              <h3 className="text-lg font-bold text-slate-100 font-heading flex items-center gap-2">
                <Pill className="w-5 h-5 text-cyan-400" /> Prescribe Medication
              </h3>
              <p className="text-xs text-slate-400">Clinician confirms → wearable schedule updates on next sync</p>
            </div>
          </div>

          <form onSubmit={handleConfirmAndPush} className="space-y-4">
            {selected && (
              <fieldset className="flex flex-wrap gap-2 text-xs">
                <legend className="sr-only">Prescribe for</legend>
                {(['new', 'selected'] as const).map((t) => (
                  <label key={t} className={`px-3 py-1.5 rounded-lg border cursor-pointer ${target === t ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-200' : 'bg-slate-950 border-slate-800 text-slate-400'}`}>
                    <input type="radio" name="target" value={t} checked={target === t} onChange={() => setTarget(t)} className="sr-only" />
                    {t === 'new' ? 'New patient' : `Add to ${selected.display_name}`}
                  </label>
                ))}
              </fieldset>
            )}

            {target === 'new' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="f-name" className={labelCls}>Patient Full Name</label>
                  <input id="f-name" value={patientName} onChange={(e) => setPatientName(e.target.value)} className={inputCls} placeholder="e.g. Rehema Ali" required maxLength={120} />
                </div>
                <div>
                  <label htmlFor="f-cond" className={labelCls}>Condition</label>
                  <input id="f-cond" value={condition} onChange={(e) => setCondition(e.target.value)} className={inputCls} placeholder="e.g. Hypertension" maxLength={120} />
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="f-serial" className={labelCls}>Linked Wearable Serial ID</label>
                <input id="f-serial" value={wearableSerial} onChange={(e) => setWearableSerial(e.target.value)} className={`${inputCls} text-cyan-300 font-mono`} required maxLength={64} />
              </div>
              {target === 'new' ? (
                <div>
                  <label htmlFor="f-fac" className={labelCls}>Facility</label>
                  <input id="f-fac" value={facility} onChange={(e) => setFacility(e.target.value)} className={inputCls} placeholder="e.g. Mnazi Mmoja Hospital" maxLength={120} />
                </div>
              ) : (
                <div>
                  <label htmlFor="f-prescriber-a" className={labelCls}>Prescriber</label>
                  <input id="f-prescriber-a" value={prescriber} onChange={(e) => setPrescriber(e.target.value)} className={inputCls} placeholder="Your name" maxLength={120} />
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="f-med" className={labelCls}>Medicine Name</label>
                <input id="f-med" list="medicines" value={medicationName} onChange={(e) => setMedicationName(e.target.value)} className={inputCls} required maxLength={120} />
                <datalist id="medicines">{MEDICINE_SUGGESTIONS.map((m) => <option key={m} value={m} />)}</datalist>
              </div>
              <div>
                <label htmlFor="f-dose" className={labelCls}>Dosage Instructions</label>
                <input id="f-dose" value={dosage} onChange={(e) => setDosage(e.target.value)} className={inputCls} required maxLength={100} />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="f-freq" className={labelCls}>Frequency</label>
                <select id="f-freq" value={frequency} onChange={(e) => setFrequency(e.target.value)} className={inputCls}>
                  {FREQUENCY_PRESETS.map((f) => (
                    <option key={f.label} value={f.label}>{f.label} — {f.times.map(hhmmTo12).join(', ')}</option>
                  ))}
                </select>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label htmlFor="f-days" className="text-xs font-medium text-slate-300">Course Duration</label>
                  <label className="flex items-center gap-1.5 text-[11px] text-slate-400 cursor-pointer">
                    <input type="checkbox" checked={ongoing} onChange={(e) => setOngoing(e.target.checked)} className="accent-cyan-400" />
                    Ongoing (chronic)
                  </label>
                </div>
                <div className={`flex items-center gap-3 ${ongoing ? 'opacity-40' : ''}`}>
                  <input id="f-days" type="range" min={1} max={30} value={durationDays} disabled={ongoing}
                    onChange={(e) => setDurationDays(Number(e.target.value))}
                    className="w-full accent-cyan-400 bg-slate-800 rounded-lg cursor-pointer" />
                  <span className="px-3 py-1 rounded-lg bg-slate-950 border border-slate-800 text-cyan-400 font-bold text-sm min-w-[78px] text-center">
                    {ongoing ? 'Ongoing' : `${durationDays} Days`}
                  </span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="f-start" className={labelCls}>Start Date</label>
                <input id="f-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputCls} required />
              </div>
              <div>
                <label htmlFor="f-disp" className={labelCls}>Doses Handed Out Now</label>
                <input id="f-disp" type="number" min={0} max={10000} value={dispensedOverride ?? String(defaultDispensed)}
                  onChange={(e) => setDispensedOverride(e.target.value)} className={inputCls} />
              </div>
              {target === 'new' && (
                <div>
                  <label htmlFor="f-prescriber" className={labelCls}>Prescriber</label>
                  <input id="f-prescriber" value={prescriber} onChange={(e) => setPrescriber(e.target.value)} className={inputCls} placeholder="Your name" maxLength={120} />
                </div>
              )}
            </div>

            <div>
              <label htmlFor="f-notes" className={labelCls}>Patient Friendly Instructions</label>
              <textarea id="f-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={100}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-cyan-500 transition-colors resize-none" />
            </div>

            {formError && <p role="alert" className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg p-2.5">{formError}</p>}

            <div className="pt-2">
              <button type="submit" disabled={isSubmitting}
                className="w-full py-4 px-6 rounded-xl bg-gradient-to-r from-cyan-500 via-sky-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white font-bold text-base shadow-lg shadow-cyan-500/25 transition-all duration-300 flex items-center justify-center gap-3 group relative overflow-hidden disabled:opacity-50">
                <div className="absolute inset-0 bg-shimmer pointer-events-none" />
                <Send className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                <span>{isSubmitting ? 'Saving…' : 'Confirm and Push to Wearable'}</span>
                <Sparkles className="w-4 h-4 text-cyan-200 animate-pulse" />
              </button>
              <p className="text-[11px] text-center text-slate-400 mt-2">
                Saves the prescription, records what was handed out, and the wearable picks up the schedule on its next sync.
              </p>
            </div>
          </form>
        </div>

        <div className="lg:col-span-5 space-y-6">
          {/* Confirmation */}
          {lastPush ? (
            <div className="bg-gradient-to-br from-slate-900 to-slate-950 border border-emerald-500/40 rounded-2xl p-6 shadow-2xl relative overflow-hidden space-y-4">
              <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 rounded-full blur-2xl pointer-events-none" />
              <div className="flex items-center space-x-3">
                <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 flex-shrink-0">
                  <CheckCircle2 className="w-7 h-7" />
                </div>
                <div>
                  <h4 className="text-base font-bold text-slate-100 font-heading">Sent to {lastPush.patientName.split(' ')[0]}'s Wearable</h4>
                  <p className="text-xs text-emerald-400 font-medium">Saved • {lastPush.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                </div>
              </div>
              <dl className="bg-slate-950/80 rounded-xl p-4 border border-slate-800/80 space-y-2 text-xs">
                <Row k="Target Device" v={<span className="font-mono text-cyan-300">{lastPush.serial}{lastPush.paired ? ' (newly paired)' : ''}</span>} />
                <Row k="Prescription" v={lastPush.prescription.drug_name} />
                <Row k="Schedule" v={`${lastPush.prescription.times.map(hhmmTo12).join(', ')} · ${lastPush.prescription.duration_days ? `${lastPush.prescription.duration_days} days · ${lastPush.prescription.doses_total} doses` : 'ongoing'}`} />
                <Row k="Dispensed" v={<span className="text-emerald-400 font-semibold flex items-center gap-1"><FileCheck className="w-3.5 h-3.5" />{lastPush.prescription.supply?.doses_supplied ?? 0} doses</span>} />
              </dl>
            </div>
          ) : (
            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 text-center space-y-3">
              <Clock className="w-10 h-10 text-slate-500 mx-auto" />
              <h4 className="text-sm font-semibold text-slate-300">Awaiting Clinician Confirmation</h4>
              <p className="text-xs text-slate-400">Fill out the form and click "Confirm and Push to Wearable", or pick a patient to see their telemetry.</p>
            </div>
          )}

          {/* Telemetry for the selected patient */}
          <section aria-labelledby="telemetry-h" className={`${card} space-y-4`}>
            <div className="flex items-center justify-between border-b border-slate-800 pb-3 gap-2">
              <h4 id="telemetry-h" className="text-sm font-bold text-slate-200 font-heading flex items-center gap-2">
                <Activity className="w-4 h-4 text-cyan-400" /> {selected ? selected.display_name : 'Patient Telemetry'}
              </h4>
              {selected ? <RiskBadge risk={selected.risk} /> : (
                <span className="text-[11px] text-slate-400 flex items-center gap-1"><History className="w-3 h-3" /> Live Feed</span>
              )}
            </div>

            {!selected && <p className="text-xs text-slate-400">Select a patient.</p>}

            {selected?.risk && selected.risk.factors.length > 0 && (
              <ul className="text-[11px] text-slate-300 space-y-1">
                {selected.risk.factors.map((f) => (
                  <li key={f} className="flex items-start gap-1.5"><AlertTriangle className="w-3 h-3 text-amber-400 mt-0.5 flex-shrink-0" />{f}</li>
                ))}
              </ul>
            )}

            {selected && activeRx && (
              <>
                <div className="text-xs text-slate-300 space-y-1">
                  <p><span className="font-semibold text-slate-100">{activeRx.drug_name}</span> <span className="text-slate-500">({activeRx.status})</span></p>
                  <p className="text-[11px] text-slate-400">
                    {activeRx.times.map(hhmmTo12).join(', ')} · {activeRx.duration_days ? `${activeRx.duration_days}-day course` : 'ongoing'}
                    {activeRx.supply && activeRx.supply.doses_supplied > 0 && <> · {activeRx.supply.doses_remaining} doses left{activeRx.supply.days_remaining !== null && ` (${activeRx.supply.days_remaining.toFixed(1)} days)`}</>}
                  </p>
                  {activeRx.supply?.refill_due && (
                    <span className="inline-block px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">Refill due</span>
                  )}
                </div>

                {activeRx.status === 'active' && (
                  <DispenseForm onDispense={(n) => run('dispense', () => onDispense(activeRx.id, n))} defaultDoses={activeRx.times.length * (activeRx.duration_days ?? 30)} />
                )}

                <div className="space-y-2">
                  <div className="flex justify-between text-xs font-semibold">
                    <span className="text-slate-300">Doses taken (last 14 days)</span>
                    <span className="text-cyan-400 font-mono">{resolvedCount ? `${adherencePct}%` : '—'}</span>
                  </div>
                  <div className="w-full bg-slate-950 rounded-full h-2 overflow-hidden border border-slate-800" role="progressbar" aria-valuenow={adherencePct} aria-valuemin={0} aria-valuemax={100}>
                    <div className="bg-gradient-to-r from-cyan-500 to-emerald-400 h-full transition-all duration-500" style={{ width: `${adherencePct}%` }} />
                  </div>
                </div>
              </>
            )}

            {selected && (
              <ul className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {doses.length === 0 && <li className="text-xs text-slate-400">No doses scheduled.</li>}
                {doses.slice(0, 20).map((dose) => (
                  <li key={dose.id} className="flex items-center justify-between p-2.5 rounded-xl bg-slate-950/80 border border-slate-800 text-xs">
                    <div className="flex items-center space-x-2.5">
                      <span className={`w-2 h-2 rounded-full ${statusDot[dose.status]}`} aria-hidden />
                      <span className="font-semibold text-slate-200">{fmtDay(dose.scheduled_at)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-slate-400 font-mono">{fmtTime(dose.scheduled_at)}</span>
                      <span className={`px-2 py-0.5 text-[10px] rounded-md font-bold uppercase border ${statusPill[dose.status]}`}>
                        {dose.status === 'pending' ? 'upcoming' : dose.status}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};

const Row: React.FC<{ k: string; v: React.ReactNode }> = ({ k, v }) => (
  <div className="flex justify-between gap-3 text-slate-400">
    <dt>{k}:</dt>
    <dd className="font-medium text-slate-200 text-right">{v}</dd>
  </div>
);

const DispenseForm: React.FC<{ onDispense: (n: number) => void; defaultDoses: number }> = ({ onDispense, defaultDoses }) => {
  const [n, setN] = useState(String(defaultDoses));
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (Number(n) > 0) onDispense(Number(n)); }} className="flex items-end gap-2">
      <div className="flex-1">
        <label htmlFor="disp-n" className="block text-[11px] text-slate-400 mb-1">Record a refill (doses handed out)</label>
        <input id="disp-n" type="number" min={1} value={n} onChange={(e) => setN(e.target.value)}
          className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 text-xs focus:outline-none focus:border-cyan-500" />
      </div>
      <button type="submit" className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold flex items-center gap-1">
        <PackagePlus className="w-3.5 h-3.5" /> Dispense
      </button>
    </form>
  );
};

const InterventionItem: React.FC<{
  iv: Intervention;
  onView: () => void;
  onResolve: (id: number, by: string, note: string) => Promise<void>;
}> = ({ iv, onView, onResolve }) => {
  const [by, setBy] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  return (
    <li className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 border-l-4 border-l-rose-400 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <button onClick={onView} className="text-xs font-bold text-slate-100 hover:text-cyan-300 text-left">{iv.patient_name}</button>
        <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40">Risk {Math.round(iv.score * 100)}</span>
      </div>
      <p className="text-[11px] text-slate-300 leading-snug">{iv.reason}</p>
      <form
        className="grid grid-cols-1 sm:grid-cols-5 gap-1.5"
        onSubmit={async (e) => {
          e.preventDefault();
          setErr('');
          try { await onResolve(iv.id, by.trim(), note.trim()); } catch (x) { setErr(x instanceof Error ? x.message : 'Failed'); }
        }}
      >
        <input aria-label="Your name" required value={by} onChange={(e) => setBy(e.target.value)} placeholder="Your name"
          className="sm:col-span-2 px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 text-[11px] focus:outline-none focus:border-cyan-500" />
        <input aria-label={`Outcome note for ${iv.patient_name}`} required value={note} onChange={(e) => setNote(e.target.value)} placeholder="Outcome, e.g. called; refill arranged"
          className="sm:col-span-3 px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 text-[11px] focus:outline-none focus:border-cyan-500" />
        <button type="submit" className="sm:col-span-5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold">Mark followed up</button>
      </form>
      {err && <p className="text-[10px] text-amber-300">{err}</p>}
    </li>
  );
};
