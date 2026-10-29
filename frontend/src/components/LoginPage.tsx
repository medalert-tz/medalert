import React, { useEffect, useState } from 'react';
import { ArrowRight, HeartPulse, KeyRound, Stethoscope, UserRound, Watch, Camera, ArrowLeft } from 'lucide-react';
import { authApi } from '../api';
import type { StoredSession } from '../types';

interface Props {
  onLoggedIn: (session: StoredSession, extra?: { newCode?: string }) => void;
}

const inputCls = 'w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 text-sm focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500';
const labelCls = 'block text-xs font-medium text-slate-300 mb-1';
const primaryBtn = 'w-full py-3 px-5 rounded-xl text-white font-semibold shadow-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50';

function errorText(e: unknown) {
  return e instanceof Error ? e.message : 'Something went wrong';
}

/** The front door: two portals side by side. */
export const LoginPage: React.FC<Props> = ({ onLoggedIn }) => (
  <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
    <header className="max-w-5xl w-full mx-auto px-4 pt-10 pb-6 text-center space-y-3">
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-cyan-500 to-indigo-600 flex items-center justify-center mx-auto shadow-lg shadow-cyan-500/20">
        <HeartPulse className="w-8 h-8 text-white" />
      </div>
      <h1 className="text-3xl font-extrabold font-heading">
        MEDI<span className="text-cyan-400">ALERT</span>
      </h1>
      <p className="text-sm text-slate-400 max-w-xl mx-auto">
        Medication reminders that keep patients on their full course, and early alerts for the clinic when someone is struggling.
      </p>
    </header>

    <main className="flex-1 max-w-5xl w-full mx-auto px-4 pb-10 grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
      <ClinicianPortalCard onLoggedIn={onLoggedIn} />
      <PatientPortalCard onLoggedIn={onLoggedIn} />
    </main>

    <footer className="text-center text-[11px] text-slate-500 pb-6 px-4">
      MVP demo: use synthetic (made-up) patients only until consent and ethics approval are in place.
    </footer>
  </div>
);

const Card: React.FC<{ icon: React.ReactNode; title: string; subtitle: string; accent: string; children: React.ReactNode }> = ({
  icon, title, subtitle, accent, children,
}) => (
  <section className={`bg-slate-900 border rounded-2xl p-6 shadow-2xl space-y-5 ${accent}`} aria-label={title}>
    <div className="flex items-center gap-3">
      {icon}
      <div>
        <h2 className="text-lg font-bold font-heading">{title}</h2>
        <p className="text-xs text-slate-400">{subtitle}</p>
      </div>
    </div>
    {children}
  </section>
);

// ---------- Clinician ----------

const ClinicianPortalCard: React.FC<Props> = ({ onLoggedIn }) => {
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    authApi.status().then((s) => setNeedsSetup(s.needs_setup)).catch(() => setNeedsSetup(false));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = needsSetup
        ? await authApi.setup({ username: username.trim(), display_name: displayName.trim(), password })
        : await authApi.login(username.trim(), password);
      onLoggedIn({ kind: 'clinician', token: r.token, name: r.clinician.display_name });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      accent="border-cyan-500/30"
      icon={<div className="w-12 h-12 rounded-xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-300"><Stethoscope className="w-6 h-6" /></div>}
      title="Clinician portal"
      subtitle="Prescribe, follow your patients' progress, work the nurse queue"
    >
      <form onSubmit={submit} className="space-y-4">
        {needsSetup && (
          <p className="text-xs text-cyan-200 bg-cyan-500/10 border border-cyan-500/30 rounded-lg p-2.5">
            First time here: create the first clinician account. You can add colleagues after logging in.
          </p>
        )}
        {needsSetup && (
          <div>
            <label htmlFor="c-name" className={labelCls}>Your name (shown on prescriptions)</label>
            <input id="c-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} className={inputCls} placeholder="e.g. Dr. Amina Juma" required maxLength={120} />
          </div>
        )}
        <div>
          <label htmlFor="c-user" className={labelCls}>Username</label>
          <input id="c-user" value={username} onChange={(e) => setUsername(e.target.value)} className={inputCls}
            autoComplete="username" placeholder="e.g. dr.amina" required pattern="[A-Za-z0-9._\-]{3,64}"
            title="3-64 letters, numbers, dots, dashes or underscores" />
        </div>
        <div>
          <label htmlFor="c-pass" className={labelCls}>Password</label>
          <input id="c-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls}
            autoComplete={needsSetup ? 'new-password' : 'current-password'} required minLength={needsSetup ? 8 : 1} />
          {needsSetup && <p className="text-[11px] text-slate-500 mt-1">At least 8 characters.</p>}
        </div>
        {error && <p role="alert" className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg p-2.5">{error}</p>}
        <button type="submit" disabled={busy || needsSetup === null}
          className={`${primaryBtn} bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 shadow-cyan-500/25`}>
          <span>{busy ? 'Please wait…' : needsSetup ? 'Create account and log in' : 'Log in as clinician'}</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </form>
    </Card>
  );
};

