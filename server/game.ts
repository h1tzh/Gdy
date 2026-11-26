import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { AUTO_PASS_MS, bombMultiplier, deckCopies, MAX_PLAYERS, MIN_PLAYERS, SHAPE_LABELS, TURN_MS, type Card, type MatchScore, type Profile, type RoomView, type Session, type Settlement } from '../shared/protocol.js';
import { NICKNAME_ERROR, normalizeNickname } from '../shared/nicknames.js';
import { hasLegalMove, playableCardIds } from './bot.js';
import { identifyPlay, shuffledDeck } from './rules.js';

export type RoomMember = Profile & { id: string; token: string; connection: string | null };
export type Player = RoomMember & { bot: boolean; offlineSince: number | null; autoPlay: boolean; hand: Card[]; drawnCardId: string | null; score: number; completedRound: boolean };
export type Spectator = RoomMember & { connection: string };
export type Room = {
  code: string; mode: RoomView['mode']; players: Player[]; spectators: Spectator[]; phase: RoomView['phase']; revision: number; round: number; deck: Card[]; deckSize: number;
  turn: string | null; turnDeadline: number | null; turnNudges: number; winner: string | null; lastPlay: RoomView['lastPlay']; lastDraw: RoomView['lastDraw']; passes: string[]; notice: string; updated: number;
  bombCount: number; settlement: Settlement[]; roundLimit: RoomView['roundLimit']; roundsCompleted: number; finalScores: RoomView['finalScores'];
  departedScores: MatchScore[]; revealedHands: RoomView['revealedHands'];
};

export class GameError extends Error {}
export function requireGame(condition: unknown, message: string): asserts condition {
  if (!condition) throw new GameError(message);
}

export function normalizeProfile(input: unknown): Profile {
  const data = input as Partial<Profile> | null;
  const name = normalizeNickname(data?.name);
  requireGame(name !== null, NICKNAME_ERROR);
  const avatar = data?.avatar;
  return { name, avatar: typeof avatar === 'number' && Number.isInteger(avatar) && avatar >= 0 && avatar <= 0xffffffff ? avatar : randomInt(2 ** 32) };
}

export function createRoom(code: string, mode: RoomView['mode'] = 'friends', roundLimit: RoomView['roundLimit'] = mode === 'friends' ? 5 : null): Room {
  return { code, mode, players: [], spectators: [], phase: 'lobby', revision: 0, round: 0, roundLimit, roundsCompleted: 0, finalScores: null, departedScores: [], deck: [], deckSize: 0, turn: null, turnDeadline: null, turnNudges: 0, winner: null, lastPlay: null, lastDraw: null, passes: [], bombCount: 0, settlement: [], revealedHands: [], notice: '房间已创建，邀请朋友来上桌。', updated: Date.now() };
}

function requireRoomSpace(room: Room) {
  requireGame(!room.finalScores, '本房已打完，不能继续加入。');
  requireGame(room.players.length + room.spectators.length < MAX_PLAYERS, '房间已满（含观战），最多 6 人。');
}

function newMember(profile: Profile) {
  return { ...profile, id: randomUUID(), token: randomBytes(24).toString('base64url') };
}

function asPlayer(member: RoomMember): Player {
  return { ...member, bot: member.connection === null, offlineSince: null, autoPlay: false, hand: [], drawnCardId: null, score: 0, completedRound: false };
}

export function addPlayer(room: Room, profile: Profile, connection: string | null): Player {
  requireRoomSpace(room);
  requireGame(room.phase !== 'playing', '牌局已经开始，等这一局结束再加入。');
  const player = asPlayer({ ...newMember(profile), connection });
  if (room.players.length) room.notice = `${player.name} 加入了牌桌。`;
  room.players.push(player);
  room.revision++;
  return player;
}

export function addSpectator(room: Room, profile: Profile, connection: string): Spectator {
  requireRoomSpace(room);
  const spectator = { ...newMember(profile), connection };
  room.spectators.push(spectator);
  return spectator;
}

export function sessionFor(room: Room, member: RoomMember): Session {
  return { code: room.code, playerId: member.id, token: member.token };
}

function sortedHand(hand: Card[]) { return hand.slice().sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id)); }

export function isAutoPlaying(player: Player) { return player.autoPlay || player.offlineSince !== null; }

