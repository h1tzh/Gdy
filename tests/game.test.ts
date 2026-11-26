import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bombMultiplier, TURN_MS, type Card } from '../shared/protocol.js';
import { addPlayer, createRoom, passTurn, playCards, removePlayer, startRound, viewFor } from '../server/game.js';

function game(count = 3) {
  const room = createRoom('TEST0');
  const players = Array.from({ length: count }, (_, i) => addPlayer(room, { name: `玩家 ${i + 1}`, avatar: i }, `socket-${i}`));
  startRound(room, players[0], room.revision);
  return { room, players };
}

let cardIndex = 0;
function cards(...ranks: number[]): Card[] {
  return ranks.map((rank) => ({ id: String(cardIndex++), rank, suit: rank >= 16 ? 'joker' : 'spades' }));
}

test('2–4 人用一副牌，5–6 人用两副牌，领出者多一张', () => {
  for (const count of [2, 3, 4, 5, 6]) {
    const { room, players } = game(count);
    assert.equal(room.turn, players[0].id);
    assert.deepEqual(players.map((player) => player.hand.length), [6, ...Array(count - 1).fill(5)]);
    assert.equal(room.deckSize, count <= 4 ? 54 : 108);
    assert.equal(room.deck.length, room.deckSize - (5 * count + 1));
    assert.equal(new Set([...room.deck, ...players.flatMap((seat) => seat.hand)].map((card) => card.id)).size, room.deckSize);
  }
});

test('仅最后成功出牌者补牌；一轮有接牌时从新的出牌者算起', () => {
  const { room, players: [a, b, c] } = game();
  a.hand = cards(3, 9);
  b.hand = cards(4, 7);
  c.hand = cards(8, 10);
  playCards(room, a, { revision: room.revision, ids: [a.hand[0].id] });
  playCards(room, b, { revision: room.revision, ids: [b.hand[0].id] });
  const deckCount = room.deck.length;
  const nextCard = room.deck.at(-1);
  passTurn(room, c, room.revision);
  assert.equal(room.deck.length, deckCount);
  passTurn(room, a, room.revision);
  assert.equal(room.deck.length, deckCount - 1);
  assert.equal(room.turn, b.id);
  assert.equal(room.lastPlay, null);
  assert.deepEqual(room.passes, []);
  assert.equal(b.hand.at(-1), nextCard);
  assert.equal(viewFor(room, b).drawnCardId, nextCard?.id);
  assert.equal(viewFor(room, a).drawnCardId, null);
  assert.deepEqual(viewFor(room, a).lastDraw, { playerId: b.id, revision: room.revision });
  assert(!JSON.stringify(viewFor(room, a)).includes(nextCard!.id));
  assert.deepEqual([a.hand.length, b.hand.length, c.hand.length], [1, 2, 2]);
  playCards(room, b, { revision: room.revision, ids: [b.hand[0].id] });
  assert.equal(viewFor(room, b).drawnCardId, null);
});

test('底牌用尽则不补；重领不能过牌', () => {
  const { room, players: [a, b] } = game(2);
  a.hand = cards(3, 9);
  room.deck = [];
  assert.throws(() => passTurn(room, a, room.revision), /不能过牌/);
  playCards(room, a, { revision: room.revision, ids: [a.hand[0].id] });
  passTurn(room, b, room.revision);
  assert.equal(room.turn, a.id);
  assert.equal(a.hand.length, 1);
  assert.match(room.notice, /底牌用完/);
});

test('333 压单 2、888 压 333、4444 压 888；三次炸弹全桌 x8', () => {
  const { room, players: [a, b, c, d] } = game(4);
  a.hand = cards(15, 10);
  b.hand = cards(3, 3, 3, 9);
  c.hand = cards(8, 8, 8, 7);
  d.hand = cards(4, 4, 4, 4);
  playCards(room, a, { revision: room.revision, ids: [a.hand[0].id] });
  for (const [seat, size] of [[b, 3], [c, 3], [d, 4]] as const) {
    playCards(room, seat, { revision: room.revision, ids: seat.hand.slice(0, size).map((card) => card.id) });
    assert.equal(room.lastPlay?.shape.kind, 'bomb');
  }
  assert.equal(room.winner, d.id);
  assert.equal(room.bombCount, 3);
  assert.deepEqual([a.score, b.score, c.score, d.score], [-8, -8, -8, 24]);
});