// ---------- Patient ----------

const PatientPortalCard: React.FC<Props> = ({ onLoggedIn }) => {
  const [mode, setMode] = useState<'code' | 'register'>('code');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (mode === 'code') {
        const r = await authApi.patientLogin(code.trim());
        onLoggedIn({ kind: 'patient', token: r.token, name: r.patient.display_name });
      } else {
        const r = await authApi.patientRegister(name.trim());
        onLoggedIn({ kind: 'patient', token: r.token, name: r.patient.display_name }, { newCode: r.access_code });
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      accent="border-emerald-500/30"
      icon={<div className="w-12 h-12 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-300"><UserRound className="w-6 h-6" /></div>}
      title="Patient portal"
      subtitle="See your medicines and reminders on your watch"
    >
      <form onSubmit={submit} className="space-y-4">
        {mode === 'code' ? (
          <>
            <div>
              <label htmlFor="p-code" className={labelCls}>Your patient code</label>
              <div className="relative">
                <KeyRound className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden />
                <input id="p-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())}
                  className={`${inputCls} pl-9 font-mono tracking-widest uppercase`} placeholder="XXXX-XXXX" required
                  autoComplete="one-time-code" autoCapitalize="characters" maxLength={20} />
              </div>
              <p className="text-[11px] text-slate-500 mt-1">Your clinic gives you this code when they prescribe your medicine.</p>
            </div>
            {error && <p role="alert" className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg p-2.5">{error}</p>}
            <button type="submit" disabled={busy}
              className={`${primaryBtn} bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 shadow-emerald-500/25`}>
              <Watch className="w-4 h-4" />
              <span>{busy ? 'Please wait…' : 'Open my watch'}</span>
            </button>

            <div className="pt-4 border-t border-slate-800 space-y-2">
              <p className="text-xs text-slate-300 font-semibold">My hospital doesn't use MediAlert yet</p>
              <p className="text-[11px] text-slate-400">
                Set up your own reminders. Take a photo of the prescription you were given, or type it in.
              </p>
              <button type="button" onClick={() => { setMode('register'); setError(''); }}
                className="w-full py-2.5 rounded-xl border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10 text-sm font-semibold flex items-center justify-center gap-2">
                <Camera className="w-4 h-4" /> Set up my own schedule
              </button>
            </div>
          </>
        ) : (
          <>
            <button type="button" onClick={() => { setMode('code'); setError(''); }}
              className="text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1">
              <ArrowLeft className="w-3.5 h-3.5" /> I have a code from my clinic
            </button>
            <div>
              <label htmlFor="p-name" className={labelCls}>Your first name</label>
              <input id="p-name" value={name} onChange={(e) => setName(e.target.value)} className={inputCls}
                placeholder="e.g. Rehema" required maxLength={120} autoComplete="given-name" />
              <p className="text-[11px] text-slate-500 mt-1">
                Next you'll add your medicines. We'll give you a code so you can open your reminders on another phone.
              </p>
            </div>
            {error && <p role="alert" className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg p-2.5">{error}</p>}
            <button type="submit" disabled={busy}
              className={`${primaryBtn} bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 shadow-emerald-500/25`}>
              <span>{busy ? 'Please wait…' : 'Continue'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </>
        )}
      </form>
    </Card>
  );
};
