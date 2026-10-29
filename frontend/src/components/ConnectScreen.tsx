import React, { useState } from 'react';
import { KeyRound, ArrowRight, HeartPulse } from 'lucide-react';

interface Props {
  initialKey: string;
  onConnect: (key: string) => Promise<void>;
}

/** Clinic sign-in. MVP uses the shared clinic API key from the server's .env file;
 *  per-user accounts come before the pilot. */
export const ConnectScreen: React.FC<Props> = ({ initialKey, onConnect }) => {
  const [key, setKey] = useState(initialKey);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onConnect(key.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not connect');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <form onSubmit={submit} className="bg-slate-900 border border-slate-800 rounded-2xl p-8 max-w-md w-full shadow-2xl space-y-6">
        <div className="text-center space-y-3">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-cyan-500 to-indigo-600 flex items-center justify-center mx-auto shadow-lg shadow-cyan-500/20">
            <HeartPulse className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-100 font-heading">
            MEDI<span className="text-cyan-400">ALERT</span> Clinic Portal
          </h1>
          <p className="text-sm text-slate-400">Enter the clinic API key to open the workstation.</p>
        </div>

        <div>
          <label htmlFor="api-key" className="block text-xs font-medium text-slate-300 mb-1">Clinic API key</label>
          <div className="relative">
            <KeyRound className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden />
            <input
              id="api-key"
              type="password"
              autoComplete="off"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              required
              className="w-full pl-9 pr-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 text-sm focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
            />
          </div>
          <p className="text-[11px] text-slate-500 mt-1.5">It's the <code className="text-cyan-400">MEDALERT_API_KEY</code> value in the server's <code className="text-cyan-400">.env</code> file.</p>
        </div>

        {error && <p role="alert" className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg p-2.5">{error}</p>}

        <button
          type="submit"
          disabled={busy || !key.trim()}
          className="w-full py-3.5 px-6 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-semibold shadow-lg shadow-cyan-500/25 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
        >
          <span>{busy ? 'Connecting…' : 'Connect'}</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
};
