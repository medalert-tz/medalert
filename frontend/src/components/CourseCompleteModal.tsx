import React, { useEffect, useRef } from 'react';
import confetti from 'canvas-confetti';
import { MediPalMascot } from './MediPalMascot';
import { Trophy, Sparkles, Star } from 'lucide-react';
import type { Course } from '../types';

interface CourseCompleteModalProps {
  firstName: string;
  course: Course;
  onClose: () => void;
}

export const CourseCompleteModal: React.FC<CourseCompleteModalProps> = ({ firstName, course, onClose }) => {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);

    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return () => window.removeEventListener('keydown', onKey);
    const end = Date.now() + 3000;
    const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 1000 };
    const t = setInterval(() => {
      const left = end - Date.now();
      if (left <= 0) return clearInterval(t);
      const particleCount = 50 * (left / 3000);
      confetti({ ...defaults, particleCount, origin: { x: 0.2, y: 0.5 } });
      confetti({ ...defaults, particleCount, origin: { x: 0.8, y: 0.5 } });
    }, 250);
    return () => { clearInterval(t); window.removeEventListener('keydown', onKey); };
  }, [onClose]);

  const total = course.doses_total ?? course.doses_resolved;
  const allTaken = course.doses_taken === total;

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="complete-h" className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
      <div className="bg-gradient-to-b from-slate-900 via-slate-900 to-slate-950 border border-amber-500/40 rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl text-center space-y-6 relative overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-64 h-64 bg-amber-500/15 rounded-full blur-3xl pointer-events-none" />

        <div className="relative inline-flex items-center justify-center">
          <div className="w-20 h-20 rounded-3xl bg-gradient-to-tr from-amber-400 to-yellow-300 p-0.5 shadow-xl shadow-amber-500/25">
            <div className="w-full h-full bg-slate-950 rounded-[22px] flex items-center justify-center text-amber-400">
              <Trophy className="w-10 h-10 animate-bounce" />
            </div>
          </div>
          <Star className="w-6 h-6 text-amber-300 absolute -top-2 -right-2 animate-pulse fill-amber-300" />
        </div>

        <div className="space-y-1">
          <span className="px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-bold uppercase tracking-wider">🎉 Course Complete!</span>
          <h2 id="complete-h" className="text-2xl font-extrabold text-slate-100 font-heading pt-2">Congratulations, {firstName}!</h2>
          <p className="text-xs text-slate-400">You finished your course of {course.label}.</p>
        </div>

        <div className="bg-slate-950/90 rounded-2xl p-4 border border-slate-800 flex items-center space-x-4 text-left">
          <MediPalMascot mood="celebrate" size="md" />
          <div>
            <h3 className="text-xs font-bold text-amber-300 flex items-center gap-1">MediPal Says: <Sparkles className="w-3.5 h-3.5 text-amber-400" /></h3>
            <p className="text-xs text-slate-300 mt-0.5 leading-relaxed">
              {allTaken
                ? '"Outstanding work — every dose taken! Your clinic can see your full record."'
                : '"You reached the end of your course. Your clinic can see which doses were missed and may check in."'}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
            <span className="text-slate-400 block text-[11px]">Doses Taken</span>
            <span className="text-emerald-400 font-extrabold text-lg font-mono">{course.doses_taken} / {total}</span>
          </div>
          <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
            <span className="text-slate-400 block text-[11px]">Course Days</span>
            <span className="text-amber-400 font-extrabold text-lg font-mono">{course.days_total ?? course.day} Days</span>
          </div>
        </div>

        <button ref={closeRef} onClick={onClose}
          className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-600 hover:from-amber-400 hover:to-yellow-500 text-slate-950 font-bold text-xs shadow-lg shadow-amber-500/20">
          Close
        </button>
      </div>
    </div>
  );
};
