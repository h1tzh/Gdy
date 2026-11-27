import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { io, type Socket } from 'socket.io-client';
import { buildServer } from '../server/http.js';
import { AUTO_PASS_MS, MAX_PLAYERS, type ClientEvents, type Result, type RoomView, type RoundLimit, type ServerEvents, type Session } from '../shared/protocol.js';

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

async function fixture(t: TestContext) {
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
  return { server, connect };
}

async function prepare(client: Client, revision: number, prepared = true) {
  value(await client.timeout(2000).emitWithAck('prepare', { revision, prepared }));
}

async function startFriendsRound(host: Client, guest: Client, roundLimit: RoundLimit = 5) {
  const session = value<Session>(await host.timeout(2000).emitWithAck('create', { name: '房主', avatar: 1, roundLimit }));
  const joining = state(host, (view) => view.players.length === 2);
  const guestSession = value<Session>(await guest.timeout(2000).emitWithAck('join', { code: session.code, name: '好友', avatar: 2 }));
  const { revision } = await joining;
  const starting = state(host, (view) => view.phase === 'playing');
  await Promise.all([prepare(host, revision), prepare(guest, revision)]);
  return { session, guestSession, round: await starting };
}

test('联机建房、加入、资料同步、掉线恢复和人机自动行动', { timeout: 12_000 }, async (t) => {
  const { server, connect } = await fixture(t);
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
  await Promise.all([prepare(host, waiting.revision), prepare(guest, waiting.revision)]);
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

  const hostSeat = server.sockets.sockets.get(host.id!)!.data.membership!.room.players[0];
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
  const { connect } = await fixture(t);
  const client = await connect();
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

test('没有牌能接的手动玩家在 2 秒后由服务器过牌，按原规则补牌', { timeout: 8_000 }, async (t) => {
  const { server, connect } = await fixture(t);
  const host = await connect();
  const guest = await connect();
  const { session, guestSession, round } = await startFriendsRound(host, guest);
  const table = server.sockets.sockets.get(host.id!)!.data.membership!.room;
  table.players[0].hand = [{ id: 'lead', rank: 5, suit: 'hearts' }, { id: 'held', rank: 9, suit: 'spades' }];
  table.players[1].hand = [{ id: 'jump', rank: 7, suit: 'clubs' }];

  const guestTurn = state(guest, (view) => view.turn === guestSession.playerId);
  const autoPassed = state(host, (view) => view.lastDraw?.playerId === session.playerId, AUTO_PASS_MS + 2000);
  value(await host.timeout(2000).emitWithAck('play', { revision: round.revision, ids: ['lead'] }));
  const waiting = await guestTurn;
  assert.deepEqual(waiting.playableCardIds, []);
  const remaining = waiting.turnDeadline! - waiting.serverTime;
  assert(remaining > AUTO_PASS_MS - 100 && remaining <= AUTO_PASS_MS);
  const passed = await autoPassed;
  assert(passed.serverTime >= waiting.turnDeadline! - 5 && passed.serverTime < waiting.turnDeadline! + 1500);
  assert.equal(passed.revision, waiting.revision + 1);
  assert.equal(passed.turn, session.playerId);
  assert.equal(passed.lastPlay, null);
  assert.equal(passed.deckCount, waiting.deckCount - 1);
  assert.deepEqual(passed.players.map(({ count }) => count), [2, 1]);
});

test('房主可移出在线或掉线的好友；旧座位失效且进行中的一局不计分', { timeout: 8_000 }, async (t) => {
  const { connect } = await fixture(t);
  const host = await connect();
  const guest = await connect();
  const third = await connect();
  const room = value<Session>(await host.timeout(2000).emitWithAck('create', { name: '房主', avatar: 1 }));
  const joining = state(host, (view) => view.players.length === 3);
  const guestSeat = value<Session>(await guest.timeout(2000).emitWithAck('join', { code: room.code, name: '来客', avatar: 2 }));
  const thirdSeat = value<Session>(await third.timeout(2000).emitWithAck('join', { code: room.code, name: '另一位来客', avatar: 3 }));
  const lobby = await joining;
  assert.equal((await guest.timeout(2000).emitWithAck('kick', thirdSeat.playerId)).ok, false);
  assert.equal((await host.timeout(2000).emitWithAck('kick', room.playerId)).ok, false);
  await Promise.all([host, guest, third].map((client) => prepare(client, lobby.revision)));
  const removed = new Promise<string>((resolve) => guest.once('removed', resolve));
  const cancelled = state(host, (view) => view.phase === 'lobby' && view.players.length === 2);
  value(await host.timeout(2000).emitWithAck('kick', guestSeat.playerId));
  assert.match(await removed, /房主移出/);
  const afterKick = await cancelled;
  assert.deepEqual([afterKick.roundsCompleted, afterKick.turn, afterKick.hand.length], [0, null, 0]);
  assert.equal((await guest.timeout(2000).emitWithAck('resume', guestSeat)).ok, false);
  assert(value<Session>(await guest.timeout(2000).emitWithAck('create', { name: '新的房间', avatar: 2 })).code);

  const disconnected = state(host, (view) => view.players.some((player) => player.id === thirdSeat.playerId && !player.online));
  third.disconnect();
  await disconnected;
  const alone = state(host, (view) => view.players.length === 1);
  value(await host.timeout(2000).emitWithAck('kick', thirdSeat.playerId));
  await alone;
  assert.equal((await (await connect()).timeout(2000).emitWithAck('resume', thirdSeat)).ok, false);
});

test('同一回合可反复催牌，只提醒当前在线手动玩家，不影响倒计时', { timeout: 8_000 }, async (t) => {
  const { server, connect } = await fixture(t);
  const host = await connect();
  const guest = await connect();
  const third = await connect();
  const room = value<Session>(await host.timeout(2000).emitWithAck('create', { name: '房主', avatar: 1 }));
  const joining = state(host, (view) => view.players.length === 3);
  const guestSeat = value<Session>(await guest.timeout(2000).emitWithAck('join', { code: room.code, name: '来客', avatar: 2 }));
  value(await third.timeout(2000).emitWithAck('join', { code: room.code, name: '同桌', avatar: 3 }));
  const lobby = await joining;
  assert.equal((await guest.timeout(2000).emitWithAck('nudge', lobby.revision)).ok, false);
  const playing = state(host, (view) => view.phase === 'playing');
  await Promise.all([host, guest, third].map((client) => prepare(client, lobby.revision)));
  const turn = await playing;
  assert.equal((await host.timeout(2000).emitWithAck('nudge', turn.revision)).ok, false);
  assert.equal((await guest.timeout(2000).emitWithAck('nudge', lobby.revision)).ok, false);
  for (const [i, sender] of [guest, guest, third, guest].entries()) {
    const alerted = state(host, (view) => view.turnNudges === i + 1);
    value(await sender.timeout(2000).emitWithAck('nudge', turn.revision));
    const nudged = await alerted;
    assert.deepEqual([nudged.turnDeadline, nudged.revision], [turn.turnDeadline, turn.revision]);
  }

  const player = server.sockets.sockets.get(host.id!)!.data.membership!.room.players[0];
  player.hand = [{ id: 'lead', rank: 3, suit: 'hearts' }, { id: 'left', rank: 10, suit: 'hearts' }];
  const switched = state(host, (view) => view.turn === guestSeat.playerId);
  value(await host.timeout(2000).emitWithAck('play', { revision: turn.revision, ids: ['lead'] }));
  const next = await switched;
  assert.equal(next.turnNudges, 0);
  value(await guest.timeout(2000).emitWithAck('autoplay', true));
  assert.equal((await third.timeout(2000).emitWithAck('nudge', next.revision)).ok, false);
  value(await guest.timeout(2000).emitWithAck('autoplay', false));
  const alertedAgain = state(guest, (view) => view.turnNudges === 1);
  value(await third.timeout(2000).emitWithAck('nudge', next.revision));
  assert.equal((await alertedAgain).turn, guestSeat.playerId);
});

test('断线快速代打，重连恢复掉线前的手动托管设置', { timeout: 8_000 }, async (t) => {
  const { server, connect } = await fixture(t);
  const host = await connect();
  const guest = await connect();
  const room = value<Session>(await host.timeout(2000).emitWithAck('create', { name: '房主', avatar: 1 }));
  const joining = state(host, (view) => view.players.length === 2);
  const guestSeat = value<Session>(await guest.timeout(2000).emitWithAck('join', { code: room.code, name: '来客', avatar: 2 }));
  const { revision } = await joining;
  const starting = state(host, (view) => view.phase === 'playing');
  await Promise.all([prepare(host, revision), prepare(guest, revision)]);
  const turn = await starting;
  const table = server.sockets.sockets.get(host.id!)!.data.membership!.room;
  table.players[0].hand = [{ id: 'a3', rank: 3, suit: 'hearts' }, { id: 'a5', rank: 5, suit: 'hearts' }];
  table.players[1].hand = [{ id: 'b4', rank: 4, suit: 'hearts' }, { id: 'b5', rank: 5, suit: 'spades' }];

  value(await guest.timeout(2000).emitWithAck('autoplay', true));
  let dropped = state(host, (view) => !view.players[1].online);
  guest.disconnect();
  assert.equal((await dropped).players[1].autoPlay, true);
  const resumed = await connect();
  const recovered = state(resumed, (view) => view.you === guestSeat.playerId);
  value(await resumed.timeout(2000).emitWithAck('resume', guestSeat));
  assert.equal((await recovered).players[1].autoPlay, true);

  value(await resumed.timeout(2000).emitWithAck('autoplay', false));
  dropped = state(host, (view) => !view.players[1].online);
  resumed.disconnect();
  assert.equal((await dropped).players[1].autoPlay, true);
  const guestTurn = state(host, (view) => view.turn === guestSeat.playerId);
  const reply = state(host, (view) => view.lastPlay?.playerId === guestSeat.playerId && view.lastPlay.automatic);
  value(await host.timeout(2000).emitWithAck('play', { revision: turn.revision, ids: ['a3'] }));
  const waiting = await guestTurn;
  assert.equal((await host.timeout(2000).emitWithAck('nudge', waiting.revision)).ok, false);
  assert((await reply).serverTime < waiting.turnDeadline! - 10_000);

  const back = await connect();
  const backView = state(back, (view) => view.you === guestSeat.playerId);
  value(await back.timeout(2000).emitWithAck('resume', guestSeat));
  assert.deepEqual((await backView).players.map(({ autoPlay }) => autoPlay), [false, false]);
  const disconnected = state(back, (view) => !view.players[0].online);
  host.disconnect();
  await disconnected;
  back.disconnect();
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => { clearInterval(timer); reject(new Error('全员断线后，对局未继续')); }, 2200);
    const timer = setInterval(() => {
      if (table.phase !== 'finished') return;
      clearTimeout(timeout);
      clearInterval(timer);
      resolve();
    }, 25);
  });
  assert.equal(table.winner, room.playerId);
});