export function viewFor(room: Room, member: RoomMember): RoomView {
  const player = room.players.find((seat) => seat === member);
  const { code, mode, phase, revision, round, roundLimit, roundsCompleted, finalScores, turn, turnDeadline, turnNudges, winner, lastPlay, lastDraw, passes, notice, deckSize, settlement, bombCount } = room;
  return {
    code, mode, phase, revision, round, roundLimit, roundsCompleted, finalScores, turn, turnDeadline, turnNudges, winner, lastPlay, lastDraw, passes, notice, deckSize, settlement, bombCount,
    drawnCardId: player?.drawnCardId ?? null, serverTime: Date.now(),
    deckCount: room.deck.length, you: member.id, spectating: !player, spectatorCount: room.spectators.length, host: room.players[0].id, hand: player ? sortedHand(player.hand) : [],
    playableCardIds: player && phase === 'playing' && turn === player.id && !isAutoPlaying(player) ? playableCardIds(player.hand, lastPlay?.shape) : [],
    revealedHands: phase === 'finished' ? room.revealedHands : [],
    players: room.players.map((seat) => {
      const { id, name, avatar, bot, connection, hand, score } = seat;
      return { id, name, avatar, bot, autoPlay: isAutoPlaying(seat), online: bot || Boolean(connection), count: hand.length, score };
    }),
  };
}

function setTurn(room: Room, player: Player | null) {
  const mustPass = player && room.lastPlay && !hasLegalMove(player.hand, room.lastPlay.shape);
  room.turn = player?.id ?? null;
  room.turnDeadline = player ? Date.now() + (mustPass ? AUTO_PASS_MS : TURN_MS) : null;
  room.turnNudges = 0;
}

export function nudgeTurn(room: Room, player: Player, revision: number) {
  requireGame(room.phase === 'playing' && room.revision === revision && room.turnDeadline !== null && Date.now() < room.turnDeadline, '出牌回合已更新，请再试一次。');
  const target = room.players.find((seat) => seat.id === room.turn);
  requireGame(target && target !== player && target.connection && !isAutoPlaying(target), '只能催当前在线、未托管的其他玩家。');
  room.turnNudges++;
}

export function startRound(room: Room, player: Player, revision: number) {
  requireGame(room.revision === revision, '牌桌有更新，请再试一次。');
  requireGame(room.players[0] === player, '只有房主可以开局。');
  requireGame(room.phase !== 'playing', '牌局已经开始。');
  requireGame(!room.finalScores, '本房已打完，请创建新房。');
  requireGame(room.players.length + room.spectators.length >= MIN_PLAYERS, '至少需要 2 位玩家才能开局。');
  requireGame(room.players.every((seat) => seat.bot || seat.connection), '等所有玩家上线再开局。');
  // 观战身份直到下次发牌才转为座位，期间断线不保留名额。
  room.players.push(...room.spectators.splice(0).map(asPlayer));
  const leader = room.players.find((seat) => seat.id === room.winner) ?? player;
  const deck = shuffledDeck(deckCopies(room.players.length));
  room.phase = 'playing';
  room.round = room.roundsCompleted + 1;
  room.revision++;
  room.deckSize = deck.length;
  room.deck = deck;
  room.winner = null;
  room.lastPlay = null;
  room.lastDraw = null;
  room.passes = [];
  room.bombCount = 0;
  room.settlement = [];
  room.revealedHands = [];
  for (const seat of room.players) {
    seat.hand = deck.splice(-5);
    seat.drawnCardId = null;
  }
  leader.hand.push(deck.pop()!);
  setTurn(room, leader);
  room.notice = `第 ${room.round} 局开始，${leader.name} 先出牌。`;
}

function validateTurn(room: Room, player: Player, revision: number, automatic: boolean) {
  requireGame(room.revision === revision, '牌桌有更新，请再试一次。');
  requireGame(room.phase === 'playing' && room.turn === player.id, '还没轮到你出牌。');
  if (!automatic) {
    requireGame(!isAutoPlaying(player), '托管已开启，取消托管后可以手动出牌。');
    requireGame(room.turnDeadline !== null && Date.now() < room.turnDeadline, '本回合已超时，系统将自动操作。');
  }
}

function nextSeat(room: Room, from: string) {
  const index = room.players.findIndex((player) => player.id === from);
  return room.players[(index + 1) % room.players.length];
}

function settle(room: Room, winner: Player) {
  const losses = room.players.filter((seat) => seat !== winner).map((seat) => {
    const hasJoker = seat.hand.some((card) => card.rank >= 16);
    const multiplier = bombMultiplier(room.bombCount) * (hasJoker ? 2 : 1);
    const remaining = seat.hand.length;
    const delta = -remaining * multiplier;
    seat.score += delta;
    return { playerId: seat.id, name: seat.name, remaining, hasJoker, multiplier, delta };
  });
  const delta = -losses.reduce((sum, seat) => sum + seat.delta, 0);
  winner.score += delta;
  room.settlement = [{ playerId: winner.id, name: winner.name, remaining: 0, hasJoker: false, multiplier: 1, delta }, ...losses];
}

