import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { ClientEvents, Profile, ReactionKind, Result, RoomView, RoundLimit, ServerEvents, Session, TableReaction } from '../shared/protocol.js';

const SESSION_KEY = 'gdy:seat';
const PROFILE_KEY = 'gdy:profile';
export const socket: Socket<ServerEvents, ClientEvents> = io({ autoConnect: false });

function read<T>(key: string): T | null {
  try { return JSON.parse((key === SESSION_KEY ? sessionStorage : localStorage).getItem(key) ?? 'null') as T | null; } catch { return null; }
}
function write(key: string, value: unknown) {
  try {
    const storage = key === SESSION_KEY ? sessionStorage : localStorage;
    if (value === null) storage.removeItem(key); else storage.setItem(key, JSON.stringify(value));
  } catch { /* Storage can be unavailable in private browsing. */ }
}

export function inviteCode() { return (new URL(location.href).searchParams.get('room') ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5); }
export function inviteLink(code: string) { return new URL(`?room=${encodeURIComponent(code)}`, location.href); }
export const loadProfile = () => read<Profile>(PROFILE_KEY);
export const saveProfile = (profile: Profile) => write(PROFILE_KEY, profile);

export function useGame() {
  const session = useRef<Session | null>(null);
  const busyRef = useRef(false);
  const [room, setRoom] = useState<RoomView | null>(null);
  const [reactions, setReactions] = useState<TableReaction[]>([]);
  const [online, setOnline] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function keep(value: Session) {
    session.current = value;
    write(SESSION_KEY, value);
    history.replaceState(null, '', inviteLink(value.code));
  }

  function clear() {
    session.current = null;
    write(SESSION_KEY, null);
    setRoom(null);
    const url = new URL(location.href);
    url.searchParams.delete('room');
    history.replaceState(null, '', url);
  }

  async function onConnect() {
    setOnline(true);
    setReady(false);
    if (session.current) {
      try {
        const reply = await socket.timeout(5000).emitWithAck('resume', session.current);
        if (reply.ok) { keep(reply.value); setError(''); }
        else { clear(); setError(reply.error); }
      } catch { setError('暂时无法恢复座位，请点击重连。'); return; }
    }
    setReady(true);
  }

  useEffect(() => {
    const saved = read<Session>(SESSION_KEY);
    if (saved && (!inviteCode() || saved.code === inviteCode())) session.current = saved;
    function onDisconnect() { setOnline(false); setReady(false); }
    function onRemoved(reason: string) {
      clear();
      setError(reason);
    }
    function onReaction(reaction: TableReaction) { setReactions((items) => [...items.slice(-7), reaction]); }
    socket.on('connect', onConnect).on('disconnect', onDisconnect).on('state', setRoom).on('removed', onRemoved).on('reaction', onReaction);
    socket.connect();
    return () => { socket.off('connect', onConnect).off('disconnect', onDisconnect).off('state', setRoom).off('removed', onRemoved).off('reaction', onReaction); socket.disconnect(); };
  }, []);

  async function act<T>(request: () => Promise<Result<T>>, onSuccess?: (value: T) => void) {
    if (busyRef.current) return;
    if (!socket.connected || !ready) { setError('连接尚未恢复，请稍后再试。'); return; }
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      const response = await request();
      if (response.ok) onSuccess?.(response.value);
      else setError(response.error);
    } catch { setError('服务器没有及时回应，请检查网络后重试。'); }
    finally { setBusy(false); busyRef.current = false; }
  }

  const request = () => socket.timeout(5000);
  return {
    room, online, ready, busy, error, setError, reactions,
    clearReaction: (id: string) => setReactions((items) => items.filter((item) => item.id !== id)),
    reconnect: () => { if (socket.connected) void onConnect(); else socket.connect(); },
    create: (profile: Profile, roundLimit: RoundLimit) => act(() => request().emitWithAck('create', { ...profile, roundLimit }), keep),
    practice: (profile: Profile, bots: number) => act(() => request().emitWithAck('practice', { ...profile, bots }), keep),
    join: (profile: Profile, code: string) => act(() => request().emitWithAck('join', { ...profile, code }), keep),
    profile: (profile: Profile, done: () => void) => act(() => request().emitWithAck('profile', profile), done),
    start: (revision: number) => act(() => request().emitWithAck('start', revision)),
    play: (revision: number, ids: string[], done: () => void) => act(() => request().emitWithAck('play', { revision, ids }), done),
    pass: (revision: number, done: () => void) => act(() => request().emitWithAck('pass', revision), done),
    autoplay: (enabled: boolean, done: () => void) => act(() => request().emitWithAck('autoplay', enabled), done),
    nudge: (revision: number) => act(() => request().emitWithAck('nudge', revision)),
    react: (to: string, kind: ReactionKind, done: () => void) => act(() => request().emitWithAck('react', { to, kind }), done),
    kick: (playerId: string, done: () => void) => act(() => request().emitWithAck('kick', playerId), done),
    leave: (done: () => void) => act(() => request().emitWithAck('leave'), () => { clear(); done(); }),
  };
}