test('全桌可见倍数从 x1 到 x2、x4；留王仅影响结算，重开重置倍数', () => {
  const { room, players: [a, b, c, d] } = game(4);
  a.hand = cards(3, 3, 3, 10);
  b.hand = cards(4, 4, 4, 9);
  c.hand = cards(16, 17, 8);
  d.hand = cards(6, 7);
  const visibleMultipliers = () => room.players.map((seat) => bombMultiplier(viewFor(room, seat).bombCount));
  assert.deepEqual(visibleMultipliers(), [1, 1, 1, 1]);
  playCards(room, a, { revision: room.revision, ids: a.hand.slice(0, 3).map((card) => card.id) });
  assert.deepEqual(visibleMultipliers(), [2, 2, 2, 2]);
  playCards(room, b, { revision: room.revision, ids: b.hand.slice(0, 3).map((card) => card.id) });
  assert.deepEqual(visibleMultipliers(), [4, 4, 4, 4]);
  for (const seat of [c, d, a]) passTurn(room, seat, room.revision);
  b.hand = cards(9); // Isolate scoring from the random draw.
  playCards(room, b, { revision: room.revision, ids: [b.hand[0].id] });
  assert.equal(room.phase, 'finished');
  assert.equal(room.bombCount, 2);
  assert.deepEqual(room.settlement.map(({ remaining, multiplier, delta }) => [remaining, multiplier, delta]), [[0, 1, 36], [1, 4, -4], [3, 8, -24], [2, 4, -8]]);
  assert.deepEqual([a.score, b.score, c.score, d.score], [-4, 36, -24, -8]);
  startRound(room, a, room.revision);
  assert.equal(room.turn, b.id);
  assert.deepEqual(visibleMultipliers(), [1, 1, 1, 1]);
  assert.equal(room.settlement.length, 0);
  assert.equal(b.score, 36);
});

test('无炸弹时按剩牌扣分，输家留大小王也只额外翻一次', () => {
  const { room, players: [a, b, c] } = game();
  a.hand = cards(3);
  b.hand = cards(16, 17);
  c.hand = cards(7, 9);
  playCards(room, a, { revision: room.revision, ids: a.hand.map((card) => card.id) });
  assert.equal(room.bombCount, 0);
  assert.deepEqual([a.score, b.score, c.score], [6, -4, -2]);
});

test('王不能单出或凑王炸，摸牌后仍只剩王则顺延领出', () => {
  const { room, players: [a, b, c] } = game();
  a.hand = cards(3, 17);
  b.hand = cards(16);
  c.hand = cards(6);
  room.deck = cards(16);
  assert.throws(() => playCards(room, a, { revision: room.revision, ids: [a.hand[1].id] }), /不符合牌型/);
  playCards(room, a, { revision: room.revision, ids: [a.hand[0].id] });
  passTurn(room, b, room.revision);
  passTurn(room, c, room.revision);
  assert.equal(room.turn, c.id);
  assert.equal(a.hand.length, 2);
  assert.equal(room.bombCount, 0);
});

test('所有玩家只剩王且无法领出时流局，不影响积分', () => {
  const { room, players: [a, b] } = game(2);
  a.hand = cards(3, 17);
  b.hand = cards(16);
  room.deck = [];
  playCards(room, a, { revision: room.revision, ids: [a.hand[0].id] });
  passTurn(room, b, room.revision);
  assert.equal(room.phase, 'finished');
  assert.equal(room.turn, null);
  assert.equal(room.winner, null);
  assert.deepEqual(room.settlement, []);
  assert.deepEqual([a.score, b.score], [0, 0]);
  assert.deepEqual(viewFor(room, a).revealedHands.map(({ cards: hand }) => hand.map((card) => card.rank)), [[17], [16]]);
});

test('亮牌只在本局正式结束后公开，且重开即清空；提示只发给当前出牌者', () => {
  const { room, players: [a, b] } = game(2);
  a.hand = cards(5, 9);
  b.hand = cards(17, 6);
  assert.deepEqual(viewFor(room, a).revealedHands, []);
  assert.deepEqual(viewFor(room, a).playableCardIds, a.hand.map(({ id }) => id));
  assert.deepEqual(viewFor(room, b).playableCardIds, []);
  playCards(room, a, { revision: room.revision, ids: [a.hand[0].id] });
  assert.deepEqual(viewFor(room, b).playableCardIds, [b.hand[1].id]);
  assert.deepEqual(viewFor(room, a).playableCardIds, []);
  b.autoPlay = true;
  assert.deepEqual(viewFor(room, b).playableCardIds, []);
  room.deck = [];
  passTurn(room, b, room.revision, true);
  playCards(room, a, { revision: room.revision, ids: [a.hand[0].id] });
  const revealed = viewFor(room, a).revealedHands;
  assert.deepEqual(revealed.map(({ playerId, cards: hand }) => [playerId, hand.map((card) => card.rank)]), [[a.id, []], [b.id, [6, 17]]]);
  assert.deepEqual(viewFor(room, b).revealedHands, revealed);
  assert.deepEqual(viewFor(room, a).playableCardIds, []);
  removePlayer(room, b);
  const c = addPlayer(room, { name: '后来加入', avatar: 0 }, 'c');
  assert.deepEqual(viewFor(room, c).revealedHands, revealed);
  startRound(room, a, room.revision);
  assert.deepEqual(viewFor(room, a).revealedHands, []);
  assert.deepEqual(viewFor(room, c).revealedHands, []);
});

