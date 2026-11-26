import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseMove, playableCardIds } from '../server/bot.js';
import { addPlayer, createRoom, passTurn, playCards, startRound } from '../server/game.js';
import { identifyPlay } from '../server/rules.js';
import type { Card } from '../shared/protocol.js';

function cards(...ranks: number[]): Card[] {
  return ranks.map((rank, index) => ({ id: String(index), rank, suit: rank >= 16 ? 'joker' : 'spades' }));
}

test('机器人会用单 2 或对 2 压牌，不会用普通牌跳点数、跨牌型或单出王', () => {
  assert.deepEqual(chooseMove(cards(7, 16, 15), identifyPlay(cards(5))), ['2']);
  assert.deepEqual(chooseMove(cards(8, 8, 15, 15), identifyPlay(cards(5, 5))), ['2', '3']);
  assert.deepEqual(chooseMove(cards(4, 4, 7), identifyPlay(cards(5))), []);
  assert.deepEqual(chooseMove(cards(16, 17), identifyPlay(cards(5))), []);
});

test('机器人可用三张炸弹压普通牌或较小的三张炸弹，也可用四张炸弹压三张炸弹', () => {
  assert.deepEqual(chooseMove(cards(3, 3, 3, 11), identifyPlay(cards(5))), ['0', '1', '2']);
  assert.deepEqual(chooseMove(cards(8, 8, 8, 11), identifyPlay(cards(3, 3, 3))), ['0', '1', '2']);
  assert.deepEqual(chooseMove(cards(4, 4, 4, 4, 10), identifyPlay(cards(8, 8, 8))), ['0', '1', '2', '3']);
  assert.deepEqual(chooseMove(cards(3, 3, 3, 6, 11), identifyPlay(cards(5))), ['3']);
});

test('亮边覆盖可凑牌的同点数牌和大小王，不标记不能参与的牌', () => {
  const hint = (hand: number[], last: number[]) => playableCardIds(cards(...hand), identifyPlay(cards(...last))).sort();
  assert.deepEqual(hint([6, 6, 8, 15], [5]), ['0', '1', '3']);
  assert.deepEqual(hint([6, 6, 8, 16], [5, 5]), ['0', '1', '3']);
  assert.deepEqual(hint([4, 5, 6, 14, 16], [3, 4, 5]), ['0', '1', '2', '4']);
  assert.deepEqual(hint([7, 16], [5]), []);
  assert.deepEqual(hint([4, 4, 4, 4, 10], [8, 8, 8]), ['0', '1', '2', '3']);
  assert.deepEqual(hint([16, 17], []), []);
});

test('手牌提示与逐一判定所有选牌组合一致', () => {
  const hands = [cards(3, 4, 5, 6, 6, 8, 15, 16), cards(4, 4, 5, 5, 8, 8, 16, 17), cards(3, 3, 3, 9, 9, 9, 9, 13)];
  for (const hand of hands) for (const lastCards of [[], [5], [5, 5], [3, 4, 5], [3, 3, 4, 4], [4, 4, 4], [8, 8, 8, 8]]) {
    const last = identifyPlay(cards(...lastCards));
    const expected = new Set<string>();
    for (let mask = 1; mask < 2 ** hand.length; mask++) {
      const selection = hand.filter((_, index) => mask & (1 << index));
      if (identifyPlay(selection, last)) for (const card of selection) expected.add(card.id);
    }
    assert.deepEqual(new Set(playableCardIds(hand, last)), expected);
  }
});

test('随机模拟不同人数的完整对局，机器人合法出牌直至结束', () => {
  for (let count = 2; count <= 6; count++) {
    for (let round = 0; round < 20; round++) {
      const room = createRoom('TEST0', 'practice');
      const host = addPlayer(room, { name: '练习玩家', avatar: 1 }, 'socket');
      for (let index = 1; index < count; index++) addPlayer(room, { name: `机器人 ${index}`, avatar: index }, null);
      startRound(room, host, room.revision);
      for (let moves = 0; room.phase === 'playing'; moves++) {
        assert(moves < 2_000);
        const seat = room.players.find((player) => player.id === room.turn)!;
        const ids = chooseMove(seat.hand, room.lastPlay?.shape);
        if (ids.length) playCards(room, seat, { revision: room.revision, ids });
        else passTurn(room, seat, room.revision);
      }
      assert.equal(room.phase, 'finished');
      assert.equal(room.players.reduce((sum, player) => sum + player.score, 0), 0);
    }
  }
});