test('开局后加入只能观战，满房拒绝新加入，观战退出和掉线都会释放名额', { timeout: 8_000 }, async (t) => {
  const { server, connect } = await fixture(t);
  const host = await connect();
  const guest = await connect();
  const { session, guestSession, round } = await startFriendsRound(host, guest);
  const { code } = session;
  assert.deepEqual(round.spectators, []);
  const watcher = await connect();
  const watched = state(watcher, (view) => view.spectating);
  const joined = state(host, (view) => view.spectatorCount === 1);
  const watchingSession = value<Session>(await watcher.timeout(2000).emitWithAck('join', { code, name: '观战者', avatar: 3 }));
  const [view, hostView] = await Promise.all([watched, joined]);
  assert.equal(view.you, watchingSession.playerId);
  assert.equal(view.spectatorCount, 1);
  const publicWatcher = { id: watchingSession.playerId, name: '观战者', avatar: 3, prepared: false };
  assert.deepEqual(view.spectators, [publicWatcher]);
  assert.deepEqual(hostView.spectators, view.spectators);
  assert.deepEqual(view.players, round.players);
  assert.deepEqual([view.revision, view.turnDeadline, view.deckSize, view.notice], [round.revision, round.turnDeadline, 54, round.notice]);
  assert.deepEqual([view.hand, view.playableCardIds, view.drawnCardId, view.revealedHands], [[], [], null, []]);
  const request = watcher.timeout(2000);
  const updatedRoster = [host, watcher].map((client) => state(client, (view) => view.spectators[0]?.name === '改名的观众'));
  value(await request.emitWithAck('profile', { name: '改名的观众', avatar: 9 }));
  for (const updated of await Promise.all(updatedRoster)) {
    assert.deepEqual(updated.spectators, [{ ...publicWatcher, name: '改名的观众', avatar: 9 }]);
  }
  for (const result of await Promise.all([
    request.emitWithAck('play', { revision: round.revision, ids: round.hand.slice(0, 1).map(({ id }) => id) }),
    request.emitWithAck('pass', round.revision), request.emitWithAck('start', round.revision), request.emitWithAck('autoplay', true),
    request.emitWithAck('nudge', round.revision), request.emitWithAck('react', { kind: 'egg', to: guestSession.playerId }),
    request.emitWithAck('kick', guestSession.playerId),
  ])) {
    assert.deepEqual(result, { ok: false, error: '观战时不能操作牌局。' });
  }

  const others: Client[] = [];
  for (let i = 0; i < MAX_PLAYERS - 3; i++) {
    const client = await connect();
    value(await client.timeout(2000).emitWithAck('join', { code, name: `观众${i}`, avatar: i }));
    others.push(client);
  }
  const extra = await connect();
  const joinExtra = () => extra.timeout(2000).emitWithAck('join', { code, name: '新观众', avatar: 6 });
  assert.deepEqual(await joinExtra(), { ok: false, error: '房间已满（含观战），最多 6 人。' });
  const afterLeaving = state(host, (view) => view.spectatorCount === MAX_PLAYERS - 3);
  value(await watcher.timeout(2000).emitWithAck('leaveSpectator'));
  assert.deepEqual((await afterLeaving).spectators.map(({ name }) => name), ['观众0', '观众1', '观众2']);
  value(await joinExtra());

  const offline = state(host, (view) => view.players.some(({ id, online }) => id === guestSession.playerId && !online));
  guest.disconnect();
  await offline;
  const back = await connect();
  assert.equal((await back.timeout(2000).emitWithAck('join', { code, name: '不能占用掉线座位', avatar: 7 })).ok, false);
  const restored = state(back, (view) => view.you === guestSession.playerId);
  value(await back.timeout(2000).emitWithAck('resume', guestSession));
  assert.equal((await restored).hand.length, 5);

  const freed = state(host, (view) => view.spectatorCount === MAX_PLAYERS - 3);
  others[0].disconnect();
  const continuing = await freed;
  assert.deepEqual(continuing.spectators.map(({ name }) => name), ['观众1', '观众2', '新观众']);
  assert.deepEqual([continuing.phase, continuing.revision, continuing.turnDeadline, continuing.notice], ['playing', round.revision, round.turnDeadline, round.notice]);
  assert.equal((await watcher.timeout(2000).emitWithAck('resume', watchingSession)).ok, false);
  value(await watcher.timeout(2000).emitWithAck('join', { code, name: '重新观战', avatar: 3 }));

  const table = server.sockets.sockets.get(host.id!)!.data.membership!.room;
  table.players[0].hand = [{ id: 'lead', rank: 3, suit: 'hearts' }, { id: 'hidden', rank: 10, suit: 'hearts' }];
  const seenPlay = state(watcher, (view) => view.lastPlay?.cards[0].id === 'lead');
  value(await host.timeout(2000).emitWithAck('play', { revision: continuing.revision, ids: ['lead'] }));
  const played = await seenPlay;
  assert.equal(played.lastPlay?.playerId, session.playerId);
  const seenDraw = state(watcher, (view) => view.lastDraw?.playerId === session.playerId);
  value(await back.timeout(2000).emitWithAck('pass', played.revision));
  const drawn = await seenDraw;
  assert.deepEqual([drawn.hand, drawn.drawnCardId, drawn.revealedHands], [[], null, []]);
});

