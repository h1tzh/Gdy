import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { io, type Socket } from 'socket.io-client';
import { buildServer } from '../server/http.js';
import type { ClientEvents, Result, RoomView, ServerEvents, Session } from '../shared/protocol.js';

type Client = Socket<ServerEvents, ClientEvents>;
function state(client: Client, predicate: (room: RoomView) => boolean, wait = 3_000) {
  return new Promise<RoomView>((resolve, reject) => {
    const timeout = setTimeout(() => { client.off('state', listener); reject(new Error('未收到预期的牌桌状态')); }, wait);
    const listener = (room: RoomView) => {
      if (!predicate(room)) return;
      clearTimeout(timeout);
      client.off('state', listener);
      resolve(room);
    };
    client.on('state', listener);
  });
}

function value<T>(result: Result<T>) {
  if (!result.ok) assert.fail(result.error);
  return result.value;
}

test('联机建房、加入、资料同步、掉线恢复和人机自动行动', { timeout: 12_000 }, async (t) => {
  const { http, io: server } = buildServer();
  const sockets: Client[] = [];
  t.after(async () => { sockets.forEach((socket) => socket.disconnect()); await server.close(); });
  http.listen(0, '127.0.0.1');
  await once(http, 'listening');
  const address = http.address();
  assert(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}`;
  async function connect() {
    const client: Client = io(url, { forceNew: true, reconnection: false, timeout: 1500 });
    sockets.push(client);
    await new Promise<void>((resolve, reject) => { client.once('connect', resolve).once('connect_error', reject); });
    return client;
  }

  const host = await connect();
  const guest = await connect();
  assert.equal((await host.timeout(2000).emitWithAck('create', { name: '   ', avatar: 12 })).ok, false);
  const session = value<Session>(await host.timeout(2000).emitWithAck('create', { name: '  自定义房主  ', avatar: 12, roundLimit: 1 }));
  const guestJoined = state(host, (room) => room.players.length === 2);
  const joined = value<Session>(await guest.timeout(2000).emitWithAck('join', { code: session.code, name: '自定义好友', avatar: 24 }));
  assert.deepEqual((await guestJoined).players.map(({ name }) => name), ['自定义房主', '自定义好友']);
  assert.equal((await guest.timeout(2000).emitWithAck('profile', { name: '过长'.repeat(16), avatar: 42 })).ok, false);
  const edited = state(host, (room) => room.players.some((player) => player.name === '好友新昵称' && player.avatar === 42));
  value(await guest.timeout(2000).emitWithAck('profile', { name: '好友新昵称', avatar: 42 }));
  const waiting = await edited;
  assert.equal(waiting.roundLimit, 1);
  assert.equal(waiting.roundsCompleted, 0);
  const wasThrown = new Promise<void>((resolve) => guest.once('reaction', ({ code, from, to, kind }) => {
    assert.deepEqual([code, from, to, kind], [session.code, session.playerId, joined.playerId, 'tomato']);
    resolve();
  }));
  assert.equal((await host.timeout(2000).emitWithAck('react', { to: session.playerId, kind: 'tomato' })).ok, false);
  value(await host.timeout(2000).emitWithAck('react', { to: joined.playerId, kind: 'tomato' }));
  await wasThrown;
  assert.equal((await host.timeout(2000).emitWithAck('react', { to: joined.playerId, kind: 'egg' })).ok, false);
  const roomState = state(host, (room) => room.phase === 'playing');
  const guestState = state(guest, (room) => room.phase === 'playing');
  assert.equal((await guest.timeout(2000).emitWithAck('start', waiting.revision)).ok, false);
  value(await host.timeout(2000).emitWithAck('start', waiting.revision));
  const round = await roomState;
  const guestRound = await guestState;
  assert.equal(round.deckSize, 54);
  assert.equal(round.hand.length, 6);
  assert.equal(guestRound.hand.length, 5);
  assert.equal(round.turn, session.playerId);
  assert(round.turnDeadline! - round.serverTime <= 15_000 && round.turnDeadline! - round.serverTime > 14_000);
  assert(round.hand.every((card) => !guestRound.hand.some((other) => other.id === card.id)));
  assert(round.playableCardIds.length > 0 && round.playableCardIds.every((id) => round.hand.some((card) => card.id === id)));
  assert.deepEqual(guestRound.playableCardIds, []);
  assert.deepEqual(guestRound.revealedHands, []);
  const offline = state(host, (room) => room.players.some((player) => player.id === joined.playerId && !player.online));
  guest.disconnect();
  await offline;
  const resumed = await connect();
  const seatReturned = state(resumed, (room) => room.you === joined.playerId);
  value(await resumed.timeout(2000).emitWithAck('resume', joined));
  assert.deepEqual((await seatReturned).hand, guestRound.hand);

  const hostSeat = server.sockets.sockets.get(host.id!)!.data.seat!.player;
  hostSeat.hand = round.hand.filter(({ rank }) => rank < 16).slice(0, 1);
  const hostResult = state(host, (room) => room.phase === 'finished');
  const guestResult = state(resumed, (room) => room.phase === 'finished');
  value(await host.timeout(2000).emitWithAck('play', { revision: round.revision, ids: hostSeat.hand.map(({ id }) => id) }));
  assert.deepEqual((await hostResult).revealedHands.map(({ cards }) => cards), [[], guestRound.hand]);
  assert.deepEqual((await guestResult).revealedHands, (await hostResult).revealedHands);

  const practice = await connect();
  const initial = state(practice, (room) => room.mode === 'practice');
  const practiceSession = value<Session>(await practice.timeout(2000).emitWithAck('practice', { name: '财哥', avatar: 0, bots: 5 }));
  const table = await initial;
  assert.equal(table.players.filter((player) => player.bot).length, 5);
  assert.equal(table.deckSize, 108);
  const outsider = await connect();
  assert.equal((await outsider.timeout(2000).emitWithAck('join', { code: practiceSession.code, name: '田中湫泥子', avatar: 1 })).ok, false);
  const autoEnabled = state(practice, (room) => room.players.some((player) => player.id === room.you && player.autoPlay));
  const autoPlayed = state(practice, (room) => room.lastPlay?.playerId === room.you && room.lastPlay.automatic);
  const botResponded = state(practice, (room) => room.revision >= table.revision + 2);
  value(await practice.timeout(2000).emitWithAck('autoplay', true));
  assert.equal((await autoEnabled).turnDeadline, table.turnDeadline);
  assert.equal((await autoPlayed).turn, table.players[1].id);
  value(await practice.timeout(2000).emitWithAck('autoplay', false));
  assert((await botResponded).revision >= table.revision + 2);
});

test('手动玩家超时后服务器代打；更新头像资料不会重置倒计时', { timeout: 24_000 }, async (t) => {
  const { http, io: server } = buildServer();
  http.listen(0, '127.0.0.1');
  await once(http, 'listening');
  const address = http.address();
  assert(address && typeof address !== 'string');
  const client: Client = io(`http://127.0.0.1:${address.port}`, { timeout: 1500, reconnection: false });
  t.after(async () => { client.disconnect(); await server.close(); });
  await new Promise<void>((resolve, reject) => { client.once('connect', resolve).once('connect_error', reject); });
  const initial = state(client, (room) => room.phase === 'playing');
  value(await client.timeout(2000).emitWithAck('practice', { name: '发呆的馒头', avatar: 0, bots: 1 }));
  const room = await initial;
  const updated = state(client, (next) => next.players[0].avatar === 42);
  const timeoutPlay = state(client, (next) => next.lastPlay?.playerId === room.you && next.lastPlay.automatic, 19_000);
  value(await client.timeout(2000).emitWithAck('profile', { name: '暴躁的杯子', avatar: 42 }));
  assert.equal((await updated).turnDeadline, room.turnDeadline);
  const acted = await timeoutPlay;
  assert(acted.serverTime >= room.turnDeadline! - 5);
  assert(acted.serverTime < room.turnDeadline! + 2000);
  assert(acted.hand.length < room.hand.length);
});
