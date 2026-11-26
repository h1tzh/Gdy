import { useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'gdy-reminders';

function loadPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    return { sound: saved?.sound !== false, vibration: saved?.vibration !== false };
  } catch { return { sound: true, vibration: true }; }
}

const tones = {
  turn: [[0, 660], [.1, 880]],
  warning: [[0, 520]],
  nudge: [[0, 880], [.09, 660]],
} as const;

function chime(context: AudioContext, kind: keyof typeof tones, delay = 0) {
  const now = context.currentTime + delay;
  for (const [offset, frequency] of tones[kind]) {
    const time = now + offset;
    const tone = context.createOscillator();
    const level = context.createGain();
    tone.type = 'sine';
    tone.frequency.value = frequency;
    level.gain.setValueAtTime(0, time);
    level.gain.linearRampToValueAtTime(kind === 'warning' ? .075 : .12, time + .015);
    level.gain.exponentialRampToValueAtTime(.001, time + .15);
    tone.connect(level).connect(context.destination);
    tone.start(time);
    tone.stop(time + .16);
  }
}

export function useTurnReminders(turn: string | null, seconds: number, nudges: number) {
  const [preferences, setPreferences] = useState(loadPreferences);
  const audio = useRef<AudioContext | null>(null);
  const lastTurn = useRef<string | null>(null);
  const lastWarning = useRef<{ turn: string; second: number } | null>(null);
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
    if (!turn || seconds <= 0) return;
    const started = lastTurn.current !== turn;
    const warning = seconds <= 5 && (lastWarning.current?.turn !== turn || seconds < lastWarning.current.second);
    const nudge = `${turn}:${nudges}`;
    const nudged = nudges > 0 && lastNudge.current !== nudge;
    if (started) lastTurn.current = turn;
    if (warning) lastWarning.current = { turn, second: seconds };
    if (nudged) lastNudge.current = nudge;
    if (document.hidden) return;

    if (preferences.sound && audio.current?.state === 'running') {
      if (warning) chime(audio.current, 'warning');
      else if (started) chime(audio.current, 'turn');
      if (nudged) chime(audio.current, 'nudge', warning ? .16 : started ? .26 : 0);
    }
    if (preferences.vibration) {
      if (nudged) navigator.vibrate?.([100, 65, 100]);
      else if (started) navigator.vibrate?.(120);
    }
  }, [turn, seconds, nudges, preferences]);

  function updatePreference(key: keyof typeof preferences, enabled: boolean) {
    if (key === 'sound' && enabled) unlockAudio();
    const next = { ...preferences, [key]: enabled };
    setPreferences(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* Settings still apply to this page. */ }
  }

  return { preferences, updatePreference };
}