test('观战者不参与本局结算，准备后下一局入座，未准备则继续观战', { timeout: 8_000 }, async (t) => {
  const { server, connect } = await fixture(t);
  const host = await connect();
  const guest = await connect();
  const { session, guestSession, round } = await startFriendsRound(host, guest);
  const viewers: { client: Client; session: Session }[] = [];
  for (let i = 0; i < 4; i++) {
    const client = await connect();
    viewers.push({ client, session: value<Session>(await client.timeout(2000).emitWithAck('join', { code: session.code, name: `观众${i}`, avatar: i })) });
  }
  const { client: viewer, session: viewerSession } = viewers[0];
  server.sockets.sockets.get(host.id!)!.data.membership!.room.players[0].hand = [{ id: 'winner', rank: 3, suit: 'hearts' }];
  const settled = state(viewer, (view) => view.phase === 'finished');
  value(await host.timeout(2000).emitWithAck('play', { revision: round.revision, ids: ['winner'] }));
  const result = await settled;
  assert.equal(result.spectating, true);
  assert(result.players.every(({ prepared }) => !prepared));
  assert.deepEqual(result.settlement.map(({ playerId }) => playerId), [session.playerId, guestSession.playerId]);
  assert.deepEqual(result.revealedHands.map(({ playerId, cards }) => [playerId, cards.length]), [[session.playerId, 0], [guestSession.playerId, 5]]);

  const afterDeparture = state(host, (view) => view.phase === 'finished' && view.spectatorCount === 3);
  viewers[3].client.disconnect();
  assert.equal((await afterDeparture).revision, result.revision);
  const waitingForHost = state(host, (view) => view.preparedSpectators === 2 && view.players[1].prepared);
  await Promise.all([prepare(guest, result.revision), ...viewers.slice(0, 2).map(({ client }) => prepare(client, result.revision))]);
  const waiting = await waitingForHost;
  assert.equal(waiting.phase, 'finished');
  assert.equal(waiting.youPrepared, false);
  assert.deepEqual(waiting.spectators.map(({ id, prepared }) => [id, prepared]), viewers.slice(0, 3).map(({ session }, index) => [session.playerId, index < 2]));
  const nextRound = state(viewer, (view) => view.phase === 'playing' && view.round === 2);
  const stillWatching = state(viewers[2].client, (view) => view.phase === 'playing' && view.round === 2);
  await prepare(host, result.revision);
  const seated = await nextRound;
  assert.deepEqual([seated.you, seated.spectating, seated.spectatorCount, seated.hand.length, seated.deckSize], [viewerSession.playerId, false, 1, 5, 54]);
  assert.deepEqual(seated.players.map(({ id }) => id), [session.playerId, guestSession.playerId, ...viewers.slice(0, 2).map(({ session }) => session.playerId)]);
  const privateView = await stillWatching;
  assert.equal(privateView.spectating, true);
  assert.deepEqual(privateView.hand, []);
  assert.deepEqual(seated.spectators, [{ id: viewers[2].session.playerId, name: '观众2', avatar: 2, prepared: false }]);
  assert.deepEqual(privateView.spectators, seated.spectators);
  assert.equal(seated.players.find(({ id }) => id === viewerSession.playerId)?.score, 0);
  assert.equal((await viewer.timeout(2000).emitWithAck('leaveSpectator')).ok, false);

  const offline = state(host, (view) => view.players.some(({ id, online }) => id === viewerSession.playerId && !online));
  viewer.disconnect();
  assert.equal((await offline).phase, 'playing');
  const back = await connect();
  const restored = state(back, (view) => view.you === viewerSession.playerId);
  value(await back.timeout(2000).emitWithAck('resume', viewerSession));
  assert.deepEqual((await restored).hand, seated.hand);
});

