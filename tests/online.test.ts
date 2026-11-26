import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { io, type Socket } from 'socket.io-client';
import { buildServer } from '../server/http.js';
import { MAX_PLAYERS, type ClientEvents, type Result, type RoomView, type RoundLimit, type ServerEvents, type Session } from '../shared/protocol.js';

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

async function startFriendsRound(host: Client, guest: Client, roundLimit: RoundLimit = 5) {
  const session = value<Session>(await host.timeout(2000).emitWithAck('create', { name: '房主', avatar: 1, roundLimit }));
  const joining = state(host, (view) => view.players.length === 2);
  const guestSession = value<Session>(await guest.timeout(2000).emitWithAck('join', { code: session.code, name: '好友', avatar: 2 }));
  const starting = state(host, (view) => view.phase === 'playing');
  value(await host.timeout(2000).emitWithAck('start', (await joining).revision));
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
  value(await host.timeout(2000).emitWithAck('start', lobby.revision));
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
  value(await host.timeout(2000).emitWithAck('start', lobby.revision));
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
  const starting = state(host, (view) => view.phase === 'playing');
  value(await host.timeout(2000).emitWithAck('start', (await joining).revision));
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
  const watcher = await connect();
  const watched = state(watcher, (view) => view.spectating);
  const watchingSession = value<Session>(await watcher.timeout(2000).emitWithAck('join', { code, name: '观战者', avatar: 3 }));
  const view = await watched;
  assert.equal(view.you, watchingSession.playerId);
  assert.equal(view.spectatorCount, 1);
  assert.deepEqual(view.players, round.players);
  assert.deepEqual([view.revision, view.turnDeadline, view.deckSize, view.notice], [round.revision, round.turnDeadline, 54, round.notice]);
  assert.deepEqual([view.hand, view.playableCardIds, view.drawnCardId, view.revealedHands], [[], [], null, []]);
  const request = watcher.timeout(2000);
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
  value(await watcher.timeout(2000).emitWithAck('leaveSpectator'));
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

test('观战者不参与本局结算，保持在线到下一局发牌才入座', { timeout: 8_000 }, async (t) => {
  const { server, connect } = await fixture(t);
  const host = await connect();
  const { session, guestSession, round } = await startFriendsRound(host, await connect());
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
  assert.deepEqual(result.settlement.map(({ playerId }) => playerId), [session.playerId, guestSession.playerId]);
  assert.deepEqual(result.revealedHands.map(({ playerId, cards }) => [playerId, cards.length]), [[session.playerId, 0], [guestSession.playerId, 5]]);

  const afterDeparture = state(host, (view) => view.phase === 'finished' && view.spectatorCount === 3);
  viewers[3].client.disconnect();
  assert.equal((await afterDeparture).revision, result.revision);
  const nextRound = state(viewer, (view) => view.phase === 'playing' && view.round === 2);
  value(await host.timeout(2000).emitWithAck('start', result.revision));
  const seated = await nextRound;
  assert.deepEqual([seated.you, seated.spectating, seated.spectatorCount, seated.hand.length, seated.deckSize], [viewerSession.playerId, false, 0, 5, 108]);
  assert.deepEqual(seated.players.map(({ id }) => id), [session.playerId, guestSession.playerId, ...viewers.slice(0, 3).map(({ session }) => session.playerId)]);
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
