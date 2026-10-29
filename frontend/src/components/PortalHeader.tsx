import React from 'react';
import { HeartPulse, LogOut } from 'lucide-react';

interface Tab<T extends string> { id: T; label: string; Icon: React.ComponentType<{ className?: string }> }

interface Props<T extends string> {
  portal: string;
  userName: string;
  subtitle?: string | null;
  tabs?: Tab<T>[];
  activeTab?: T;
  onTab?: (t: T) => void;
  onLogout: () => void;
}

export function PortalHeader<T extends string>({ portal, userName, subtitle, tabs, activeTab, onTab, onLogout }: Props<T>) {
  return (
    <header className="sticky top-0 z-40 bg-slate-900/90 backdrop-blur-md border-b border-slate-800 text-slate-100 shadow-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 min-h-16 py-2 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <HeartPulse className="w-6 h-6 text-white" />
          </div>
          <div>
            <p className="font-extrabold text-lg tracking-tight font-heading leading-tight">
              MEDI<span className="text-cyan-400">ALERT</span>
              <span className="ml-2 text-xs font-semibold text-slate-400">{portal}</span>
            </p>
            <p className="text-[11px] text-slate-400">{subtitle ?? 'Prescribe · Dispense · Monitor · Predict · Intervene'}</p>
          </div>
        </div>

        {tabs && onTab && (
          <nav aria-label="Sections" className="flex items-center bg-slate-950 p-1.5 rounded-xl border border-slate-800 order-3 sm:order-none w-full sm:w-auto">
            {tabs.map(({ id, label, Icon }) => (
              <button key={id} onClick={() => onTab(id)} aria-pressed={activeTab === id}
                className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  activeTab === id
                    ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-md shadow-cyan-500/25'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}>
                <Icon className="w-3.5 h-3.5" />
                <span>{label}</span>
              </button>
            ))}
          </nav>
        )}

        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-300 hidden sm:inline">{userName}</span>
          <button onClick={onLogout}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-slate-200 flex items-center gap-1.5">
            <LogOut className="w-3.5 h-3.5" /> Log out
          </button>
        </div>
      </div>
    </header>
  );
}