test('最后一局的观战者可查看记分板，房间关闭时退出', { timeout: 8_000 }, async (t) => {
  const { server, connect } = await fixture(t);
  const host = await connect();
  const guest = await connect();
  const { session, guestSession, round } = await startFriendsRound(host, guest, 1);
  const viewer = await connect();
  value(await viewer.timeout(2000).emitWithAck('join', { code: session.code, name: '观战者', avatar: 3 }));
  server.sockets.sockets.get(host.id!)!.data.membership!.room.players[0].hand = [{ id: 'winner', rank: 3, suit: 'hearts' }];
  const final = state(viewer, (view) => Boolean(view.finalScores));
  value(await host.timeout(2000).emitWithAck('play', { revision: round.revision, ids: ['winner'] }));
  const view = await final;
  assert.equal(view.spectating, true);
  assert.deepEqual(view.finalScores?.map(({ playerId }) => playerId), [session.playerId, guestSession.playerId]);
  const newcomer = await connect();
  assert.deepEqual(await newcomer.timeout(2000).emitWithAck('join', { code: session.code, name: '来晚了', avatar: 4 }), { ok: false, error: '本房已打完，不能继续加入。' });

  const closed = new Promise<string>((resolve) => viewer.once('removed', resolve));
  value(await host.timeout(2000).emitWithAck('leave'));
  value(await guest.timeout(2000).emitWithAck('leave'));
  assert.match(await closed, /房间已关闭/);
});

