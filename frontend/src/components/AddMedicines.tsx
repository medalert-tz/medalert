import React, { useRef, useState } from 'react';
import { Camera, Keyboard, Plus, Trash2, AlertTriangle, Loader2, Save, ImageIcon, X } from 'lucide-react';
import { ApiError, type PatientApi } from '../api';
import type { ScannedMedicine } from '../types';
import { MEDICINE_SUGGESTIONS, todayLocal } from '../utils/schedule';
import { TimesEditor, timesProblem } from './TimesEditor';

/** For patients whose hospital isn't on MediAlert: add medicines from a photo or by typing. */

interface Draft {
  key: number;
  drug_name: string;
  dose_instructions: string;
  times: string[];
  ongoing: boolean;
  duration_days: number;
  confidence: ScannedMedicine['confidence'] | null;
  note: string | null;
}

interface Photo { previewUrl: string; base64: string; mediaType: string }

let draftKey = 0;
function blankDraft(): Draft {
  return { key: ++draftKey, drug_name: '', dose_instructions: '', times: ['08:00'], ongoing: false, duration_days: 7, confidence: null, note: null };
}
function fromScan(m: ScannedMedicine): Draft {
  return {
    key: ++draftKey,
    drug_name: m.drug_name,
    dose_instructions: m.dose_instructions ?? '',
    times: m.times,
    ongoing: m.duration_days === null,
    duration_days: m.duration_days ?? 7,
    confidence: m.confidence,
    note: m.note,
  };
}

/** Shrink the photo before sending it: faster on mobile data, cheaper to read. */
async function preparePhoto(file: File): Promise<Photo> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('That file could not be opened as a photo.'));
      i.src = url;
    });
    const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    return { previewUrl: dataUrl, base64: dataUrl.split(',')[1], mediaType: 'image/jpeg' };
  } finally {
    URL.revokeObjectURL(url);
  }
}

const inputCls = 'w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 text-sm focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500';
const labelCls = 'block text-xs font-medium text-slate-300 mb-1';
const confidenceStyle = {
  high: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  medium: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  low: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
};