test('客户端只能看到自己的手牌；拒绝越权、非手牌和旧轮次', () => {
  const { room, players: [a, b] } = game(2);
  const view = viewFor(room, a);
  assert.equal(view.hand.length, a.hand.length);
  assert.equal(view.players[1].count, b.hand.length);
  assert(!('hand' in view.players[1]));
  assert(!JSON.stringify(view).includes(b.token));
  assert.throws(() => playCards(room, b, { revision: room.revision, ids: [b.hand[0].id] }), /没轮到/);
  assert.throws(() => playCards(room, a, { revision: room.revision, ids: [b.hand[0].id] }), /不在你的手里/);
  assert.throws(() => playCards(room, a, { revision: room.revision - 1, ids: [a.hand[0].id] }), /有更新/);
  removePlayer(room, a);
  assert.equal(room.phase, 'lobby');
  assert.equal(viewFor(room, b).host, b.id);
  assert.deepEqual(viewFor(room, b).revealedHands, []);
});

test('回合有 15 秒；超时或托管状态下禁止手动操作，但允许服务器代打或过牌', () => {
  const { room, players: [a, b] } = game(2);
  a.hand = cards(5, 8);
  b.hand = cards(10, 12);
  assert(room.turnDeadline! - Date.now() <= TURN_MS);
  a.autoPlay = true;
  assert.throws(() => playCards(room, a, { revision: room.revision, ids: [a.hand[0].id] }), /托管已开启/);
  a.autoPlay = false;
  room.turnDeadline = Date.now() - 1;
  assert.throws(() => playCards(room, a, { revision: room.revision, ids: [a.hand[0].id] }), /回合已超时/);
  playCards(room, a, { revision: room.revision, ids: [a.hand[0].id] }, true);
  assert.equal(viewFor(room, b).lastPlay?.automatic, true);
  assert.equal(room.turn, b.id);
  assert(room.turnDeadline! > Date.now());
  room.turnDeadline = Date.now() - 1;
  assert.throws(() => passTurn(room, b, room.revision), /回合已超时/);
  passTurn(room, b, room.revision, true);
  assert.equal(room.turn, a.id);
  assert.equal(viewFor(room, a).drawnCardId, a.hand.at(-1)?.id);
});

test('支持固定 1、5、10、20 局，最后一局才给出总榜并禁止再开局', () => {
  for (const limit of [1, 5, 10, 20] as const) {
    const room = createRoom('TEST0', 'friends', limit);
    const a = addPlayer(room, { name: '发呆的仙人掌', avatar: 1 }, 'a');
    const b = addPlayer(room, { name: '暴躁的勺子', avatar: 2 }, 'b');
    for (let round = 1; round <= limit; round++) {
      startRound(room, a, room.revision);
      assert.equal(room.round, round);
      a.hand = cards(5);
      b.hand = cards(10, 12);
      playCards(room, a, { revision: room.revision, ids: [a.hand[0].id] });
      assert.equal(room.roundsCompleted, round);
      assert.equal(room.turnDeadline, null);
      assert.equal(Boolean(viewFor(room, a).finalScores), round === limit);
    }
    assert.deepEqual(viewFor(room, a).finalScores?.map(({ playerId, score }) => [playerId, score]), [[a.id, 2 * limit], [b.id, -2 * limit]]);
    assert.throws(() => startRound(room, a, room.revision), /本房已打完/);
    assert.throws(() => addPlayer(room, { name: '财哥', avatar: 0 }, 'c'), /本房已打完/);
  }
});

test('取消的局数不计入，已打过牌的离桌玩家仍计入最终记分板', () => {
  const { room, players: [a, b, c] } = game(3);
  room.roundLimit = 1;
  removePlayer(room, c);
  assert.equal(room.roundsCompleted, 0);
  assert.equal(room.round, 0);
  assert.equal(room.turnDeadline, null);
  room.roundLimit = 5;
  for (let round = 1; round <= 5; round++) {
    startRound(room, a, room.revision);
    const other = room.players[1];
    a.hand = cards(3);
    other.hand = cards(6);
    playCards(room, a, { revision: room.revision, ids: [a.hand[0].id] });
    if (round === 1) {
      removePlayer(room, b);
      addPlayer(room, { name: '财哥', avatar: 4 }, 'd');
    }
  }
  assert.deepEqual(room.finalScores?.map((entry) => entry.score), [5, -1, -4]);
});
