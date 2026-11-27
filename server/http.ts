import { createServer } from 'node:http';
import { randomInt, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import { MAX_PLAYERS, REACTIONS, ROUND_OPTIONS, type ClientEvents, type Result, type RoundLimit, type ServerEvents, type Session } from '../shared/protocol.js';
import { chooseMove } from './bot.js';
import { addPlayer, addSpectator, createRoom, GameError, isAutoPlaying, normalizeProfile, nudgeTurn, passTurn, playCards, removePlayer, requireGame, restartMatch, sessionFor, setPrepared, startIfPrepared, startRound, viewFor, type Room, type RoomMember, type Spectator } from './game.js';

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
  const io = new Server<ClientEvents, ServerEvents, Record<string, never>, { membership?: { room: Room; id: string } }>(http, { maxHttpBufferSize: 8_192 });
  const rooms = new Map<string, Room>();
  const turnTimers = new Map<Room, { timer: NodeJS.Timeout; revision: number; quick: boolean }>();

  function publish(room: Room) {
    startIfPrepared(room);
    room.updated = Date.now();
    for (const member of [...room.players, ...room.spectators]) {
      if (member.connection) io.to(member.connection).emit('state', viewFor(room, member));
    }
    scheduleTurn(room);
  }

  function scheduleTurn(room: Room) {
    const existing = turnTimers.get(room);
    const player = room.players.find((seat) => seat.id === room.turn);
    const active = player && room.phase === 'playing' && room.turnDeadline !== null;
    if (active) {
      const quick = player.bot || isAutoPlaying(player);
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
      if (room.phase === 'playing') continue;
      if (room.players.every((seat) => !seat.connection)) {
        if (!room.spectators.length && now - room.updated > ROOM_TTL) rooms.delete(code);
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

    function bind(room: Room, member: RoomMember): Session {
      socket.data.membership = { room, id: member.id };
      publish(room);
      return sessionFor(room, member);
    }

    function connectedMember() {
      const membership = socket.data.membership;
      if (!membership) return;
      const { room, id } = membership;
      const matches = (member: RoomMember) => member.id === id && member.connection === socket.id;
      const player = room.players.find(matches);
      if (player) return { room, role: 'player' as const, member: player };
      const spectator = room.spectators.find(matches);
      if (spectator) return { room, role: 'spectator' as const, member: spectator };
    }

    function currentPlayer() {
      const membership = connectedMember();
      requireGame(membership, '你还没有加入牌桌。');
      requireGame(membership.role === 'player', '观战时不能操作牌局。');
      return { room: membership.room, player: membership.member };
    }

    function leaveSpectator(room: Room, spectator: Spectator) {
      socket.data.membership = undefined;
      room.spectators = room.spectators.filter((member) => member !== spectator);
      publish(room);
    }

    function openRoom(input: unknown, mode: Room['mode'], bots: number, roundLimit: RoundLimit | null) {
      requireGame(!socket.data.membership, '请先离开当前牌桌。');
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
      requireGame(!socket.data.membership, '请先离开当前牌桌。');
      const code = typeof data?.code === 'string' ? data.code.trim().toUpperCase() : '';
      requireGame(code.length === 5, '请输入 5 位房间码。');
      const room = rooms.get(code);
      requireGame(room, '没有找到这个房间，请检查房间码。');
      requireGame(room.mode === 'friends', '这是单人的人机练习，不能加入。');
      const profile = normalizeProfile(data);
      const member = room.phase === 'playing' ? addSpectator(room, profile, socket.id) : addPlayer(room, profile, socket.id);
      return bind(room, member);
    }));
    socket.on('resume', (data, reply) => handle(reply, () => {
      const room = rooms.get(data?.code);
      const player = room?.players.find((seat) => seat.id === data?.playerId && seat.token === data?.token);
      requireGame(room && player, '原来的房间身份已失效，请重新加入。');
      requireGame(!socket.data.membership || socket.data.membership.id === player.id, '请先离开当前牌桌。');
      const previous = player.connection ? io.sockets.sockets.get(player.connection) : undefined;
      if (previous && previous !== socket) {
        previous.data.membership = undefined;
        previous.emit('removed', '你已在另一个页面回到牌桌。');
      }
      player.connection = socket.id;
      player.offlineSince = null;
      return bind(room, player);
    }));
    socket.on('profile', (profile, reply) => handle(reply, () => {
      const membership = connectedMember();
      requireGame(membership, '你还没有加入牌桌。');
      Object.assign(membership.member, normalizeProfile(profile));
      publish(membership.room);
    }));
    socket.on('prepare', (data, reply) => handle(reply, () => {
      const membership = connectedMember();
      requireGame(membership, '你还没有加入牌桌。');
      setPrepared(membership.room, membership.member, data);
      publish(membership.room);
    }));
    socket.on('start', (revision, reply) => handle(reply, () => {
      const { room, player } = currentPlayer();
      requireGame(room.mode === 'practice', '好友房全员准备后会自动开局。');
      startRound(room, player, revision);
      publish(room);
    }));
    socket.on('restart', (revision, reply) => handle(reply, () => {
      const { room, player } = currentPlayer();
      restartMatch(room, player, revision);
      publish(room);
    }));
    socket.on('play', (data, reply) => handle(reply, () => {
      const { room, player } = currentPlayer();
      playCards(room, player, data);
      publish(room);
    }));
    socket.on('pass', (revision, reply) => handle(reply, () => {
      const { room, player } = currentPlayer();
      passTurn(room, player, revision);
      publish(room);
    }));
    socket.on('autoplay', (enabled, reply) => handle(reply, () => {
      const { room, player } = currentPlayer();
      requireGame(typeof enabled === 'boolean', '无法修改托管状态。');
      if (player.autoPlay === enabled) return;
      player.autoPlay = enabled;
      publish(room);
    }));
    socket.on('nudge', (revision, reply) => handle(reply, () => {
      const { room, player } = currentPlayer();
      nudgeTurn(room, player, revision);
      publish(room);
    }));
    socket.on('react', (data, reply) => handle(reply, () => {
      const { room, player } = currentPlayer();
      requireGame(typeof data?.kind === 'string' && Object.hasOwn(REACTIONS, data.kind), '没有这个互动道具。');
      requireGame(data.to !== player.id && room.players.some((seat) => seat.id === data.to), '请选择同桌的其他玩家。');
      const now = Date.now();
      requireGame(now - lastReaction >= 1500, '慢一点，等一下再丢。');
      lastReaction = now;
      const reaction = { id: randomUUID(), code: room.code, from: player.id, to: data.to, kind: data.kind };
      for (const member of [...room.players, ...room.spectators]) {
        if (member.connection) io.to(member.connection).emit('reaction', reaction);
      }
    }));
    socket.on('kick', (playerId, reply) => handle(reply, () => {
      const { room, player } = currentPlayer();
      requireGame(room.mode === 'friends' && room.players[0] === player, '只有好友房的房主可以移出玩家。');
      const target = room.players.find((seat) => seat.id === playerId);
      requireGame(target && target !== player && !target.bot, '只能移出同桌的其他真人玩家。');
      const targetSocket = target.connection ? io.sockets.sockets.get(target.connection) : undefined;
      if (targetSocket) {
        targetSocket.data.membership = undefined;
        targetSocket.emit('removed', '你已被房主移出房间。');
      }
      removePlayer(room, target, true);
      publish(room);
    }));
    socket.on('leaveSpectator', (reply) => handle(reply, () => {
      const membership = connectedMember();
      requireGame(membership, '你还没有加入牌桌。');
      requireGame(membership.role === 'spectator', '你已入座，请确认是否要离开房间。');
      leaveSpectator(membership.room, membership.member);
    }));
    socket.on('leave', (reply) => handle(reply, () => {
      const membership = connectedMember();
      requireGame(membership, '你还没有加入牌桌。');
      const { room } = membership;
      if (membership.role === 'spectator') return leaveSpectator(room, membership.member);
      socket.data.membership = undefined;
      removePlayer(room, membership.member);
      if (!room.players.some((seat) => !seat.bot)) {
        rooms.delete(room.code);
        for (const spectator of room.spectators.splice(0)) {
          const watcher = io.sockets.sockets.get(spectator.connection);
          if (!watcher) continue;
          watcher.data.membership = undefined;
          watcher.emit('removed', '所有玩家已离开，房间已关闭。');
        }
      }
      publish(room);
    }));
    socket.on('disconnect', () => {
      const membership = connectedMember();
      if (!membership) return;
      if (membership.role === 'spectator') return leaveSpectator(membership.room, membership.member);
      membership.member.connection = null;
      membership.member.offlineSince = Date.now();
      publish(membership.room);
    });
  });
  return { http, io };
}
