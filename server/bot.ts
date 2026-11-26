import type { Card, Shape } from '../shared/protocol.js';
import { canBeat, identifyPlay } from './rules.js';

function* moveGroups(hand: Card[], last?: Shape) {
  const byRank = new Map<number, Card[]>();
  for (const card of hand) {
    if (!byRank.has(card.rank)) byRank.set(card.rank, []);
    byRank.get(card.rank)!.push(card);
  }
  const jokers = [...(byRank.get(16) ?? []), ...(byRank.get(17) ?? [])];
  function group(shape: Shape, low: number, copies: number) {
    if (last && !canBeat(shape, last)) return;
    const groups = Array.from({ length: shape.high - low + 1 }, (_, i) => byRank.get(low + i) ?? []);
    const natural = groups.flatMap((cards) => cards.slice(0, copies));
    if (!natural.length || natural.length + jokers.length < shape.size) return;
    return { groups, natural, size: shape.size, jokers };
  }

  for (let rank = 3; rank <= 15; rank++) {
    if (!byRank.has(rank)) continue;
    for (const size of [1, 2, 3, 4]) {
      const match = group({ kind: size === 1 ? 'single' : size === 2 ? 'pair' : 'bomb', high: rank, size }, rank, size);
      if (match) yield match;
    }
  }
  for (const copies of [1, 2]) {
    const kind = copies === 1 ? 'straight' : 'pairs';
    if (last && last.kind !== kind) continue;
    for (let low = 3; low <= 14; low++) {
      for (let high = low + (copies === 1 ? 2 : 1); high <= 14; high++) {
        const size = (high - low + 1) * copies;
        if (size > hand.length) break;
        const match = group({ kind, high, size }, low, copies);
        if (match) yield match;
      }
    }
  }
}

export function hasLegalMove(hand: Card[], last: Shape): boolean {
  return !moveGroups(hand, last).next().done;
}

export function playableCardIds(hand: Card[], last?: Shape): string[] {
  const ids = new Set<string>();
  for (const { groups, size, jokers } of moveGroups(hand, last)) {
    for (const cards of groups) for (const card of cards) ids.add(card.id);
    // Any joker can fill a missing slot or replace one ordinary card, but never stand alone.
    if (size > 1) for (const card of jokers) ids.add(card.id);
  }
  return [...ids];
}

export function chooseMove(hand: Card[], last?: Shape): string[] {
  if (identifyPlay(hand, last)) return hand.map((card) => card.id);
  let best: Card[] = [];
  let bestValue = Infinity;
  for (const { natural, size, jokers } of moveGroups(hand, last)) {
    const wilds = size - natural.length;
    const cards = [...natural, ...jokers.slice(0, wilds)];
    const shape = identifyPlay(cards, last)!;
    const value = 2000 * Number(shape.kind === 'bomb') - 70 * size + 20 * wilds + shape.high;
    if (value < bestValue) {
      best = cards;
      bestValue = value;
    }
  }
  return best.map((card) => card.id);
}
