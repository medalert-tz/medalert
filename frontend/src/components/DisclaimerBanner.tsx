import React, { useState } from 'react';
import { Info, ChevronDown, ChevronUp, Cpu, Server, Lock, Radio, Brain } from 'lucide-react';

const ITEMS = [
  { Icon: Server, title: 'Backend & data', text: 'Real: prescriptions, dispensing, dose schedule, missed-dose detection and the nurse queue run on the MediAlert server (SQLite now, PostgreSQL for the pilot).' },
  { Icon: Brain, title: 'Risk prediction', text: 'A transparent baseline score with reasons. A trained model replaces it once external and pilot data are ready.' },
  { Icon: Cpu, title: 'Wearable hardware', text: 'Simulated here. The watch uses the same two-call device protocol a real low-cost device would.' },
  { Icon: Radio, title: 'Connectivity', text: 'Undecided (GSM/SMS, LoRa or a Bluetooth hub). Whichever bridge is chosen talks to the same API.' },
  { Icon: Lock, title: 'Security & privacy', text: 'Clinician accounts with hashed passwords, one-time patient codes and per-device tokens. Audit log, roles and Tanzania PDPA registration come before the pilot.' },
];

export const DisclaimerBanner: React.FC = () => {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-slate-900/90 border-t border-slate-800 text-slate-300 py-3 px-4 text-xs font-sans mt-6">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-3">
        <div className="flex items-center space-x-2 text-cyan-400">
          <Info className="w-4 h-4 flex-shrink-0" />
          <span className="font-semibold text-slate-200">MEDIALERT MVP:</span>
          <span className="text-slate-400 hidden sm:inline">Live backend, simulated wearable. Demo data only — not for real patients yet.</span>
        </div>
        <button onClick={() => setOpen(!open)} aria-expanded={open}
          className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-950 border border-slate-800 hover:border-slate-700 text-[11px] text-cyan-300 font-medium">
          <span>What's real vs simulated</span>
          {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      </div>
      {open && (
        <div className="max-w-7xl mx-auto mt-3 pt-3 border-t border-slate-800/80 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 text-[11px]">
          {ITEMS.map(({ Icon, title, text }) => (
            <div key={title} className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
              <div className="flex items-center gap-1.5 text-cyan-400 font-bold"><Icon className="w-3.5 h-3.5" /><span>{title}</span></div>
              <p className="text-slate-400 leading-tight">{text}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
