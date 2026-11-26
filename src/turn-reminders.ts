import { useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'gdy-reminders';

function loadPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    return { sound: saved?.sound !== false, vibration: saved?.vibration !== false };
  } catch { return { sound: true, vibration: true }; }
}

function chime(context: AudioContext) {
  const now = context.currentTime;
  for (const [offset, frequency] of [[0, 660], [.1, 880]]) {
    const time = now + offset;
    const tone = context.createOscillator();
    const level = context.createGain();
    tone.type = 'sine';
    tone.frequency.value = frequency;
    level.gain.setValueAtTime(0, time);
    level.gain.linearRampToValueAtTime(.12, time + .015);
    level.gain.exponentialRampToValueAtTime(.001, time + .15);
    tone.connect(level).connect(context.destination);
    tone.start(time);
    tone.stop(time + .16);
  }
}

export function useTurnReminders(turn: string | null, nudges: number) {
  const [preferences, setPreferences] = useState(loadPreferences);
  const audio = useRef<AudioContext | null>(null);
  const lastTurn = useRef<string | null>(null);
  const lastNudge = useRef<string | null>(null);

  function unlockAudio() {
    if (!window.AudioContext) return;
    try {
      const context = audio.current ??= new AudioContext();
      if (context.state !== 'running') void context.resume().catch(() => {});
    } catch { /* Audio can be blocked by browser settings. */ }
  }

  useEffect(() => {
    if (!preferences.sound) return;
    // Browsers require a user gesture before a turn update can play audio.
    window.addEventListener('click', unlockAudio, true);
    window.addEventListener('keydown', unlockAudio, true);
    return () => {
      window.removeEventListener('click', unlockAudio, true);
      window.removeEventListener('keydown', unlockAudio, true);
    };
  }, [preferences.sound]);
  useEffect(() => () => {
    const context = audio.current;
    audio.current = null;
    if (context) void context.close().catch(() => {});
  }, []);

  useEffect(() => {
    if (!turn) return;
    if (lastTurn.current !== turn) {
      lastTurn.current = turn;
      if (!document.hidden) {
        if (preferences.sound && audio.current?.state === 'running') chime(audio.current);
        if (preferences.vibration) navigator.vibrate?.(120);
      }
    }
    const nudge = `${turn}:${nudges}`;
    if (nudges > 0 && lastNudge.current !== nudge) {
      lastNudge.current = nudge;
      if (preferences.vibration && !document.hidden) navigator.vibrate?.([100, 65, 100]);
    }
  }, [turn, nudges, preferences]);

  function updatePreference(key: keyof typeof preferences, enabled: boolean) {
    if (key === 'sound' && enabled) unlockAudio();
    const next = { ...preferences, [key]: enabled };
    setPreferences(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* Settings still apply to this page. */ }
  }

  return { preferences, updatePreference };
}
