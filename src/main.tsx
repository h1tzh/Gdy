import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent, type PointerEvent, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { bombMultiplier, cardRank, deckCopies, MAX_PLAYERS, REACTIONS, ROUND_OPTIONS, SHAPE_LABELS, TURN_MS, type Profile, type RoomView, type RoundLimit, type TableReaction } from '../shared/protocol.js';
import { MAX_NICKNAME_LENGTH, NICKNAME_ERROR, normalizeNickname, randomNickname } from '../shared/nicknames.js';
import { inviteCode, inviteLink, loadProfile, saveProfile, useGame } from './connection.js';
import { useTurnReminders } from './turn-reminders.js';
import { Avatar, Icon, PlayingCard, PreviewCards, SuitMark, cardName, randomAvatar } from './visuals.js';
import './style.css';

const seatLayouts = [[0], [0, 3], [0, 2, 4], [0, 1, 3, 5], [0, 1, 2, 4, 5], [0, 1, 2, 3, 4, 5]];
const compactTable = '(max-width: 690px), (orientation: landscape) and (max-height: 540px) and (max-width: 1100px)';

function TurnClock({ deadline, serverTime }: { deadline: number; serverTime: number }) {
  const remaining = Math.max(0, Math.min(TURN_MS, deadline - serverTime));
  const [seconds, setSeconds] = useState(() => Math.ceil(remaining / 1000));
  useEffect(() => {
    const end = performance.now() + remaining;
    const refresh = () => setSeconds(Math.max(0, Math.ceil((end - performance.now()) / 1000)));
    refresh();
    const timer = window.setInterval(refresh, 100);
    return () => window.clearInterval(timer);
  }, [deadline, serverTime, remaining]);
  return <span className={`turn-clock ${seconds <= 5 ? 'turn-clock-low' : ''}`} aria-label={`剩余 ${seconds} 秒`}><Icon name="clock" size={15}/><b>{seconds}s</b></span>;
}