test('好友房包括房主在内全员准备后自动开局，整场结束后可原房重开', { timeout: 8_000 }, async (t) => {
  const { server, connect } = await fixture(t);
  const [host, guest, third, viewer, newcomer] = await Promise.all(Array.from({ length: 5 }, () => connect()));
  const session = value<Session>(await host.timeout(2000).emitWithAck('create', { name: '房主', avatar: 1, roundLimit: 1 }));
  const join = (client: Client, name: string) => client.timeout(2000).emitWithAck('join', { code: session.code, name, avatar: 2 });
  const guestSeat = value<Session>(await join(guest, '好友'));
  const thirdArrived = state(host, (view) => view.players.length === 3);
  value(await join(third, '同桌'));
  const lobby = await thirdArrived;
  const hostRequest = host.timeout(2000);
  assert.equal(lobby.players.some(({ prepared }) => prepared), false);
  assert.equal((await hostRequest.emitWithAck('restart', lobby.revision)).ok, false);
  assert.deepEqual(await hostRequest.emitWithAck('start', lobby.revision), { ok: false, error: '好友房全员准备后会自动开局。' });

  const guestsPrepared = state(host, (view) => view.players.slice(1).every(({ prepared }) => prepared));
  await Promise.all([prepare(guest, lobby.revision), prepare(third, lobby.revision)]);
  const waiting = await guestsPrepared;
  assert.deepEqual([waiting.phase, waiting.youPrepared], ['lobby', false]);
  await prepare(guest, lobby.revision, false);
  const hostPrepared = state(host, (view) => view.youPrepared);
  await prepare(host, lobby.revision);
  const stillWaiting = await hostPrepared;
  assert.deepEqual([stillWaiting.phase, stillWaiting.players[1].prepared], ['lobby', false]);

  const starting = state(host, (view) => view.phase === 'playing');
  await prepare(guest, lobby.revision);
  const round = await starting;
  assert.equal(round.revision, lobby.revision + 1);
  assert(round.players.every(({ prepared }) => !prepared));
  assert.equal((await guest.timeout(2000).emitWithAck('prepare', { revision: round.revision, prepared: true })).ok, false);
  assert.equal((await hostRequest.emitWithAck('restart', round.revision)).ok, false);
  value(await join(viewer, '观众'));

  const table = server.sockets.sockets.get(host.id!)!.data.membership!.room;
  table.players[0].hand = [{ id: 'lead', rank: 3, suit: 'hearts' }, { id: 'held', rank: 9, suit: 'clubs' }];
  table.players[1].hand = [{ id: 'reply', rank: 4, suit: 'spades' }];
  const guestTurn = state(guest, (view) => view.turn === guestSeat.playerId);
  value(await hostRequest.emitWithAck('play', { revision: round.revision, ids: ['lead'] }));
  const settled = state(viewer, (view) => Boolean(view.finalScores));
  value(await guest.timeout(2000).emitWithAck('play', { revision: (await guestTurn).revision, ids: ['reply'] }));
  const final = await settled;
  assert.equal(final.winner, guestSeat.playerId);
  assert(final.finalScores!.some(({ score }) => score !== 0));
  assert.equal((await guest.timeout(2000).emitWithAck('restart', final.revision)).ok, false);
  assert.equal((await hostRequest.emitWithAck('restart', round.revision)).ok, false);

  const resetting = state(host, (view) => view.phase === 'lobby' && view.matchNumber === 2);
  const viewerReset = state(viewer, (view) => view.phase === 'lobby');
  value(await hostRequest.emitWithAck('restart', final.revision));
  const reset = await resetting;
  assert.deepEqual([reset.code, reset.host, reset.roundLimit, reset.round, reset.roundsCompleted], [session.code, session.playerId, 1, 0, 0]);
  assert.deepEqual([reset.hand, reset.revealedHands, reset.settlement, reset.finalScores, reset.winner, reset.turn, reset.deckCount], [[], [], [], null, null, null, 0]);
  assert.deepEqual(reset.players.map(({ id }) => id), final.players.map(({ id }) => id));
  assert(reset.players.every(({ prepared, score }) => !prepared && score === 0));
  assert.equal((await viewerReset).spectating, true);
  const joined = state(host, (view) => view.players.length === 4);
  value(await join(newcomer, '新好友'));
  const { revision } = await joined;
  const restarted = state(host, (view) => view.matchNumber === 2 && view.phase === 'playing');
  await Promise.all([guest, third, newcomer, host].map((client) => prepare(client, revision)));
  const newRound = await restarted;
  assert.deepEqual([newRound.round, newRound.turn, newRound.spectatorCount, newRound.hand.length], [1, session.playerId, 1, 6]);
  table.players[0].hand = [{ id: 'winner', rank: 3, suit: 'hearts' }];
  const secondFinal = state(viewer, (view) => view.matchNumber === 2 && Boolean(view.finalScores));
  value(await hostRequest.emitWithAck('play', { revision: newRound.revision, ids: ['winner'] }));
  assert.equal((await secondFinal).finalScores?.length, 4);
});

