import { test } from 'node:test';
import assert from 'node:assert/strict';
import { identifyPlay, shuffledDeck } from '../server/rules.js';
import type { Card } from '../shared/protocol.js';

function cards(...ranks: number[]): Card[] {
  return ranks.map((rank, index) => ({ id: String(index), rank, suit: rank >= 16 ? 'joker' : 'spades' }));
}

test('两副牌保留不同的牌 ID，54/108 张均无重复 ID', () => {
  for (const copies of [1, 2]) {
    const deck = shuffledDeck(copies);
    assert.equal(deck.length, copies * 54);
    assert.equal(new Set(deck.map(({ id }) => id)).size, deck.length);
    assert.equal(deck.filter(({ rank }) => rank === 16).length, copies);
    assert.equal(deck.filter(({ rank }) => rank === 17).length, copies);
  }
});

test('普通牌只能接大一级，单二和对二例外', () => {
  const last = identifyPlay(cards(3))!;
  assert.equal(identifyPlay(cards(4), last)?.kind, 'single');
  assert.equal(identifyPlay(cards(5), last), undefined);
  assert.equal(identifyPlay(cards(15), last)?.kind, 'single');
  assert.equal(identifyPlay(cards(4, 4), last), undefined);
  const pair = identifyPlay(cards(6, 6))!;
  assert.equal(identifyPlay(cards(7, 16), pair)?.kind, 'pair');
  assert.equal(identifyPlay(cards(15, 15), pair)?.kind, 'pair');
  assert.equal(identifyPlay(cards(15), identifyPlay(cards(15))), undefined);
  assert.equal(identifyPlay(cards(15, 15), identifyPlay(cards(15, 15))), undefined);
});

test('同长度顺子、连对可以用王补成刚好大一级，2 不参与', () => {
  assert.equal(identifyPlay(cards(3, 4, 5))?.kind, 'straight');
  assert.equal(identifyPlay(cards(3, 4, 5, 6), identifyPlay(cards(3, 4, 5))), undefined);
  assert.deepEqual(identifyPlay(cards(5, 6, 16), identifyPlay(cards(4, 5, 6))), { kind: 'straight', size: 3, high: 7 });
  assert.equal(identifyPlay(cards(13, 14, 15)), undefined);
  assert.deepEqual(identifyPlay(cards(4, 4, 5, 17), identifyPlay(cards(3, 3, 4, 4))), { kind: 'pairs', size: 4, high: 5 });
});

test('三张、四张炸弹都能压任何普通牌', () => {
  for (const ranks of [[15], [15, 15], [12, 13, 14], [13, 13, 14, 14]]) {
    const last = identifyPlay(cards(...ranks))!;
    assert.equal(identifyPlay(cards(3, 3, 3), last)?.kind, 'bomb');
    assert.equal(identifyPlay(cards(3, 3, 3, 3), last)?.kind, 'bomb');
  }
  assert.equal(identifyPlay(cards(3, 3, 3, 3, 3)), undefined);
});

test('炸弹先比张数，同张数不限点数差；相同或更小的炸弹不能接牌', () => {
  const three = identifyPlay(cards(3, 3, 3))!;
  assert.equal(identifyPlay(cards(4, 4, 4), three)?.high, 4);
  assert.equal(identifyPlay(cards(8, 8, 8), three)?.high, 8);
  assert.equal(identifyPlay(cards(3, 3, 3), three), undefined);
  assert.equal(identifyPlay(cards(15), three), undefined);
  const highThree = identifyPlay(cards(15, 15, 15))!;
  const four = identifyPlay(cards(3, 3, 3, 3), highThree)!;
  assert.equal(four.size, 4);
  assert.equal(identifyPlay(cards(15, 15, 15), four), undefined);
  assert.equal(identifyPlay(cards(8, 8, 8, 8), four)?.high, 8);
});

test('带王的牌组能按普通牌型接上时优先用普通牌型，否则可作为炸弹', () => {
  const straight = identifyPlay(cards(3, 4, 5))!;
  assert.deepEqual(identifyPlay(cards(5, 16, 17), straight), { kind: 'straight', size: 3, high: 6 });
  assert.deepEqual(identifyPlay(cards(3, 16, 17), straight), { kind: 'bomb', size: 3, high: 3 });
});

test('纯王牌型一律无效，王可混搭普通牌', () => {
  for (const ranks of [[16], [17], [16, 17], [16, 16], [16, 16, 17], [16, 16, 17, 17]]) {
    assert.equal(identifyPlay(cards(...ranks)), undefined);
    assert.equal(identifyPlay(cards(...ranks), identifyPlay(cards(3))), undefined);
  }
  assert.equal(identifyPlay(cards(5, 16, 17))?.kind, 'bomb');
});