export const AddMedicines: React.FC<{ api: PatientApi; onSaved: () => void; onCancel?: () => void }> = ({ api, onSaved, onCancel }) => {
  const [step, setStep] = useState<'choose' | 'review'>('choose');
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [scanning, setScanning] = useState(false);
  const [info, setInfo] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [startDate, setStartDate] = useState(() => todayLocal());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const update = (key: number, patch: Partial<Draft>) => setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  const onPhoto = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    setInfo('');
    setWarnings([]);
    let p: Photo;
    try { p = await preparePhoto(file); } catch (e) { setError(e instanceof Error ? e.message : 'Could not open the photo'); return; }
    setPhoto(p);
    setScanning(true);
    try {
      const r = await api.scan(p.base64, p.mediaType);
      setWarnings(r.warnings);
      if (!r.is_prescription || r.medicines.length === 0) {
        setInfo("We couldn't read any medicines from this photo. Type them in below, or try a clearer photo.");
        setDrafts([blankDraft()]);
      } else {
        setInfo(`We read ${r.medicines.length} medicine(s). Check each one against your prescription before saving.`);
        setDrafts(r.medicines.map(fromScan));
      }
    } catch (e) {
      // 503 = photo reading not switched on; 502 = reading failed. Either way: type it in, photo stays visible.
      setInfo(e instanceof ApiError ? e.message : 'Photo reading failed. Type your medicines in below; your photo stays on screen to help.');
      setDrafts([blankDraft()]);
    } finally {
      setScanning(false);
      setStep('review');
    }
  };

  const save = async () => {
    setError('');
    for (const [i, d] of drafts.entries()) {
      const label = d.drug_name.trim() || `Medicine ${i + 1}`;
      if (!d.drug_name.trim()) { setError(`Medicine ${i + 1}: enter the medicine name.`); return; }
      const problem = timesProblem(d.times);
      if (problem) { setError(`${label}: ${problem}.`); return; }
      if (!d.ongoing && (!d.duration_days || d.duration_days < 1)) { setError(`${label}: enter how many days, or tick "Every day, no end date".`); return; }
    }
    setSaving(true);
    try {
      for (const d of drafts) {
        await api.addPrescription({
          drug_name: d.drug_name.trim(),
          dose_instructions: d.dose_instructions.trim() || undefined,
          times: [...d.times].sort(),
          start_date: startDate,
          duration_days: d.ongoing ? null : d.duration_days,
        });
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const hiddenInput = (
    <input ref={fileRef} type="file" accept="image/*" capture="environment" className="sr-only" aria-label="Prescription photo"
      onChange={(e) => { onPhoto(e.target.files?.[0]); e.target.value = ''; }} />
  );

  if (step === 'choose') {
    return (
      <section aria-labelledby="add-h" className="bg-slate-900/90 border border-emerald-500/30 rounded-2xl p-5 shadow-xl space-y-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 id="add-h" className="text-sm font-bold text-slate-100 font-heading">Add your medicines</h3>
            <p className="text-xs text-slate-400">Use the prescription paper your hospital gave you.</p>
          </div>
          {onCancel && <button onClick={onCancel} aria-label="Close" className="p-1 text-slate-400 hover:text-slate-200"><X className="w-4 h-4" /></button>}
        </div>
        {hiddenInput}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button onClick={() => fileRef.current?.click()} disabled={scanning}
            className="p-4 rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-600/20 border border-emerald-500/40 hover:border-emerald-400 text-left space-y-1 disabled:opacity-50">
            {scanning ? <Loader2 className="w-6 h-6 text-emerald-300 animate-spin" /> : <Camera className="w-6 h-6 text-emerald-300" />}
            <p className="text-sm font-semibold text-slate-100">{scanning ? 'Reading your prescription…' : 'Take a photo of it'}</p>
            <p className="text-[11px] text-slate-400">We read the medicines and suggest times. You check everything before saving.</p>
          </button>
          <button onClick={() => { setDrafts([blankDraft()]); setStep('review'); }} disabled={scanning}
            className="p-4 rounded-xl bg-slate-950 border border-slate-800 hover:border-slate-600 text-left space-y-1 disabled:opacity-50">
            <Keyboard className="w-6 h-6 text-slate-300" />
            <p className="text-sm font-semibold text-slate-100">Type it in</p>
            <p className="text-[11px] text-slate-400">Enter each medicine and the times you take it.</p>
          </button>
        </div>
        {error && <p role="alert" className="text-xs text-amber-300">{error}</p>}
        <p className="text-[11px] text-slate-500">Photos are sent securely to be read and are not kept by MediAlert.</p>
      </section>
    );
  }

  return (
    <section aria-labelledby="review-h" className="bg-slate-900/90 border border-emerald-500/30 rounded-2xl p-5 shadow-xl space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 id="review-h" className="text-sm font-bold text-slate-100 font-heading">Check your medicines</h3>
          <p className="text-xs text-slate-400">Compare every name, amount and time with your prescription. If anything is unclear, ask your pharmacist.</p>
        </div>
        {onCancel && <button onClick={onCancel} aria-label="Close" className="p-1 text-slate-400 hover:text-slate-200"><X className="w-4 h-4" /></button>}
      </div>
      {hiddenInput}

      {info && <p role="status" className="text-xs text-cyan-200 bg-cyan-500/10 border border-cyan-500/30 rounded-lg p-2.5">{info}</p>}
      {warnings.length > 0 && (
        <ul className="text-xs text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-lg p-2.5 space-y-1">
          {warnings.map((w) => <li key={w} className="flex gap-1.5"><AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />{w}</li>)}
        </ul>
      )}

      <div className={`grid gap-4 ${photo ? 'lg:grid-cols-5' : ''}`}>
        {photo && (
          <figure className="lg:col-span-2 space-y-2">
            <img src={photo.previewUrl} alt="Your prescription photo" className="w-full rounded-xl border border-slate-800 max-h-[28rem] object-contain bg-black" />
            <button type="button" onClick={() => fileRef.current?.click()} disabled={scanning}
              className="text-[11px] text-emerald-300 hover:underline flex items-center gap-1">
              {scanning ? <Loader2 className="w-3 h-3 animate-spin" /> : <ImageIcon className="w-3 h-3" />} Use a different photo
            </button>
          </figure>
        )}

        <div className={`space-y-3 ${photo ? 'lg:col-span-3' : ''}`}>
          {drafts.map((d, i) => {
            const title = d.drug_name.trim() || `Medicine ${i + 1}`;
            return (
              <div key={d.key} className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-bold text-emerald-300 truncate">{i + 1}. {title}</p>
                  <div className="flex items-center gap-2">
                    {d.confidence && (
                      <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${confidenceStyle[d.confidence]}`}>
                        {d.confidence === 'high' ? 'Read clearly' : d.confidence === 'medium' ? 'Please check' : 'Unclear: check carefully'}
                      </span>
                    )}
                    {drafts.length > 1 && (
                      <button type="button" onClick={() => setDrafts((ds) => ds.filter((x) => x.key !== d.key))} aria-label={`Remove ${title}`}
                        className="p-1 rounded-md text-rose-300 hover:bg-rose-500/10"><Trash2 className="w-3.5 h-3.5" /></button>
                    )}
                  </div>
                </div>
                {d.note && <p className="text-[11px] text-amber-200">{d.note}</p>}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor={`d${d.key}-n`} className={labelCls}>Medicine name</label>
                    <input id={`d${d.key}-n`} list="patient-medicines" value={d.drug_name} onChange={(e) => update(d.key, { drug_name: e.target.value })}
                      className={inputCls} placeholder="e.g. Amoxicillin 500mg" maxLength={120} required />
                  </div>
                  <div>
                    <label htmlFor={`d${d.key}-i`} className={labelCls}>How much to take</label>
                    <input id={`d${d.key}-i`} value={d.dose_instructions} onChange={(e) => update(d.key, { dose_instructions: e.target.value })}
                      className={inputCls} placeholder="e.g. 1 tablet after food" maxLength={200} />
                  </div>
                </div>
                <TimesEditor label={title} times={d.times} onChange={(times) => update(d.key, { times })} />
                <div className="flex flex-wrap items-end gap-3">
                  <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                    <input type="checkbox" checked={d.ongoing} onChange={(e) => update(d.key, { ongoing: e.target.checked })} className="accent-emerald-400" />
                    Every day, no end date
                  </label>
                  {!d.ongoing && (
                    <div>
                      <label htmlFor={`d${d.key}-days`} className={labelCls}>For how many days</label>
                      <input id={`d${d.key}-days`} type="number" min={1} max={3650} value={d.duration_days}
                        onChange={(e) => update(d.key, { duration_days: Number(e.target.value) })} className={`${inputCls} w-28`} />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          <datalist id="patient-medicines">{MEDICINE_SUGGESTIONS.map((m) => <option key={m} value={m} />)}</datalist>

          <button type="button" onClick={() => setDrafts((ds) => [...ds, blankDraft()])}
            className="w-full py-2.5 rounded-xl border border-dashed border-emerald-500/50 text-emerald-300 hover:bg-emerald-500/10 text-xs font-semibold flex items-center justify-center gap-1.5">
            <Plus className="w-4 h-4" /> Add another medicine
          </button>

          <div className="max-w-xs">
            <label htmlFor="d-start" className={labelCls}>Start date</label>
            <input id="d-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputCls} required />
          </div>

          {error && <p role="alert" className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg p-2.5">{error}</p>}

          <button type="button" onClick={save} disabled={saving || drafts.length === 0}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-bold flex items-center justify-center gap-2 disabled:opacity-50">
            <Save className="w-4 h-4" /> {saving ? 'Saving…' : `Save ${drafts.length} medicine${drafts.length === 1 ? '' : 's'} and start reminders`}
          </button>
        </div>
      </div>
    </section>
  );
};
