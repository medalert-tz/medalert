import React from 'react';
import { Users, Pill, AlertTriangle, PackageOpen, ChevronRight, ShieldAlert } from 'lucide-react';
import type { PatientProgress } from '../types';
import { fmtDay, fmtTime } from '../utils/schedule';
import { RiskBadge } from './ClinicianView';

interface Props {
  rows: PatientProgress[];
  onOpen: (patientId: number) => void;
}

function adherenceTone(pct: number | null) {
  if (pct === null) return { bar: 'bg-slate-600', text: 'text-slate-400', label: 'No doses due yet' };
  if (pct >= 90) return { bar: 'bg-emerald-400', text: 'text-emerald-300', label: 'On track' };
  if (pct >= 70) return { bar: 'bg-amber-400', text: 'text-amber-300', label: 'Slipping' };
  return { bar: 'bg-rose-400', text: 'text-rose-300', label: 'Struggling' };
}

/** All of this clinic's patients and how they are doing over the last 14 days. */
export const ProgressDashboard: React.FC<Props> = ({ rows, onOpen }) => {
  const scored = rows.filter((r) => r.adherence_pct !== null);
  const avg = scored.length ? Math.round(scored.reduce((a, r) => a + (r.adherence_pct ?? 0), 0) / scored.length) : null;
  const needFollowUp = rows.filter((r) => r.patient.open_intervention).length;
  const refills = rows.filter((r) => r.refill_due).length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat icon={<Users className="w-4 h-4 text-cyan-400" />} label="Patients" value={String(rows.length)} />
        <Stat icon={<Pill className="w-4 h-4 text-emerald-400" />} label="Average doses taken (14 days)" value={avg === null ? '—' : `${avg}%`} />
        <Stat icon={<ShieldAlert className="w-4 h-4 text-rose-400" />} label="Need follow-up" value={String(needFollowUp)} />
        <Stat icon={<PackageOpen className="w-4 h-4 text-amber-400" />} label="Refill due" value={String(refills)} />
      </div>

      <section aria-labelledby="progress-h" className="bg-slate-900/90 border border-slate-800 rounded-2xl shadow-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between gap-2">
          <h3 id="progress-h" className="text-sm font-bold text-slate-200 font-heading">Patient progress <span className="text-[11px] font-normal text-slate-500">(highest risk first · last 14 days)</span></h3>
        </div>
        {rows.length === 0 ? (
          <p className="p-5 text-xs text-slate-400">No patients yet. Go to <strong>Prescribe</strong> to add the first one.</p>
        ) : (
          <ul className="divide-y divide-slate-800">
            {rows.map((r) => {
              const tone = adherenceTone(r.adherence_pct);
              return (
                <li key={r.patient.id}>
                  <button onClick={() => onOpen(r.patient.id)}
                    className="w-full text-left px-5 py-4 hover:bg-slate-800/40 focus:bg-slate-800/40 focus:outline-none grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
                    <div className="md:col-span-4 min-w-0">
                      <p className="text-sm font-semibold text-slate-100 truncate">{r.patient.display_name}</p>
                      <p className="text-[11px] text-slate-400 truncate">
                        {[r.patient.condition, r.patient.facility].filter(Boolean).join(' · ') || '—'}
                      </p>
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        <RiskBadge risk={r.patient.risk} />
                        {r.patient.open_intervention && (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40 flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" /> Follow up
                          </span>
                        )}
                        {r.refill_due && (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">Refill due</span>
                        )}
                      </div>
                    </div>

                    <div className="md:col-span-3 text-[11px] text-slate-300 min-w-0">
                      {r.active_medicines.length ? (
                        <ul className="space-y-0.5">
                          {r.active_medicines.map((m) => <li key={m} className="truncate">• {m}</li>)}
                        </ul>
                      ) : <span className="text-slate-500">No active medicines</span>}
                    </div>

                    <div className="md:col-span-3 space-y-1">
                      <div className="flex justify-between text-[11px]">
                        <span className={`font-semibold ${tone.text}`}>{tone.label}</span>
                        <span className="font-mono text-slate-200">{r.adherence_pct === null ? '—' : `${Math.round(r.adherence_pct)}%`}</span>
                      </div>
                      <div className="h-2 rounded-full bg-slate-950 border border-slate-800 overflow-hidden" role="progressbar"
                        aria-label={`${r.patient.display_name} doses taken`} aria-valuenow={r.adherence_pct ?? 0} aria-valuemin={0} aria-valuemax={100}>
                        <div className={`h-full ${tone.bar}`} style={{ width: `${r.adherence_pct ?? 0}%` }} />
                      </div>
                      <p className="text-[10px] text-slate-500">{r.doses_taken} taken · {r.doses_missed} missed or skipped</p>
                    </div>

                    <div className="md:col-span-2 text-[11px] text-slate-400 flex items-center justify-between gap-2">
                      <span>
                        <span className="block text-slate-500">Next dose</span>
                        <span className="text-slate-200">{r.next_dose_at ? `${fmtDay(r.next_dose_at)}, ${fmtTime(r.next_dose_at)}` : '—'}</span>
                      </span>
                      <ChevronRight className="w-4 h-4 text-slate-500 flex-shrink-0" aria-hidden />
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
};

const Stat: React.FC<{ icon: React.ReactNode; label: string; value: string }> = ({ icon, label, value }) => (
  <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-xl">
    <p className="text-[11px] text-slate-400 flex items-center gap-1.5">{icon}{label}</p>
    <p className="text-2xl font-bold text-slate-100 font-heading mt-1">{value}</p>
  </div>
);