function Table({ room, reactions, onInvite, onReact, onReactionEnd, onNudge }: { room: RoomView | null; reactions: TableReaction[]; onInvite: () => void; onReact: (to: string) => void; onReactionEnd: (id: string) => void; onNudge?: (revision: number) => void }) {
  const myIndex = room?.players.findIndex((player) => player.id === room.you) ?? 0;
  const rotated = room ? [...room.players.slice(myIndex), ...room.players.slice(0, myIndex)] : [];
  const layout = seatLayouts[Math.max(0, rotated.length - 1)];
  const turn = room?.players.find((player) => player.id === room.turn);
  const winner = room?.settlement.find((player) => player.playerId === room.winner);
  const last = room?.lastPlay;
  const lastPlayer = room?.players.find((player) => player.id === last?.playerId);
  const drawnBy = room?.players.find((player) => player.id === room.lastDraw?.playerId);
  const roundActive = room?.phase === 'playing';
  const finished = room?.phase === 'finished';
  const practice = room?.mode === 'practice';
  const status = room?.finalScores ? '已完赛' : finished ? '已结算' : '等待开局';

  return <section className="panel table-panel" aria-label="牌桌">
    <header className="panel-head">
      <div className="panel-heading"><span className="symbol-tile"><SuitMark size={18}/></span><div><h2>{practice ? '人机牌桌' : room ? '房间牌桌' : '好友牌桌'}</h2><p>{room ? `${practice ? '人机练习' : `房间 ${room.code}`}${room.round ? ` · 第 ${room.round} 局` : ''}${room.roundLimit ? ` / 共 ${room.roundLimit} 局` : ''}` : '给朋友留个座，随时开一局'}</p></div></div>
      {roundActive ? <span className="pill round-multiplier" role="status" title="全桌倍数；输家留王的额外翻倍在结算时单独计算">本局倍数 <strong>×{bombMultiplier(room.bombCount)}</strong></span>
        : <span className="pill"><span className="status-dot"/>{status}</span>}
    </header>
    {roundActive && turn && <div className={`turn-banner ${turn.id === room.you ? 'your-turn' : ''}`}>
      <Avatar seed={turn.avatar} size={25}/><strong>{turn.id === room.you ? '轮到你了' : `轮到 ${turn.name}`}</strong>
      {turn.autoPlay ? <small>托管中</small> : turn.id === room.you && room.turnNudges > 0 ? <small className="nudged-label" role="status">有人催牌</small> : null}
      {room.turnDeadline != null && <TurnClock deadline={room.turnDeadline} serverTime={room.serverTime}/>}
      {turn.id !== room.you && turn.online && !turn.bot && !turn.autoPlay && <button className="nudge-button" type="button" disabled={!onNudge} onClick={() => onNudge?.(room.revision)}>催牌</button>}
    </div>}
    <div className={`arena ${room ? 'arena-in-room' : ''}`}>
      <span className="arena-index">TABLE / 01</span><span className="arena-decor" aria-hidden="true">♠ <span>♥</span> ♣ <span>♦</span></span>
      <div className="felt" aria-hidden="true"><div className="felt-line"/><span className="felt-mark"><SuitMark size={118}/></span></div>
      {Array.from({ length: MAX_PLAYERS }, (_, index) => {
        const player = rotated[layout.indexOf(index)];
        const portrait = player && <><Avatar seed={player.avatar} size={43}/>{!player.online && <span className="away-dot" title="已掉线"/>}{room?.host === player.id && <span className="host-dot" title="房主"><Icon name="crown" size={11}/></span>}</>;
        return <div className={`seat seat-${index} ${player ? 'seat-occupied' : ''} ${player && player.id === turn?.id ? 'seat-turn' : ''} ${player && player.id === last?.playerId ? 'seat-last-play' : ''}`} key={index}>
          {player ? <>
            {room?.you === player.id ? <div className="seat-portrait">{portrait}</div> : <button type="button" className="seat-portrait seat-action" aria-label={`和${player.name}互动`} title={`和${player.name}互动`} onClick={() => onReact(player.id)}>{portrait}</button>}
            <span className="seat-name" title={player.name}>{player.name}{room?.you === player.id ? ' · 我' : ''}</span>
            {(roundActive || finished) && <span className="seat-count">{!player.online ? (roundActive ? '掉线托管' : '已掉线') : room?.passes.includes(player.id) ? '过牌' : `${player.count} 张`}</span>}
          </> : <><span className="seat-empty"><Icon name="plus" size={18}/></span><span className="seat-name">空座</span></>}
        </div>;
      })}
      <div className="arena-center">
        {!room || room.phase === 'lobby' ? <>
          <PreviewCards/>
          {room ? <button className="invite-inline" type="button" onClick={onInvite}><Icon name="copy" size={13}/> 邀请朋友上桌</button> : <span className="table-caption">GĀN DÈNG YǍN</span>}
        </> : <>
          {winner && <div className="winner-label"><Icon name="trophy" size={17}/>{winner.playerId === room.you ? '你赢啦！' : `${winner.name} 赢得本局`}</div>}
          {finished && !winner ? <div className="winner-label"><Icon name="flag" size={17}/>流局 · 不计分</div> : last ? <>
            <div className="play-author" aria-label="出牌者">
              {lastPlayer && <Avatar seed={lastPlayer.avatar} size={27}/>}
              <strong title={lastPlayer?.name}>{last.playerId === room.you ? '你' : lastPlayer?.name ?? winner?.name ?? '已离桌玩家'}</strong>
              <span>{last.automatic ? '自动出牌' : '出牌'}</span>
            </div>
            <div className="played-cards" style={{ '--card-count': last.cards.length } as CSSProperties}>{last.cards.map((card) => <PlayingCard card={card} key={card.id}/>)}</div>
            <span className="table-caption last-play">{SHAPE_LABELS[last.shape.kind]} · {cardRank(last.shape.high)}</span>
          </> : <div className="lead-placeholder">
            {drawnBy && room.lastDraw ? <span className="table-draw" key={room.lastDraw.revision}><Icon name="stack" size={17}/>{drawnBy.id === room.you ? '你摸了一张牌' : `${drawnBy.name} 摸了一张牌`}</span> : <SuitMark size={33}/>}
            <span>{turn?.id === room.you ? '请你出牌' : `等 ${turn?.name ?? '玩家'} 出牌`}</span>
          </div>}
        </>}
      </div>
      {reactions.filter((item) => item.code === room?.code).map((item) => {
        const from = rotated.findIndex((player) => player.id === item.from);
        const to = rotated.findIndex((player) => player.id === item.to);
        if (from < 0 || to < 0) return null;
        const [symbol, label] = REACTIONS[item.kind];
        return <span key={item.id} className="table-reaction" role="img" aria-label={`${rotated[from].name}向${rotated[to].name}丢了${label}`} style={{ '--from-x': `var(--seat-${layout[from]}-x)`, '--from-y': `var(--seat-${layout[from]}-y)`, '--to-x': `var(--seat-${layout[to]}-x)`, '--to-y': `var(--seat-${layout[to]}-y)` } as CSSProperties} onAnimationEnd={() => onReactionEnd(item.id)}>{symbol}</span>;
      })}
    </div>
    <footer className="table-footer"><span><Icon name="people" size={16}/>{room ? `${room.players.length} / ${MAX_PLAYERS} 人已入座` : '2–6 人联机'}</span><span className="table-notice" title={room?.notice}>{room?.notice}</span><span><Icon name="stack" size={15}/>{roundActive && room ? `底牌 ${room.deckCount} 张` : room ? `${deckCopies(room.players.length)} 副牌` : '按人数配牌'}</span></footer>
  </section>;
}

