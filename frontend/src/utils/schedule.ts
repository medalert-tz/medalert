import type { DoseFeedbackMessage, WatchAction } from '../types';

/** All schedule times are interpreted in the clinic's time zone (matches the backend). */
export const CLINIC_TZ = 'Africa/Dar_es_Salaam';

/** Backend timestamps are naive UTC ("2026-10-12T05:00:00"). */
export function parseUtc(iso: string): Date {
  return new Date(/[zZ]|[+-]\d\d:\d\d$/.test(iso) ? iso : `${iso}Z`);
}

export function fmtTime(d: Date | string): string {
  const date = typeof d === 'string' ? parseUtc(d) : d;
  return date.toLocaleTimeString('en-US', { timeZone: CLINIC_TZ, hour: '2-digit', minute: '2-digit' });
}

export function fmtDay(d: Date | string): string {
  const date = typeof d === 'string' ? parseUtc(d) : d;
  return date.toLocaleDateString('en-GB', { timeZone: CLINIC_TZ, weekday: 'short', day: 'numeric', month: 'short' });
}

export function todayLocal(now: Date = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: CLINIC_TZ }); // YYYY-MM-DD
}

/** "20:00" -> "08:00 PM" */
export function hhmmTo12(t: string): string {
  const [h, m] = t.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  return `${String(((h + 11) % 12) + 1).padStart(2, '0')}:${String(m).padStart(2, '0')} ${suffix}`;
}

export const FREQUENCY_PRESETS: { label: string; times: string[] }[] = [
  { label: 'Once Daily (1x)', times: ['09:00'] },
  { label: 'Twice Daily (2x)', times: ['08:00', '20:00'] },
  { label: 'Three Times Daily (3x)', times: ['06:00', '14:00', '22:00'] },
];

export const MEDICINE_SUGGESTIONS = [
  'Amoxicillin 500mg', 'Azithromycin 250mg', 'Ciprofloxacin 500mg', 'Cephalexin 500mg', 'Doxycycline 100mg',
  'Amlodipine 5mg', 'Losartan 50mg', 'Hydrochlorothiazide 25mg', 'Metformin 500mg', 'Budesonide inhaler',
];

export const REMINDER_MICROCOPY_PHRASES = [
  "Time for your dose, {name} — you've got this! ✨",
  'Quick reminder, {name} — your dose is ready 💊',
  'Almost there, {name}! One step closer to feeling 100% 🌟',
  'Time for medicine, {name}! Your wearable has your back 🕒',
  'Friendly ping, {name}! Ready for your dose? 💧',
  "You're doing great, {name}! Time to take your medication 🛡️",
];

export function getRandomReminderMicrocopy(firstName: string): string {
  const i = Math.floor(Math.random() * REMINDER_MICROCOPY_PHRASES.length);
  return REMINDER_MICROCOPY_PHRASES[i].replace(/{name}/g, firstName);
}

export function getDoseFeedback(action: WatchAction, firstName: string): DoseFeedbackMessage {
  switch (action) {
    case 'taken':
      return {
        title: 'Dose Marked as Taken! ✨',
        message: `Great job, ${firstName}! Your wearable synced this dose to your clinic record.`,
        badgeColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
        mascotMood: 'cheering',
      };
    case 'snooze':
      return {
        title: 'Snoozed for 30 Mins ⏱️',
        message: `No worries, ${firstName}. We'll gently remind you again in 30 minutes!`,
        badgeColor: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
        mascotMood: 'calm',
      };
    case 'skipped':
      return {
        title: 'Dose Skipped 📋',
        message: "This dose was marked as skipped. If you're not sure what to do next, check your label or reach out to your clinician.",
        badgeColor: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
        mascotMood: 'supportive',
      };
    case 'missed':
      return {
        title: 'Dose Marked as Missed 🤝',
        message: "This dose was marked as missed. If you're not sure what to do next, check your label or reach out to your clinician.",
        badgeColor: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
        mascotMood: 'supportive',
      };
  }
}