function scoreOf({ id, name, avatar, score }: Player): MatchScore { return { playerId: id, name, avatar, score }; }

function finishRound(room: Room) {
  room.phase = 'finished';
  setTurn(room, null);
  room.roundsCompleted++;
  room.revealedHands = room.players.map(({ id, name, avatar, hand }) => ({ playerId: id, name, avatar, cards: sortedHand(hand) }));
  for (const player of room.players) player.completedRound = true;
  if (room.roundsCompleted === room.roundLimit) {
    room.finalScores = [...room.departedScores, ...room.players.map(scoreOf)].sort((a, b) => b.score - a.score);
  }
}

export function playCards(room: Room, player: Player, data: { revision: number; ids: string[] } | null, automatic = false) {
  validateTurn(room, player, data?.revision ?? -1, automatic);
  const ids = data?.ids;
  requireGame(Array.isArray(ids) && ids.length && ids.length <= player.hand.length && new Set(ids).size === ids.length, '请选择有效的手牌。');
  const cards = player.hand.filter((card) => ids.includes(card.id)).sort((a, b) => a.rank - b.rank);
  requireGame(cards.length === ids.length, '选中的牌不在你的手里。');
  const shape = identifyPlay(cards, room.lastPlay?.shape);
  requireGame(shape, room.lastPlay?.shape.kind === 'bomb'
    ? '只能用更大的炸弹压制：先比张数，同张数再比点数。'
    : room.lastPlay ? '这组牌接不上：普通牌要同牌型、同张数，且刚好大一级；单 2、对 2 和炸弹例外。' : '这组牌不符合牌型。');
  player.hand = player.hand.filter((card) => !ids.includes(card.id));
  player.drawnCardId = null;
  room.lastDraw = null;
  room.lastPlay = { playerId: player.id, cards, shape, automatic };
  if (shape.kind === 'bomb') room.bombCount++;
  room.passes = [];
  room.revision++;
  if (!player.hand.length) {
    room.winner = player.id;
    settle(room, player);
    finishRound(room);
    room.notice = `${player.name} 率先出完手牌，赢得了这一局！`;
  } else {
    setTurn(room, nextSeat(room, player.id));
    room.notice = `${player.name} ${automatic ? '自动' : ''}打出${SHAPE_LABELS[shape.kind]}。`;
  }
}

export function passTurn(room: Room, player: Player, revision: number, automatic = false) {
  validateTurn(room, player, revision, automatic);
  const last = room.lastPlay;
  requireGame(last, '你是这轮领出的人，不能过牌。');
  room.passes.push(player.id);
  player.drawnCardId = null;
  room.revision++;
  const next = nextSeat(room, player.id);
  if (next.id !== last.playerId) {
    setTurn(room, next);
    room.notice = `${player.name} ${automatic ? '自动' : ''}过牌。`;
    return;
  }
  const card = room.deck.pop();
  if (card) {
    next.hand.push(card);
    next.drawnCardId = card.id;
    room.lastDraw = { playerId: next.id, revision: room.revision };
  }
  room.passes = [];
  room.lastPlay = null;
  const drawNotice = card ? `无人接牌，${next.name} 摸一张` : '底牌用完';
  let leader = next;
  while (!leader.hand.some((card) => card.rank < 16)) {
    leader = nextSeat(room, leader.id);
    if (leader === next) {
      finishRound(room);
      room.notice = `${drawNotice}；所有玩家手里只剩王，本局流局，不计分。`;
      return;
    }
  }
  setTurn(room, leader);
  room.notice = leader === next ? `${drawNotice}，由${next.name}领出。` : `${drawNotice}；${next.name}只剩王，改由${leader.name}领出。`;
}

export function removePlayer(room: Room, player: Player, removed = false) {
  if (room.roundLimit && !room.finalScores && player.completedRound) room.departedScores.push(scoreOf(player));
  room.players = room.players.filter((seat) => seat !== player);
  room.revision++;
  if (room.phase === 'playing') {
    room.phase = 'lobby';
    room.round = room.roundsCompleted;
    setTurn(room, null);
    room.winner = room.lastPlay = room.lastDraw = null;
    room.deck = [];
    room.deckSize = 0;
    room.passes = [];
    room.bombCount = 0;
    room.settlement = [];
    for (const seat of room.players) {
      seat.hand = [];
      seat.drawnCardId = null;
    }
    room.notice = `${player.name} ${removed ? '被房主移出房间' : '离开了房间'}，本局取消。`;
  } else {
    room.notice = `${player.name} ${removed ? '被房主移出房间' : '离开了牌桌'}。`;
  }
}