function RulesSummary({ onRules }: { onRules: () => void }) {
  return <section className="panel quick-rules">
    <div className="quick-title"><span className="symbol-tile rule-icon"><Icon name="book" size={17}/></span><div><h2>牌桌小抄</h2><p>QUICK RULES</p></div></div>
    <div className="quick-row"><span>2–4 位玩家</span><b>1 副牌 <small>· 54 张</small></b></div>
    <div className="quick-row"><span>5–6 位玩家</span><b>2 副牌 <small>· 108 张</small></b></div>
    <button type="button" className="text-action" onClick={onRules}>查看完整规则 <Icon name="arrow" size={15}/></button>
  </section>;
}

function ProfileFields({ value, onChange, id }: { value: Profile; onChange: (profile: Profile) => void; id: string }) {
  return <div className="profile-fields">
    <label htmlFor={id}>你的昵称</label>
    <div className="profile-row">
      <button type="button" className="avatar-button" aria-label="随机头像" title="随机头像" onClick={() => onChange({ ...value, avatar: randomAvatar(value.avatar) })}>
        <Avatar seed={value.avatar} size={42}/><span><Icon name="dice" size={12}/></span>
      </button>
      <div className="input-wrap">
        <input id={id} value={value.name} onChange={(event) => onChange({ ...value, name: event.target.value })} autoComplete="nickname" spellCheck={false} placeholder={`输入昵称（最多 ${MAX_NICKNAME_LENGTH} 字）`}/>
        <button type="button" className="nickname-button" aria-label="随机昵称" title="随机昵称" onClick={() => onChange({ ...value, name: randomNickname(value.name.trim()) })}><Icon name="dice" size={15}/>随机</button>
      </div>
    </div>
  </div>;
}

