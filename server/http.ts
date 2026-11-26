import { createServer } from 'node:http';
import { randomInt, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import { MAX_PLAYERS, REACTIONS, ROUND_OPTIONS, type ClientEvents, type Result, type RoundLimit, type ServerEvents, type Session } from '../shared/protocol.js';
import { chooseMove } from './bot.js';
import { addPlayer, createRoom, GameError, normalizeProfile, passTurn, playCards, removePlayer, requireGame, sessionFor, startRound, viewFor, type Player, type Room } from './game.js';

const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const ROOM_TTL = 20 * 60_000;
const SEAT_TTL = 5 * 60_000;
const AUTO_DELAY = 850;

export function buildServer() {
  const app = express();
  app.disable('x-powered-by');
  app.get('/health', (_, res) => res.json({ ok: true }));
  app.use(express.static(fileURLToPath(new URL('../client/', import.meta.url))));
  const http = createServer(app);
  const io = new Server<ClientEvents, ServerEvents, Record<string, never>, { seat?: { room: Room; player: Player } }>(http, { maxHttpBufferSize: 8_192 });
  const rooms = new Map<string, Room>();
  const turnTimers = new Map<Room, { timer: NodeJS.Timeout; revision: number; quick: boolean }>();

  function publish(room: Room) {
    room.updated = Date.now();
    for (const player of room.players) {
      if (player.connection) io.to(player.connection).emit('state', viewFor(room, player));
    }
    scheduleTurn(room);
  }

  function scheduleTurn(room: Room) {
    const existing = turnTimers.get(room);
    const player = room.players.find((seat) => seat.id === room.turn);
    const active = player && room.phase === 'playing' && room.turnDeadline !== null && room.players.some((seat) => seat.connection);
    if (active) {
      const quick = player.bot || player.autoPlay;
      const revision = room.revision;
      if (existing?.revision === revision && existing.quick === quick) return;
      clearTimeout(existing?.timer);
      const remaining = Math.max(0, room.turnDeadline! - Date.now());
      const timer = setTimeout(() => {
        if (turnTimers.get(room)?.timer !== timer) return;
        turnTimers.delete(room);
        const ids = chooseMove(player.hand, room.lastPlay?.shape);
        if (ids.length) playCards(room, player, { revision, ids }, true);
        else passTurn(room, player, revision, true);
        publish(room);
      }, quick ? Math.min(AUTO_DELAY, remaining) : remaining).unref();
      turnTimers.set(room, { timer, revision, quick });
    } else if (existing) {
      clearTimeout(existing.timer);
      turnTimers.delete(room);
    }
  }

  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [code, room] of rooms) {
      if (room.players.every((seat) => !seat.connection)) {
        if (now - room.updated > ROOM_TTL) rooms.delete(code);
        continue;
      }
      const expired = room.players.filter((seat) => seat.offlineSince !== null && now - seat.offlineSince >= SEAT_TTL);
      for (const seat of expired) removePlayer(room, seat);
      if (expired.length) publish(room);
    }
  }, 15_000).unref();
  http.on('close', () => { clearInterval(cleanup); for (const { timer } of turnTimers.values()) clearTimeout(timer); turnTimers.clear(); });

  io.on('connection', (socket) => {
    let lastReaction = 0;
    function handle<T>(reply: (value: Result<T>) => void, action: () => T) {
      // Ignore malformed events without an acknowledgement callback.
      if (typeof reply !== 'function') return;
      try { reply({ ok: true, value: action() }); }
      catch (error) {
        if (!(error instanceof GameError)) console.error(error);
        reply({ ok: false, error: error instanceof GameError ? error.message : '服务器暂时忙，请再试一次。' });
      }
    }

    function bind(room: Room, player: Player): Session {
      socket.data.seat = { room, player };
      player.connection = socket.id;
      player.offlineSince = null;
      publish(room);
      return sessionFor(room, player);
    }

    function current() {
      const seat = socket.data.seat;
      requireGame(seat?.player.connection === socket.id, '你还没有加入牌桌。');
      return seat;
    }

    function openRoom(input: unknown, mode: Room['mode'], bots: number, roundLimit: RoundLimit | null) {
      requireGame(!socket.data.seat, '请先离开当前牌桌。');
      const normalized = normalizeProfile(input);
      requireGame(rooms.size < 500, '牌馆暂时满座，请稍后再试。');
      let code: string;
      do { code = Array.from({ length: 5 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join(''); } while (rooms.has(code));
      const room = createRoom(code, mode, roundLimit);
      const player = addPlayer(room, normalized, socket.id);
      if (mode === 'practice') {
        const names = ['小满', '阿栗', '团子', '皮皮', '橘宝'];
        for (let i = 0; i < bots; i++) addPlayer(room, { name: names[i], avatar: randomInt(2 ** 32) }, null);
        startRound(room, player, room.revision);
      }
      rooms.set(code, room);
      return bind(room, player);
    }
    socket.on('create', (profile, reply) => handle(reply, () => {
      const limit = profile?.roundLimit === undefined ? 5 : profile.roundLimit;
      requireGame(ROUND_OPTIONS.includes(limit), '请选择 1、5、10 或 20 局。');
      return openRoom(profile, 'friends', 0, limit);
    }));
    socket.on('practice', (data, reply) => handle(reply, () => {
      requireGame(Number.isInteger(data?.bots) && data.bots >= 1 && data.bots < MAX_PLAYERS, '请选择 1–5 个机器人。');
      return openRoom(data, 'practice', data.bots, null);
    }));
    socket.on('join', (data, reply) => handle(reply, () => {
      requireGame(!socket.data.seat, '请先离开当前牌桌。');
      const code = typeof data?.code === 'string' ? data.code.trim().toUpperCase() : '';
      requireGame(code.length === 5, '请输入 5 位房间码。');
      const room = rooms.get(code);
      requireGame(room, '没有找到这个房间，请检查房间码。');
      requireGame(room.mode === 'friends', '这是单人的人机练习，不能加入。');
      return bind(room, addPlayer(room, normalizeProfile(data), socket.id));
    }));
    socket.on('resume', (data, reply) => handle(reply, () => {
      const room = rooms.get(data?.code);
      const player = room?.players.find((seat) => seat.id === data?.playerId && seat.token === data?.token);
      requireGame(room && player, '原来的座位已失效，请重新加入。');
      requireGame(!socket.data.seat || socket.data.seat.player === player, '请先离开当前牌桌。');
      const previous = player.connection ? io.sockets.sockets.get(player.connection) : undefined;
      if (previous && previous !== socket) {
        previous.data.seat = undefined;
        previous.emit('removed', '你已在另一个页面回到牌桌。');
      }
      return bind(room, player);
    }));
    socket.on('profile', (profile, reply) => handle(reply, () => {
      const { room, player } = current();
      Object.assign(player, normalizeProfile(profile));
      publish(room);
    }));
    socket.on('start', (revision, reply) => handle(reply, () => {
      const { room, player } = current();
      startRound(room, player, revision);
      publish(room);
    }));
    socket.on('play', (data, reply) => handle(reply, () => {
      const { room, player } = current();
      playCards(room, player, data);
      publish(room);
    }));
    socket.on('pass', (revision, reply) => handle(reply, () => {
      const { room, player } = current();
      passTurn(room, player, revision);
      publish(room);
    }));
    socket.on('autoplay', (enabled, reply) => handle(reply, () => {
      const { room, player } = current();
      requireGame(typeof enabled === 'boolean', '无法修改托管状态。');
      if (player.autoPlay === enabled) return;
      player.autoPlay = enabled;
      publish(room);
    }));
    socket.on('react', (data, reply) => handle(reply, () => {
      const { room, player } = current();
      requireGame(typeof data?.kind === 'string' && Object.hasOwn(REACTIONS, data.kind), '没有这个互动道具。');
      requireGame(data.to !== player.id && room.players.some((seat) => seat.id === data.to), '请选择同桌的其他玩家。');
      const now = Date.now();
      requireGame(now - lastReaction >= 1500, '慢一点，等一下再丢。');
      lastReaction = now;
      const reaction = { id: randomUUID(), code: room.code, from: player.id, to: data.to, kind: data.kind };
      for (const seat of room.players) {
        if (seat.connection) io.to(seat.connection).emit('reaction', reaction);
      }
    }));
    socket.on('leave', (reply) => handle(reply, () => {
      const { room, player } = current();
      socket.data.seat = undefined;
      removePlayer(room, player);
      publish(room);
      if (!room.players.some((seat) => !seat.bot)) rooms.delete(room.code);
    }));
    socket.on('disconnect', () => {
      const seat = socket.data.seat;
      if (seat?.player.connection !== socket.id) return;
      seat.player.connection = null;
      seat.player.offlineSince = Date.now();
      publish(seat.room);
    });
  });
  return { http, io };
}
