import React from 'react';
import type { DemoStatus, WatchShape } from '../types';
import { Bell, FastForward, Trophy, RefreshCw, Smartphone, Sparkles, CalendarX } from 'lucide-react';

interface DemoControlsProps {
  demo: DemoStatus | null;
  hasPatient: boolean;
  isOngoing: boolean;
  onTriggerNextReminder: () => void;
  onAdvanceOneDose?: () => void;
  onSkipDay: () => void;
  onCompleteCourse: () => void;
  onResetDemo: () => void;
  watchShape?: WatchShape;
  setWatchShape?: (shape: WatchShape) => void;
}

/** Demo time controls. They move the server's clock forward, so every real rule
 *  (reminder windows, missed doses, risk, nurse alerts) runs as it would in time. */
export const DemoControls: React.FC<DemoControlsProps> = ({
  demo, hasPatient, isOngoing, onTriggerNextReminder, onAdvanceOneDose, onSkipDay, onCompleteCourse, onResetDemo,
  watchShape, setWatchShape,
}) => {
  const enabled = !!demo?.enabled;
  const offsetH = demo ? demo.offset_minutes / 60 : 0;
  const btn = 'px-3 py-2 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all disabled:opacity-40 disabled:cursor-not-allowed';

  return (
    <aside aria-label="Demo controls" className="sticky bottom-4 z-40 max-w-5xl mx-auto px-4 w-full">
      <div className="bg-slate-900/95 border border-cyan-500/40 rounded-2xl p-3 shadow-2xl backdrop-blur-xl flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 rounded-xl bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
            <Sparkles className="w-4 h-4 animate-spin-slow" />
          </div>
          <div>
            <span className="font-bold text-slate-100 font-heading block text-xs">Demo Time Controls</span>
            <span className="text-[10px] text-slate-400">
              {enabled
                ? offsetH > 0 ? `Server clock is ${offsetH >= 48 ? `${(offsetH / 24).toFixed(1)} days` : `${offsetH.toFixed(1)} h`} ahead` : 'Server clock = real time'
                : 'Off — start the server with MEDALERT_DEMO_MODE=1'}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button disabled={!enabled || !hasPatient} onClick={onTriggerNextReminder}
            className={`${btn} bg-cyan-600 hover:bg-cyan-500 text-white shadow-md shadow-cyan-600/25`}
            title="Move the clock to this patient's next dose time">
            <Bell className="w-3.5 h-3.5" /><span>Trigger Next Reminder</span>
          </button>
          {onAdvanceOneDose && (
            <button disabled={!enabled || !hasPatient} onClick={onAdvanceOneDose}
              className={`${btn} bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-600/25`}
              title="Move to the next dose and press Taken">
              <FastForward className="w-3.5 h-3.5" /><span>Log Next Dose</span>
            </button>
          )}
          <button disabled={!enabled} onClick={onSkipDay}
            className={`${btn} bg-rose-700 hover:bg-rose-600 text-white`}
            title="Let a whole day pass with no button presses (shows risk + nurse alerts)">
            <CalendarX className="w-3.5 h-3.5" /><span>Skip a Day</span>
          </button>
          <button disabled={!enabled || !hasPatient || isOngoing} onClick={onCompleteCourse}
            className={`${btn} bg-gradient-to-r from-amber-500 to-yellow-600 hover:from-amber-400 hover:to-yellow-500 text-slate-950 font-extrabold`}
            title={isOngoing ? 'Ongoing regimens have no end' : 'Take every remaining dose of this course'}>
            <Trophy className="w-3.5 h-3.5" /><span>Jump to Complete</span>
          </button>
          {setWatchShape && (
            <button onClick={() => setWatchShape(watchShape === 'round' ? 'square' : 'round')}
              className={`${btn} bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium border border-slate-700`}>
              <Smartphone className="w-3.5 h-3.5 text-cyan-400" /><span>{watchShape === 'round' ? 'Square Watch' : 'Round Watch'}</span>
            </button>
          )}
          <button disabled={!enabled} onClick={onResetDemo} aria-label="Reset demo data"
            className={`${btn} bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 font-medium border border-slate-700`}
            title="Delete all demo data and reset the clock">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </aside>
  );
};
