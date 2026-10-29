import React from 'react';
import { Clock, Plus, X } from 'lucide-react';
import { FREQUENCY_PRESETS } from '../utils/schedule';

export const MAX_TIMES = 6; // backend limit per medicine
export const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** A sensible next slot when someone adds a time: 4 hours after the last one. */
export function nextTime(times: string[]) {
  const last = [...times].sort().pop();
  if (!last) return '08:00';
  const [h, m] = last.split(':').map(Number);
  return `${String((h + 4) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Problems with a list of times, or '' if fine. Same rules as the backend. */
export function timesProblem(times: string[]): string {
  if (times.length === 0) return 'add at least one dose time';
  if (times.some((t) => !HHMM.test(t))) return 'every dose time needs hours and minutes';
  if (new Set(times).size !== times.length) return 'the same time is entered twice';
  return '';
}

/** Editable list of daily dose times, with 1x/2x/3x quick-fill buttons. */
export const TimesEditor: React.FC<{
  label: string;
  times: string[];
  onChange: (times: string[]) => void;
}> = ({ label, times, onChange }) => (
  <fieldset>
    <legend className="text-xs font-medium text-slate-300 mb-1.5">
      Dose times <span className="text-slate-500 font-normal">({times.length} a day)</span>
    </legend>
    <div className="flex flex-wrap items-center gap-2 mb-2">
      <span className="text-[11px] text-slate-500">Quick fill:</span>
      <div className="flex gap-1" role="group" aria-label="Quick fill dose times">
        {FREQUENCY_PRESETS.map((f) => (
          <button key={f.label} type="button" onClick={() => onChange(f.times)} title={f.label}
            className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-slate-800 text-slate-300 border border-slate-700 hover:border-cyan-500/60">
            {f.times.length}x
          </button>
        ))}
      </div>
    </div>
    <ul className="flex flex-wrap gap-2">
      {times.map((t, i) => (
        <li key={i} className="flex items-center gap-1 rounded-xl bg-slate-950 border border-slate-800 pl-2 pr-1 py-1">
          <Clock className="w-3.5 h-3.5 text-slate-500" aria-hidden />
          <input type="time" value={t} required aria-label={`${label} dose time ${i + 1}`}
            onChange={(e) => onChange(times.map((x, j) => (j === i ? e.target.value : x)))}
            className="bg-transparent text-sm text-slate-100 focus:outline-none [color-scheme:dark]" />
          {times.length > 1 && (
            <button type="button" onClick={() => onChange(times.filter((_, j) => j !== i))} aria-label={`Remove time ${t}`}
              className="p-1 rounded-md text-slate-500 hover:text-rose-300 hover:bg-rose-500/10">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </li>
      ))}
      {times.length < MAX_TIMES && (
        <li>
          <button type="button" onClick={() => onChange([...times, nextTime(times)])}
            className="h-full px-3 py-1.5 rounded-xl border border-dashed border-slate-700 text-slate-300 hover:border-cyan-500/60 hover:text-cyan-300 text-xs flex items-center gap-1">
            <Plus className="w-3.5 h-3.5" /> Add time
          </button>
        </li>
      )}
    </ul>
    <p className="text-[11px] text-slate-500 mt-1.5">Times are in East Africa Time. Up to {MAX_TIMES} a day.</p>
  </fieldset>
);
