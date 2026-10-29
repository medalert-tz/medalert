import React from 'react';
import { ActiveTab } from '../types';
import { Stethoscope, Watch, Columns, Wifi, ShieldCheck, HeartPulse } from 'lucide-react';

interface NavbarProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  synced: boolean;
  wearableSerial: string | null;
  facility: string | null;
}

const TABS: { id: ActiveTab; label: string; short: string; Icon: typeof Columns }[] = [
  { id: 'split', label: 'Split View (Side-by-Side)', short: 'Split', Icon: Columns },
  { id: 'clinician', label: 'Clinician View', short: 'Clinician', Icon: Stethoscope },
  { id: 'wearable', label: 'Wearable View', short: 'Wearable', Icon: Watch },
];

export const Navbar: React.FC<NavbarProps> = ({ activeTab, setActiveTab, synced, wearableSerial, facility }) => {
  return (
    <header className="sticky top-0 z-40 bg-slate-900/90 backdrop-blur-md border-b border-slate-800 text-slate-100 shadow-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 min-h-16 py-2 flex flex-wrap items-center justify-between gap-2">

        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-cyan-500/20 ring-1 ring-cyan-400/30">
            <HeartPulse className="w-6 h-6 text-white animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-xl tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white via-slate-100 to-cyan-400 font-heading">
                MEDI<span className="text-cyan-400">ALERT</span>
              </span>
              <span className="hidden md:inline px-2 py-0.5 text-[10px] uppercase font-bold tracking-wider rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/30">
                Wear the Reminder
              </span>
            </div>
            <p className="text-[11px] text-slate-400 hidden sm:block">Prescribe · Dispense · Monitor · Predict · Intervene</p>
          </div>
        </div>

        <nav aria-label="Views" className="flex items-center bg-slate-950 p-1.5 rounded-xl border border-slate-800 shadow-inner">
          {TABS.map(({ id, label, short, Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              aria-pressed={activeTab === id}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 ${
                activeTab === id
                  ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-md shadow-cyan-500/25'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span className="hidden lg:inline">{label}</span>
              <span className="lg:hidden">{short}</span>
            </button>
          ))}
        </nav>

        <div className="hidden lg:flex items-center space-x-3">
          <div className="flex items-center space-x-2 px-3 py-1 rounded-full bg-slate-950 border border-slate-800 text-xs">
            <span className={`w-2 h-2 rounded-full ${synced ? 'bg-emerald-400 animate-ping' : 'bg-amber-400'}`} />
            <Wifi className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-slate-300 font-mono text-[11px]">
              {wearableSerial ?? 'No watch'} ({synced ? 'Synced' : 'Not syncing'})
            </span>
          </div>
          <div className="flex items-center gap-1 text-[11px] text-emerald-400 bg-emerald-950/40 border border-emerald-500/30 px-2.5 py-1 rounded-full">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>{facility || 'Clinic workstation'}</span>
          </div>
        </div>

      </div>
    </header>
  );
};
