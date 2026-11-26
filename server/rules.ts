import { randomInt } from 'node:crypto';
import type { Card, Shape, Suit } from '../shared/protocol.js';

export function shuffledDeck(copies = 1): Card[] {
  const deck: Card[] = [];
  for (let copy = 1; copy <= copies; copy++) {
    for (const suit of ['spades', 'hearts', 'clubs', 'diamonds'] as const satisfies readonly Suit[]) {
      for (let rank = 3; rank <= 15; rank++) deck.push({ id: `${copy}-${suit[0]}${rank}`, suit, rank });
    }
    deck.push({ id: `${copy}-joker16`, suit: 'joker', rank: 16 }, { id: `${copy}-joker17`, suit: 'joker', rank: 17 });
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function* shapes(cards: Card[]): Generator<Shape> {
  const size = cards.length;
  const ranks = cards.filter((card) => card.rank < 16).map((card) => card.rank);
  if (!ranks.length) return;
  if (size <= 4 && ranks.every((rank) => rank === ranks[0])) {
    yield { kind: size === 1 ? 'single' : size === 2 ? 'pair' : 'bomb', high: ranks[0], size };
  }
  const counts = new Map<number, number>();
  for (const rank of ranks) counts.set(rank, (counts.get(rank) ?? 0) + 1);
  for (const copies of [1, 2]) {
    const length = size / copies;
    if (!Number.isInteger(length) || length < (copies === 1 ? 3 : 2)) continue;
    for (let high = length + 2; high <= 14; high++) {
      const low = high - length + 1;
      if ([...counts].every(([rank, count]) => rank >= low && rank <= high && count <= copies)) {
        yield { kind: copies === 1 ? 'straight' : 'pairs', high, size };
      }
    }
  }
}

export function canBeat(next: Shape, last: Shape): boolean {
  if (next.kind === 'bomb') {
    return last.kind !== 'bomb' || next.size > last.size || (next.size === last.size && next.high > last.high);
  }
  if (next.kind !== last.kind || next.size !== last.size) return false;
  return next.high === last.high + 1
    || (next.high === 15 && last.high < 15 && (next.kind === 'single' || next.kind === 'pair'));
}

export function identifyPlay(cards: Card[], last?: Shape): Shape | undefined {
  let bomb: Shape | undefined;
  for (const shape of shapes(cards)) {
    if (!last) return shape;
    if (!canBeat(shape, last)) continue;
    if (shape.kind === last.kind) return shape;
    bomb = shape;
  }
  return bomb;
}