function Dialog({ title, children, close }: { title: string; children: ReactNode; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="dialog" aria-label={title} onCancel={close} onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
    <div className="dialog-content"><div className="dialog-head"><h2>{title}</h2><button type="button" className="icon-button" onClick={close} aria-label="关闭弹窗"><Icon name="close" size={21}/></button></div>{children}</div>
  </dialog>;
}

function RuleDetails() {
  return <div className="rule-details">
    <section><h3>01 / 开局</h3><p>2–4 人用 1 副牌（54 张），5–6 人用 2 副牌（108 张）。每人发 5 张，领出者多拿 1 张。首局房主领出，下一局由上局赢家领出。</p></section>
    <section><h3>02 / 接牌</h3><p>普通牌必须同牌型、同张数，而且刚好大一级。比如单 6 接单 5，对 8 接对 7，顺子 456 接 345。单 2 能压更小的任意单张，22 能压更小的任意对子。顺子至少 3 张，连对至少 2 对，2 不参与顺子或连对。</p><p>3 或 4 张同点数是炸弹，可以压任何普通牌，不受刚好大一级的限制。炸弹先比张数，四张大于三张；同张数再比点数，所以 444 和 888 都能压 333。</p></section>
    <section><h3>03 / 大小王</h3><p>王只能和普通牌一起凑牌，不能单出，也没有王炸。</p></section>
    <section><h3>04 / 过牌与补牌</h3><p>其他人都过牌后，只有最后成功出牌的人从公共牌堆摸一张，然后由他重新领出。底牌用完则直接领出。若领出者只剩王，就顺延给下一位能领出的玩家；若全桌只剩王，则流局不计分。</p></section>
    <section><h3>05 / 胜负与计分</h3><p>先出完手牌的人赢，其他玩家剩几张就扣几分，赢家获得扣分总和。每出一次炸弹，全桌结算翻倍一次；输家手里有王，自己的扣分再翻倍一次。比如本局出了 2 次炸弹，没留王的输家按 4 倍扣分，留王的按 8 倍扣分。</p></section>
    <section><h3>06 / 选牌与托管</h3><p>轮到你时，能单出或凑成合法牌组的牌会亮边。可以点选，也可以横扫多张牌；从已选中的牌开始横扫可取消选中。每回合 15 秒，超时自动出牌或过牌。开启托管后系统会直接代打，可随时取消。</p></section>
  </div>;
}

function HandStrip({ hand, drawnCardId, playable, selected, setSelected, canSelect }: {
  hand: RoomView['hand']; drawnCardId: RoomView['drawnCardId']; playable: Set<string>;
  selected: string[]; setSelected: (update: (ids: string[]) => string[]) => void; canSelect: boolean;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const row = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ pointer: number; x: number; y: number; index: number; select: boolean; moved: boolean } | null>(null);
  const skipClick = useRef(false);
  const [overflow, setOverflow] = useState(false);

  useLayoutEffect(() => {
    const strip = scroll.current;
    const cards = row.current;
    if (!strip || !cards) return;
    const measure = () => setOverflow(strip.scrollWidth > strip.clientWidth + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(strip);
    observer.observe(cards);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const strip = scroll.current;
    const card = strip?.querySelector<HTMLElement>('.drawn-card');
    if (!strip || !card) return;
    const target = card.getBoundingClientRect();
    const bounds = strip.getBoundingClientRect();
    if (target.left < bounds.left || target.right > bounds.right) strip.scrollLeft += target.left - bounds.left - (strip.clientWidth - card.offsetWidth) / 2;
  }, [drawnCardId]);

  function cardIndex(target: Element | null) {
    const button = target?.closest<HTMLButtonElement>('button[data-card-id]');
    return button && row.current?.contains(button) ? hand.findIndex((card) => card.id === button.dataset.cardId) : -1;
  }

  function startSwipe(event: PointerEvent<HTMLDivElement>) {
    if (!canSelect || !event.isPrimary || event.button !== 0) return;
    const index = cardIndex(event.target as Element);
    if (index < 0) return;
    skipClick.current = false;
    gesture.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, index, select: !selected.includes(hand[index].id), moved: false };
    (event.target as Element).closest('button')?.setPointerCapture(event.pointerId);
  }

  function moveSwipe(event: PointerEvent<HTMLDivElement>) {
    const drag = gesture.current;
    const strip = scroll.current;
    const cards = row.current?.children;
    if (!canSelect || !drag || drag.pointer !== event.pointerId || !strip || !cards?.length) return;
    const dx = Math.abs(event.clientX - drag.x);
    if (!drag.moved && (dx < 7 || dx < Math.abs(event.clientY - drag.y))) return;
    const bounds = strip.getBoundingClientRect();
    const x = Math.max(bounds.left, Math.min(bounds.right - 1, event.clientX));
    let index = cards.length - 1;
    while (index > 0 && cards[index].getBoundingClientRect().left > x) index--;
    if (drag.moved && index === drag.index) return;
    skipClick.current = true;
    drag.moved = true;
    const passed = new Set(hand.slice(Math.min(drag.index, index), Math.max(drag.index, index) + 1).map((card) => card.id));
    drag.index = index;
    const shouldSelect = drag.select;
    setSelected((ids) => shouldSelect ? [...new Set([...ids, ...passed])] : ids.filter((id) => !passed.has(id)));
  }

  function endSwipe(event: PointerEvent<HTMLDivElement>) {
    if (gesture.current?.pointer === event.pointerId) gesture.current = null;
  }

  function scrollHand(direction: number) {
    const strip = scroll.current;
    if (strip) strip.scrollBy({ left: direction * strip.clientWidth * .65 });
  }

  return <>
    <div className="hand-scroll" ref={scroll}><div className={`hand-cards${canSelect ? ' swipe-enabled' : ''}`} ref={row}
      onPointerDown={startSwipe} onPointerMove={moveSwipe} onPointerUp={endSwipe} onPointerCancel={endSwipe} onLostPointerCapture={endSwipe}
      onClickCapture={(event) => { if (event.detail > 0 && skipClick.current) { event.stopPropagation(); skipClick.current = false; } }}>
      {hand.map((card) => <PlayingCard card={card} key={card.id} drawn={card.id === drawnCardId} selected={selected.includes(card.id)} playable={playable.has(card.id)}
        onClick={canSelect ? () => setSelected((ids) => ids.includes(card.id) ? ids.filter((id) => id !== card.id) : [...ids, card.id]) : undefined}/>)}
    </div></div>
    {overflow && <div className="hand-scroll-tools"><button type="button" onClick={() => scrollHand(-1)} aria-label="向左滑看手牌">‹</button><span>滑看手牌</span><button type="button" onClick={() => scrollHand(1)} aria-label="向右滑看手牌">›</button></div>}
  </>;
}

function RoundResult({ room }: { room: RoomView }) {
  return <section id="round-result" className="panel score-panel" aria-label="本局结算与亮牌">
    <h2>本局结算与亮牌 {room.winner && room.bombCount > 0 && <small>{room.bombCount} 次炸弹 · 全桌 ×{bombMultiplier(room.bombCount)}</small>}</h2>
    {!room.winner && <p className="dialog-hint">所有玩家手里只剩王，本局不计分。</p>}
    {room.revealedHands.map(({ playerId, name, avatar, cards }) => {
      const score = room.settlement.find((entry) => entry.playerId === playerId);
      const won = room.winner === playerId;
      return <div className="round-hand" key={playerId}>
        <div className="score-row">
          <span className="score-player"><Avatar seed={avatar} size={25}/><strong>{name}{playerId === room.you ? ' · 我' : ''}</strong></span>
          <span>{won ? '本局赢家' : `剩 ${cards.length} 张${score?.hasJoker ? ' · 有王' : ''}${score && score.multiplier > 1 ? ` · ×${score.multiplier}` : ''}`}</span>
          {score && <b className={score.delta > 0 ? 'positive' : ''}>{score.delta > 0 ? '+' : ''}{score.delta} 分</b>}
        </div>
        {cards.length > 0 ? <div className="revealed-cards" role="group" aria-label={`${name}的剩余手牌`}>{cards.map((card) => <PlayingCard card={card} key={card.id}/>)}</div> : <p className="empty-reveal">已出完</p>}
      </div>;
    })}
  </section>;
}

function App() {
  const game = useGame();
  const { room, online, ready, busy, error } = game;
  const [profile, setProfile] = useState(() => {
    const saved = loadProfile();
    return { name: normalizeNickname(saved?.name) ?? randomNickname(), avatar: saved?.avatar ?? randomAvatar() };
  });
  const [draft, setDraft] = useState(profile);
  const [code, setCode] = useState(inviteCode);
  const [mode, setMode] = useState<'friends' | 'practice'>('friends');
  const [bots, setBots] = useState(2);
  const [roundLimit, setRoundLimit] = useState<RoundLimit>(5);
  const [dialog, setDialog] = useState<'rules' | 'profile' | 'settings' | 'leave' | 'invite' | 'scores' | 'reaction' | 'kick' | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const shownScores = useRef<string | null>(null);
  const me = room?.players.find((player) => player.id === room.you);
  const target = room?.players.find((player) => player.id === targetId);
  const turnPlayer = room?.players.find((player) => player.id === room.turn);
  const practice = room?.mode === 'practice';
  const isTurn = room?.phase === 'playing' && room.turn === room.you;
  const manualTurn = ready && isTurn && !me?.autoPlay && room ? `${room.code}:${room.you}:${room.revision}` : null;
  const { preferences, updatePreference } = useTurnReminders(manualTurn, room?.turnNudges ?? 0);
  const drawnCard = room?.hand.find((card) => card.id === room.drawnCardId);
  const canAct = ready && isTurn && !me?.autoPlay && !busy;
  const playable = new Set(canAct ? room?.playableCardIds : []);
  const isHost = Boolean(room && room.host === room.you);
  const canKick = !practice && isHost && target && target.id !== room?.you && !target.bot;
  const canStart = Boolean(room && room.players.length >= 2 && room.players.every((player) => player.online));
  const activeSelection = selected.filter((id) => room?.hand.some((card) => card.id === id));
  const close = () => setDialog(null);
  useEffect(() => {
    const name = normalizeNickname(profile.name);
    if (name !== null) saveProfile({ ...profile, name });
  }, [profile]);
  useEffect(() => { setSelected([]); }, [room?.round, room?.code]);
  useEffect(() => { if (!isTurn) setSelected([]); }, [isTurn]);
  useEffect(() => { if (!room?.code) setDialog(null); }, [room?.code]);
  useEffect(() => {
    if (!window.matchMedia(compactTable).matches) return;
    if (room?.phase === 'playing') window.scrollTo(0, 0);
    if (room?.phase === 'finished' && !room.finalScores) document.getElementById('round-result')?.scrollIntoView();
  }, [room?.phase, room?.round, Boolean(room?.finalScores)]);
  useEffect(() => {
    if (room?.finalScores && shownScores.current !== room.code) {
      shownScores.current = room.code;
      setDialog('scores');
    }
  }, [room?.code, room?.finalScores]);
  useEffect(() => { if (copied) { const timer = setTimeout(() => setCopied(false), 2200); return () => clearTimeout(timer); } }, [copied]);

  function validateNickname(input: Profile, id: string): Profile | null {
    const name = normalizeNickname(input.name);
    if (name !== null) return { ...input, name };
    game.setError(NICKNAME_ERROR);
    document.getElementById(id)?.focus();
    return null;
  }

  function join(event: FormEvent) {
    event.preventDefault();
    const valid = validateNickname(profile, 'lobby-name');
    if (!valid) return;
    if (code.length !== 5) { game.setError('请输入 5 位房间码。'); document.getElementById('room-code')?.focus(); return; }
    void game.join(valid, code);
  }
  function create() {
    const valid = validateNickname(profile, 'lobby-name');
    if (!valid) return;
    if (mode === 'practice') void game.practice(valid, bots);
    else void game.create(valid, roundLimit);
  }
  function editProfile() {
    game.setError('');
    setDraft(me ? { name: me.name, avatar: me.avatar } : profile);
    setDialog('profile');
  }
  function openPlayerDialog(id: string, action: 'reaction' | 'kick') {
    game.setError('');
    setTargetId(id);
    setDialog(action);
  }
  function changeProfile(event: FormEvent) {
    event.preventDefault();
    const valid = validateNickname(draft, 'edit-name');
    if (!valid) return;
    const done = () => { setProfile(valid); close(); };
    if (room) void game.profile(valid, done); else done();
  }
  async function copyInvite() {
    if (!room) return;
    try { await navigator.clipboard.writeText(inviteLink(room.code).href); setCopied(true); }
    catch { setDialog('invite'); }
  }

  return <>
    <header className="topbar"><div className="shell topbar-inner">
      <div className="brand"><span className="brand-icon"><SuitMark size={25}/></span><div><strong>干瞪眼</strong><span>THE CARD CLUB</span></div></div>
      <nav className="top-actions" aria-label="牌馆工具"><button className="nav-button" type="button" aria-label="游戏规则" onClick={() => setDialog('rules')}><Icon name="info" size={16}/><span>游戏规则</span></button><button className="nav-button settings-button" type="button" aria-label="设置" onClick={() => setDialog('settings')}><Icon name="settings" size={17}/><span>设置</span></button><span className="nav-divider"/><button className="profile-button" type="button" onClick={editProfile} aria-label="编辑个人资料" title="编辑个人资料"><Avatar seed={me?.avatar ?? profile.avatar} size={32}/>{me && <span>{me.name}</span>}</button></nav>
    </div></header>
    <main className={`shell ${room?.phase === 'playing' ? 'live-room' : ''}`}>
      <section className="intro"><div><div className="eyebrow"><span/> {practice ? 'PRACTICE TABLE' : room ? 'PRIVATE TABLE' : 'ONLINE CARD ROOM'}</div><h1>{practice ? <>人机<span>练习。</span></> : room ? <>好友<span>牌桌。</span></> : <>今晚，别<span>干瞪眼。</span></>}</h1><p>{room ? '坐稳了，下一张说不定就轮到你。' : '一张牌桌，几个老友。开房即玩，等你来接牌。'}</p></div>
      <div className={`connection ${online && ready ? '' : 'connection-off'}`} role="status"><span className="status-dot"/>{online && ready ? '联机服务在线' : '正在连接'}{!ready && error && <button className="text-action" type="button" onClick={game.reconnect}>重连</button>}</div></section>
      <div className={`layout ${room ? 'in-room' : ''}`}>
        <div className="table-column">
          <Table room={room} reactions={game.reactions} onInvite={copyInvite} onReactionEnd={game.clearReaction} onReact={(to) => openPlayerDialog(to, 'reaction')} onNudge={ready && !busy ? game.nudge : undefined}/>
          {room?.phase === 'playing' && <section className="panel hand-panel" aria-label="我的手牌">
            <header className="hand-header"><div><h2>我的手牌 <small>{room.hand.length} 张</small></h2><p role="status">{!ready ? '正在重新连接牌桌…' : me?.autoPlay ? '托管中，系统会自动操作' : isTurn ? '轮到你了，点选或滑动选牌' : turnPlayer?.online ? '等待其他玩家出牌' : '当前玩家掉线，系统将自动出牌或过牌'}</p></div>
            <div className="hand-actions"><button className="button button-outline" type="button" disabled={!canAct || !room.lastPlay} onClick={() => game.pass(room.revision, () => setSelected([]))}>过牌</button><button className="button button-primary" type="button" disabled={!canAct || !activeSelection.length} onClick={() => game.play(room.revision, activeSelection, () => setSelected([]))}>出牌{activeSelection.length ? ` (${activeSelection.length})` : ''}</button></div></header>
            <div className="hand-tools">{!ready ? <button className="auto-button" type="button" onClick={game.reconnect}>连接中 · 重连</button> : <button className="auto-button" type="button" aria-pressed={me?.autoPlay ?? false} disabled={busy} onClick={() => game.autoplay(!me?.autoPlay, () => setSelected([]))}><Icon name="clock" size={15}/>{me?.autoPlay ? '取消托管' : '开启托管'}</button>}{drawnCard && <span className="drawn-summary" role="status">新摸到：<strong>{cardName(drawnCard)}</strong></span>}</div>
            {error && !dialog && <p className="error" role="alert">{error}</p>}
            {canAct && <p className="hand-hint" role="status">{playable.size ? '亮边的牌可单出或参与凑牌' : '没有能接的牌，可以过牌'}</p>}
            <HandStrip hand={room.hand} drawnCardId={room.drawnCardId} playable={playable} selected={activeSelection} setSelected={setSelected} canSelect={ready && !me?.autoPlay}/>
          </section>}
          {room?.phase === 'finished' && <RoundResult room={room}/>}
        </div>
        <aside className="sidebar" aria-label="房间操作">
          {!room ? <section className="panel join-panel">
            <div className="aside-heading"><div className="mini-label">LET’S PLAY</div><h2>上桌打牌</h2><p>{mode === 'friends' ? '设置昵称，和朋友一起开局。' : '随时开局，和机器人切磋。'}</p></div>
            <div className="mode-toggle" aria-label="游戏模式"><button type="button" aria-pressed={mode === 'friends'} onClick={() => { setMode('friends'); game.setError(''); }}><Icon name="people" size={15}/>好友联机</button><button type="button" aria-pressed={mode === 'practice'} onClick={() => { setMode('practice'); game.setError(''); }}><Icon name="play" size={15}/>人机练习</button></div>
            <form onSubmit={mode === 'friends' ? join : (event) => { event.preventDefault(); create(); }}>
              <ProfileFields id="lobby-name" value={profile} onChange={setProfile}/>
              {mode === 'friends' ? <>
                <label className="bots-label" htmlFor="round-limit">建房局数</label><div className="input-wrap"><Icon name="flag" size={17}/><select id="round-limit" value={roundLimit} onChange={(event) => setRoundLimit(Number(event.target.value) as RoundLimit)}>{ROUND_OPTIONS.map((count) => <option value={count} key={count}>{count} 局</option>)}</select></div>
                <button className="button button-primary full" type="button" disabled={busy || !ready} onClick={create}><Icon name="plus" size={19}/> 创建房间 <span className="button-arrow"><Icon name="arrow" size={17}/></span></button>
                <div className="separator"><span/>或者，加入好友<span/></div>
                <label htmlFor="room-code">房间码</label><div className="input-wrap code-input"><Icon name="key" size={17}/><input id="room-code" placeholder="输入 5 位房间码" autoComplete="off" autoCapitalize="characters" spellCheck={false} value={code} onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5))}/></div>
                <button className="button button-outline full join-button" disabled={busy || !ready}>加入房间 <span className="button-arrow"><Icon name="arrow" size={17}/></span></button>
              </> : <>
                <label className="bots-label" htmlFor="bot-count">机器人数量</label><div className="input-wrap"><Icon name="people" size={17}/><select id="bot-count" value={bots} onChange={(event) => setBots(Number(event.target.value))}>{Array.from({ length: MAX_PLAYERS - 1 }, (_, index) => index + 1).map((count) => <option value={count} key={count}>{count} 个机器人 · {deckCopies(count + 1)} 副牌</option>)}</select></div>
                <button className="button button-primary full" disabled={busy || !ready}><Icon name="play" size={17}/>开始练习</button>
              </>}
              {error && !dialog && <p className="error" role="alert">{error}</p>}
            </form>
          </section> : <section className="panel join-panel room-panel">
            <div className="aside-heading"><div className="mini-label">{practice ? 'PRACTICE ROOM' : 'PRIVATE ROOM'}</div><h2>{practice ? '练习信息' : '房间信息'}</h2><p>{practice ? '机器人会自动接牌或过牌。' : '把房间码或链接分享给朋友。'}</p></div>
            {!practice && !room.finalScores && <button type="button" className="share-code" onClick={copyInvite} title="复制邀请链接"><strong>{room.code}</strong><span><Icon name={copied ? 'check' : 'copy'} size={17}/>{copied ? '已复制' : '复制邀请'}</span></button>}
            {room.roundLimit && <p className="match-progress">已完成 <b>{room.roundsCompleted} / {room.roundLimit}</b> 局</p>}
            <div className="room-players"><div className="roster-title">玩家 <span>{room.players.length} / {MAX_PLAYERS}</span></div>{room.players.map((player) => <div className="roster-row" key={player.id}><Avatar seed={player.avatar} size={30}/><span>{player.name}</span>{player.bot && <small>机器人</small>}{!practice && player.id === room.host && <small>房主</small>}{!player.online && <small>{room.phase === 'playing' ? '掉线托管' : '掉线'}</small>}<small className="wins" title="累计积分">{player.score > 0 ? '+' : ''}{player.score} 分</small>{isHost && !practice && player.id !== room.you && !player.bot && <button className="roster-kick" type="button" aria-label={`移出 ${player.name}`} disabled={!ready || busy} onClick={() => openPlayerDialog(player.id, 'kick')}>移出</button>}</div>)}</div>
            {room.finalScores ? <button className="button button-primary full" type="button" onClick={() => setDialog('scores')}><Icon name="trophy" size={17}/>查看记分板</button>
              : room.phase !== 'playing' && (isHost ? <><button className="button button-primary full" type="button" disabled={!ready || busy || !canStart} onClick={() => game.start(room.revision)}><Icon name="play" size={17}/>{room.phase === 'finished' ? '下一局' : '开始游戏'}</button>{!canStart && <p className="waiting-text">{room.players.length < 2 ? '至少 2 人入座后可以开局' : '等所有玩家上线后开局'}</p>}</> : <p className="waiting-text">等待房主{room.phase === 'finished' ? '开始下一局' : '开始游戏'}…</p>)}
            {room.phase === 'lobby' && error && !dialog && <p className="error" role="alert">{error}</p>}
            <button type="button" className="text-action leave-button" onClick={() => { game.setError(''); setDialog('leave'); }}><Icon name="exit" size={16}/> {practice ? '退出练习' : '离开房间'}</button>
          </section>}
          <RulesSummary onRules={() => setDialog('rules')}/>
        </aside>
      </div>
      <footer className="page-footer"><span><SuitMark size={13}/> 干瞪眼 · 好友牌馆</span><span>少说废话，多出好牌。 <span className="footer-diamond">♦</span></span></footer>
    </main>
    {dialog === 'rules' && <Dialog title="游戏规则" close={close}><RuleDetails/></Dialog>}
    {dialog === 'settings' && <Dialog title="提醒设置" close={close}>
      <label className="setting-row"><span>出牌音效</span><input type="checkbox" role="switch" checked={preferences.sound} onChange={(event) => updatePreference('sound', event.target.checked)}/></label>
      <label className="setting-row"><span>出牌和催牌震动</span><input type="checkbox" role="switch" checked={preferences.vibration} onChange={(event) => updatePreference('vibration', event.target.checked)}/></label>
      <p className="dialog-hint">提醒设置保存在本浏览器。{typeof navigator.vibrate !== 'function' ? '此浏览器不支持网页震动，仍会显示文字提示。' : '震动仅在支持的设备上生效。'}</p>
    </Dialog>}
    {dialog === 'profile' && <Dialog title="编辑个人资料" close={close}><form onSubmit={changeProfile}><ProfileFields value={draft} onChange={setDraft} id="edit-name"/><p className="dialog-hint">昵称可以自己输入，也可以随机生成。点头像可以换另一种造型。</p>{error && <p className="error" role="alert">{error}</p>}<button className="button button-primary full" disabled={busy || Boolean(room && !ready)}>保存资料</button></form></Dialog>}
    {dialog === 'scores' && room?.finalScores && <Dialog title="最终记分板" close={close}>
      <p className="dialog-hint">本房 {room.roundsCompleted} 局已打完，以下是累计积分。</p>
      <ol className="final-scores">{room.finalScores.map((entry) => <li key={entry.playerId}>
        <span className="score-rank">{room.finalScores!.findIndex((other) => other.score === entry.score) + 1}</span><Avatar seed={entry.avatar} size={34}/><strong>{entry.name}{entry.playerId === room.you ? ' · 我' : ''}</strong><b>{entry.score > 0 ? '+' : ''}{entry.score} 分</b>
      </li>)}</ol>
      <button type="button" className="button button-outline full scores-reveal" onClick={() => {
        close();
        requestAnimationFrame(() => document.getElementById('round-result')?.scrollIntoView());
      }}>查看本局亮牌</button>
    </Dialog>}
    {dialog === 'reaction' && <Dialog title={target ? `和${target.name}互动` : '玩家已离桌'} close={close}>
      {target && <div className="reaction-picker">{(Object.entries(REACTIONS) as [keyof typeof REACTIONS, typeof REACTIONS[keyof typeof REACTIONS]][]).map(([kind, [symbol, label]]) => <button className="button button-outline" type="button" key={kind} disabled={busy || !ready} onClick={() => game.react(target.id, kind, close)}><span aria-hidden="true">{symbol}</span>{label}</button>)}</div>}
      {canKick && <button className="text-action roster-kick" type="button" disabled={busy || !ready} onClick={() => openPlayerDialog(target.id, 'kick')}>移出房间</button>}
      {error && <p className="error" role="alert">{error}</p>}
    </Dialog>}
    {dialog === 'kick' && <Dialog title={canKick ? `移出 ${target.name}？` : '无法移出该玩家'} close={close}>
      <p className="dialog-hint">{!canKick ? '该玩家已离桌，或你已不具备房主权限。' : room?.phase === 'playing' ? '移出后本局取消，不计分；已完成的局和积分不受影响。' : '该玩家将离开牌桌，原来的座位无法恢复。'}</p>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="dialog-actions"><button className="button button-outline" type="button" onClick={close}>{canKick ? '取消' : '关闭'}</button>{canKick && <button className="button button-primary" type="button" disabled={busy || !ready} onClick={() => game.kick(target.id, close)}>确认移出</button>}</div>
    </Dialog>}
    {dialog === 'leave' && <Dialog title={practice ? '退出练习？' : '离开房间？'} close={close}><p className="dialog-hint">{practice ? '退出后这场练习和累计积分将被清除。' : room?.phase === 'playing' ? '这局还没结束。离开会取消本局，其他玩家将返回等待状态。' : '离开后，仍可凭房间码重新加入未开局的牌桌。'}</p>{error && <p className="error" role="alert">{error}</p>}<div className="dialog-actions"><button className="button button-outline" type="button" onClick={close}>继续留在牌桌</button><button className="button button-primary" type="button" disabled={busy || !ready} onClick={() => game.leave(() => { setSelected([]); close(); })}>{practice ? '退出练习' : '离开房间'}</button></div></Dialog>}
    {dialog === 'invite' && room && <Dialog title="邀请朋友" close={close}><p className="dialog-hint">可以长按或选中下面的链接来复制，也可以分享房间码 <b>{room.code}</b>。</p><div className="input-wrap"><input aria-label="邀请链接" value={inviteLink(room.code).href} readOnly onFocus={(event) => event.target.select()}/></div></Dialog>}
  </>;
}

createRoot(document.getElementById('root')!).render(<App/>);
