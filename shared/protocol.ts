export const DEFAULT_GAME_PORT = 3033;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
export const TURN_MS = 15_000;
export const ROUND_OPTIONS = [1, 5, 10, 20] as const;
export type RoundLimit = typeof ROUND_OPTIONS[number];
export type MatchScore = Pick<Profile, 'name' | 'avatar'> & { playerId: string; score: number };
export const REACTIONS = { slipper: ['🩴', '拖鞋'], rose: ['🌹', '玫瑰花'], egg: ['🥚', '鸡蛋'], tomato: ['🍅', '番茄'] } as const;
export type ReactionKind = keyof typeof REACTIONS;
export type TableReaction = { id: string; code: string; from: string; to: string; kind: ReactionKind };

export type Suit = 'spades' | 'hearts' | 'clubs' | 'diamonds' | 'joker';
export type Card = { id: string; suit: Suit; rank: number };
export type Shape = { kind: 'single' | 'pair' | 'straight' | 'pairs' | 'bomb'; high: number; size: number };
export type Profile = { name: string; avatar: number };
export type Session = { code: string; token: string; playerId: string };
export type PublicPlayer = Profile & { id: string; bot: boolean; online: boolean; autoPlay: boolean; count: number; score: number };
export type Settlement = { playerId: string; name: string; remaining: number; hasJoker: boolean; multiplier: number; delta: number };
export type RevealedHand = Profile & { playerId: string; cards: Card[] };
export type TablePlay = { playerId: string; cards: Card[]; shape: Shape; automatic: boolean };
export type RoomView = {
  code: string;
  mode: 'friends' | 'practice';
  phase: 'lobby' | 'playing' | 'finished';
  revision: number;
  round: number;
  roundLimit: RoundLimit | null;
  roundsCompleted: number;
  finalScores: MatchScore[] | null;
  you: string;
  host: string;
  turn: string | null;
  turnDeadline: number | null;
  serverTime: number;
  winner: string | null;
  bombCount: number;
  settlement: Settlement[];
  revealedHands: RevealedHand[];
  players: PublicPlayer[];
  hand: Card[];
  playableCardIds: string[];
  drawnCardId: string | null;
  deckCount: number;
  deckSize: number;
  passes: string[];
  lastPlay: TablePlay | null;
  lastDraw: { playerId: string; revision: number } | null;
  notice: string;
};

export type Result<T = void> = { ok: true; value: T } | { ok: false; error: string };
type Reply<T = void> = (result: Result<T>) => void;

export interface ClientEvents {
  create: (data: Profile & { roundLimit?: RoundLimit }, reply: Reply<Session>) => void;
  practice: (data: Profile & { bots: number }, reply: Reply<Session>) => void;
  join: (data: Profile & { code: string }, reply: Reply<Session>) => void;
  resume: (data: Session, reply: Reply<Session>) => void;
  profile: (profile: Profile, reply: Reply) => void;
  start: (revision: number, reply: Reply) => void;
  play: (data: { revision: number; ids: string[] }, reply: Reply) => void;
  pass: (revision: number, reply: Reply) => void;
  autoplay: (enabled: boolean, reply: Reply) => void;
  react: (data: { to: string; kind: ReactionKind }, reply: Reply) => void;
  leave: (reply: Reply) => void;
}

export interface ServerEvents {
  state: (view: RoomView) => void;
  removed: (reason: string) => void;
  reaction: (reaction: TableReaction) => void;
}

export const RANK_LABELS: Record<number, string> = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2', 16: '小王', 17: '大王' };
export const SHAPE_LABELS: Record<Shape['kind'], string> = {
  single: '单张', pair: '对子', straight: '顺子', pairs: '连对', bomb: '炸弹',
};

export function cardRank(rank: number) { return RANK_LABELS[rank] ?? String(rank); }
export function deckCopies(seats: number) { return seats >= 5 ? 2 : 1; }
export function bombMultiplier(bombCount: number) { return 2 ** bombCount; }
