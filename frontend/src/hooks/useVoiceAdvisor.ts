import { useCallback, useEffect, useRef, useState } from 'react';
import type { AdvisorLang, ChatMsg } from '../types';

/**
 * Siri-style voice advisor: listen (browser SpeechRecognition) -> ask the server -> speak
 * (speechSynthesis). Free users get FREE_QUESTION_LIMIT questions; the unlock is a
 * simulated prototype paywall (no real payment).
 */
export const FREE_QUESTION_LIMIT = 5;
const STORAGE_KEY = 'medialert.advisor.v1';
const LANG_KEY = 'medialert.advisor.lang';
const SPEECH_LANG: Record<AdvisorLang, string> = { en: 'en-US', sw: 'sw-KE' };
const SYNTH_LANG: Record<AdvisorLang, string> = { en: 'en-US', sw: 'sw-TZ' };

const ERRORS = {
  en: {
    blocked: 'Microphone blocked. Allow mic access in the browser.',
    noSpeech: "I didn't hear anything. Tap the mic and try again.",
    voice: 'Voice error',
    failed: "I couldn't reach the AI advisor. Please try again.",
  },
  sw: {
    blocked: 'Maikrofoni imezuiwa. Ruhusu maikrofoni kwenye kivinjari.',
    noSpeech: 'Sikusikia chochote. Gusa maikrofoni ujaribu tena.',
    voice: 'Hitilafu ya sauti',
    failed: 'Sikuweza kumfikia mshauri wa AI. Tafadhali jaribu tena.',
  },
} as const;

export type AdvisorPhase = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';
export type AskAdvisor = (messages: ChatMsg[], lang: AdvisorLang) => Promise<string>;

type Usage = { used: number; unlocked: boolean };

// Minimal typings for the (often prefixed) Web Speech API.
type SpeechResultEvent = {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
};
type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: SpeechResultEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
type RecognitionCtor = new () => Recognition;

function getRecognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function loadUsage(): Usage {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Usage>;
      return { used: Number(p.used) || 0, unlocked: !!p.unlocked };
    }
  } catch { /* storage unavailable */ }
  return { used: 0, unlocked: false };
}

function saveUsage(u: Usage) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(u)); } catch { /* storage unavailable */ }
}

function loadLang(): AdvisorLang {
  try { return localStorage.getItem(LANG_KEY) === 'sw' ? 'sw' : 'en'; } catch { return 'en'; }
}

export function useVoiceAdvisor(askServer: AskAdvisor) {
  const [phase, setPhase] = useState<AdvisorPhase>('idle');
  const [transcript, setTranscript] = useState('');
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState('');
  const [usage, setUsage] = useState<Usage>(loadUsage);
  const [lang, setLangState] = useState<AdvisorLang>(loadLang);
  const [supported] = useState(() => !!getRecognitionCtor() && typeof window !== 'undefined' && 'speechSynthesis' in window);

  const langRef = useRef<AdvisorLang>(lang);
  const recRef = useRef<Recognition | null>(null);
  const historyRef = useRef<ChatMsg[]>([]);
  const usageRef = useRef(usage);
  usageRef.current = usage;
  const askRef = useRef(askServer);
  askRef.current = askServer;

  useEffect(() => () => {
    recRef.current?.abort();
    window.speechSynthesis?.cancel();
  }, []);

  const remaining = usage.unlocked ? Infinity : Math.max(0, FREE_QUESTION_LIMIT - usage.used);
  const locked = remaining === 0;

  const speak = useCallback((text: string) => {
    const synth = window.speechSynthesis;
    if (!synth) { setPhase('idle'); return; }
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const want = SYNTH_LANG[langRef.current];
    u.lang = want;
    const voice = synth.getVoices().find((v) => v.lang.toLowerCase().startsWith(want.slice(0, 2).toLowerCase()));
    if (voice) u.voice = voice;
    u.onend = () => setPhase('idle');
    u.onerror = () => setPhase('idle');
    setPhase('speaking');
    synth.speak(u);
  }, []);

  const ask = useCallback(async (question: string) => {
    const q = question.trim();
    if (!q) { setPhase('idle'); return; }
    setPhase('thinking');
    setError('');
    const messages: ChatMsg[] = [...historyRef.current, { role: 'user', content: q.slice(0, 500) }];
    try {
      const reply = await askRef.current(messages, langRef.current);
      historyRef.current = [...messages, { role: 'assistant' as const, content: reply.slice(0, 500) }].slice(-10);
      const next = { ...usageRef.current, used: usageRef.current.used + 1 };
      setUsage(next);
      saveUsage(next);
      setAnswer(reply);
      speak(reply);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : ERRORS[langRef.current].failed);
      setPhase('error');
    }
  }, [speak]);

  const startListening = useCallback(() => {
    if (usageRef.current.used >= FREE_QUESTION_LIMIT && !usageRef.current.unlocked) return;
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;
    window.speechSynthesis?.cancel();
    setTranscript('');
    setAnswer('');
    setError('');

    const rec = new Ctor();
    rec.lang = SPEECH_LANG[langRef.current];
    rec.interimResults = true;
    rec.continuous = false;
    let finalText = '';
    let failed = false;

    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      setTranscript((finalText + interim).trim());
    };
    rec.onerror = (e) => {
      failed = true;
      const t = ERRORS[langRef.current];
      setError(e.error === 'not-allowed' ? t.blocked : e.error === 'no-speech' ? t.noSpeech : `${t.voice}: ${e.error}`);
      setPhase('error');
    };
    rec.onend = () => {
      if (!failed) void ask(finalText);
    };
    recRef.current = rec;
    setPhase('listening');
    rec.start();
  }, [ask]);

  const setLang = useCallback((l: AdvisorLang) => {
    recRef.current?.abort();
    window.speechSynthesis?.cancel();
    langRef.current = l;
    setLangState(l);
    setPhase('idle');
    setTranscript('');
    setAnswer('');
    setError('');
    historyRef.current = [];
    try { localStorage.setItem(LANG_KEY, l); } catch { /* storage unavailable */ }
  }, []);

  const stopAll = useCallback(() => {
    recRef.current?.abort();
    window.speechSynthesis?.cancel();
    setPhase('idle');
  }, []);

  /** Simulated "payment": prototype only, no real charge. */
  const unlock = useCallback(() => {
    const next = { ...usageRef.current, unlocked: true };
    setUsage(next);
    saveUsage(next);
  }, []);

  return { phase, transcript, answer, error, supported, lang, setLang, remaining, locked, unlocked: usage.unlocked, startListening, stopAll, unlock };
}
