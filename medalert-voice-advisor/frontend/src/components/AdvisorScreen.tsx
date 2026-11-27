import React from 'react';
import { Lock, Mic, Square } from 'lucide-react';
import { FREE_QUESTION_LIMIT, useVoiceAdvisor, type AskAdvisor } from '../hooks/useVoiceAdvisor';
import { MediPalMascot } from './MediPalMascot';

const T = {
  en: {
    title: 'Ask MediPal',
    idle: 'Tap the mic and ask a question',
    listening: 'Listening…',
    thinking: 'Thinking…',
    speaking: 'Speaking…',
    error: 'Something went wrong',
    freeLeft: (n: number) => `${n} of ${FREE_QUESTION_LIMIT} free left`,
    unlimited: 'Unlimited',
    usedTitle: 'Free questions used',
    usedBody: `You've asked ${FREE_QUESTION_LIMIT} questions. Upgrade to keep talking to MediPal.`,
    upgrade: 'Upgrade (demo, no charge)',
    close: 'Close',
    unsupported: "Voice isn't supported in this browser. Use Chrome or Edge.",
    note: 'General guidance only, not a diagnosis.',
  },
  sw: {
    title: 'Muulize MediPal',
    idle: 'Gusa maikrofoni uulize swali',
    listening: 'Inasikiliza…',
    thinking: 'Inafikiri…',
    speaking: 'Inaongea…',
    error: 'Hitilafu imetokea',
    freeLeft: (n: number) => `Maswali ${n} kati ya ${FREE_QUESTION_LIMIT} yamebaki`,
    unlimited: 'Bila kikomo',
    usedTitle: 'Maswali ya bure yameisha',
    usedBody: `Umeuliza maswali ${FREE_QUESTION_LIMIT}. Boresha ili uendelee kuzungumza na MediPal.`,
    upgrade: 'Boresha (onyesho, hakuna malipo)',
    close: 'Funga',
    unsupported: 'Sauti haitumiki kwenye kivinjari hiki. Tumia Chrome au Edge.',
    note: 'Ushauri wa jumla tu, si utambuzi.',
  },
} as const;

interface AdvisorScreenProps {
  onAsk: AskAdvisor;
  onClose: () => void;
}

export const AdvisorScreen: React.FC<AdvisorScreenProps> = ({ onAsk, onClose }) => {
  const a = useVoiceAdvisor(onAsk);
  const t = T[a.lang];
  const busy = a.phase === 'listening' || a.phase === 'thinking' || a.phase === 'speaking';

  const close = () => {
    a.stopAll();
    onClose();
  };

  if (a.locked) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 text-center px-1">
        <Lock className="w-7 h-7 text-cyan-300" aria-hidden />
        <p className="text-xs font-bold text-slate-100">{t.usedTitle}</p>
        <p className="text-[10px] text-slate-400 leading-snug">{t.usedBody}</p>
        <button onClick={a.unlock} className="w-full py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-bold text-[11px]">
          {t.upgrade}
        </button>
        <button onClick={close} className="text-[10px] text-slate-400 hover:text-slate-200 underline">{t.close}</button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col justify-between py-1 text-center">
      <div className="flex items-center justify-between text-[10px] text-slate-400">
        <span className="flex items-center gap-1">
          {(['en', 'sw'] as const).map((l) => (
            <button
              key={l}
              onClick={() => a.setLang(l)}
              aria-pressed={a.lang === l}
              aria-label={l === 'en' ? 'English' : 'Kiswahili'}
              className={`rounded-full px-2 py-0.5 font-bold ${a.lang === l ? 'bg-cyan-500 text-white' : 'bg-slate-800 text-slate-300'}`}
            >
              {l.toUpperCase()}
            </button>
          ))}
        </span>
        <span>{a.unlocked ? t.unlimited : t.freeLeft(a.remaining)}</span>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center gap-1.5 overflow-y-auto py-1" aria-live="polite">
        {!a.transcript && !a.answer && !a.error && (
          <>
            <MediPalMascot mood={a.phase === 'thinking' ? 'pulse' : 'happy'} size="sm" />
            <p className="text-xs font-bold text-slate-100">{t.title}</p>
            <p className="text-[10px] text-slate-400">{a.supported ? t[a.phase] : t.unsupported}</p>
          </>
        )}
        {(a.phase === 'listening' || a.phase === 'speaking') && (
          <div className="flex h-6 items-center justify-center gap-1" aria-hidden>
            {[0, 1, 2, 3, 4, 5, 6].map((i) => (
              <span key={i} className="advisor-wave-bar" style={{ animationDelay: `${i * 0.11}s` }} />
            ))}
          </div>
        )}
        {a.transcript && <p className="text-[11px] font-medium text-slate-100 leading-snug">“{a.transcript}”</p>}
        {a.answer && (
          <p className="rounded-xl bg-slate-900/90 border border-cyan-500/30 p-2 text-left text-[11px] text-slate-200 leading-snug">{a.answer}</p>
        )}
        {a.error && <p className="text-[10px] text-amber-300 leading-snug">{a.error}</p>}
      </div>

      <div className="flex items-center justify-between">
        <button onClick={close} className="w-12 text-left text-[10px] text-slate-400 hover:text-slate-200 underline">{t.close}</button>
        <button
          onClick={busy ? a.stopAll : a.startListening}
          disabled={!a.supported}
          aria-label={busy ? 'Stop' : 'Ask a question'}
          className={`w-12 h-12 grid place-items-center rounded-full bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-md shadow-cyan-500/30 disabled:opacity-50 ${a.phase === 'listening' ? 'advisor-mic-ripple' : ''}`}
        >
          {busy ? <Square className="w-4 h-4" /> : <Mic className="w-5 h-5" />}
        </button>
        <span className="w-12 text-right text-[9px] text-slate-500 leading-tight">{a.phase === 'idle' || a.phase === 'error' ? t.note : t[a.phase]}</span>
      </div>
    </div>
  );
};