test('只有房主准备时不开局，已准备的掉线玩家回桌后可自动开局', { timeout: 8_000 }, async (t) => {
  const { connect } = await fixture(t);
  const [host, guest, third] = await Promise.all([connect(), connect(), connect()]);
  const created = state(host, (view) => view.phase === 'lobby');
  const session = value<Session>(await host.timeout(2000).emitWithAck('create', { name: '房主', avatar: 1 }));
  const hostReady = state(host, (view) => view.youPrepared);
  await prepare(host, (await created).revision);
  assert.equal((await hostReady).phase, 'lobby');

  const joining = state(host, (view) => view.players.length === 3);
  const guestSeat = value<Session>(await guest.timeout(2000).emitWithAck('join', { code: session.code, name: '好友', avatar: 2 }));
  value(await third.timeout(2000).emitWithAck('join', { code: session.code, name: '同桌', avatar: 3 }));
  const { revision } = await joining;
  await prepare(guest, revision);
  const dropped = state(host, (view) => !view.players[1].online);
  guest.disconnect();
  assert.equal((await dropped).players[1].prepared, true);
  const allPrepared = state(host, (view) => view.players.every(({ prepared }) => prepared));
  await prepare(third, revision);
  assert.equal((await allPrepared).phase, 'lobby');

  const back = await connect();
  const started = state(host, (view) => view.phase === 'playing');
  value(await back.timeout(2000).emitWithAck('resume', guestSeat));
  assert.deepEqual((await started).players.map(({ count }) => count), [6, 5, 5]);
});

test('其他玩家和观众能实时看到非当前玩家开启和取消托管', { timeout: 8_000 }, async (t) => {
  const { connect } = await fixture(t);
  const [host, guest, viewer] = await Promise.all([connect(), connect(), connect()]);
  const { session, guestSession, round } = await startFriendsRound(host, guest);
  value(await viewer.timeout(2000).emitWithAck('join', { code: session.code, name: '观众', avatar: 3 }));
  for (const enabled of [true, false]) {
    const hasStatus = (view: RoomView) => view.players.find(({ id }) => id === guestSession.playerId)?.autoPlay === enabled;
    const updates = [state(host, hasStatus), state(viewer, hasStatus)];
    value(await guest.timeout(2000).emitWithAck('autoplay', enabled));
    for (const view of await Promise.all(updates)) {
      assert.equal(view.turn, session.playerId);
      assert.equal(view.turnDeadline, round.turnDeadline);
      assert.equal(view.players[1].online, true);
    }
  }
});
