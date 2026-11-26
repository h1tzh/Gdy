import type { ReactNode } from 'react';
import { cardRank, type Card } from '../shared/protocol.js';

const icons: Record<string, ReactNode> = {
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/></>,
  settings: <><path d="M4 6h16M4 12h16M4 18h16"/><path d="M8 4v4m8 2v4m-6 2v4" strokeWidth="3"/></>,
  people: <><circle cx="9" cy="8" r="3"/><path d="M3 18v-1a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v1m2-13a3 3 0 0 1 0 6m0 2a4 4 0 0 1 4 4v1"/></>,
  user: <><circle cx="12" cy="8" r="3"/><path d="M5 20v-2a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v2"/></>,
  plus: <path d="M12 5v14M5 12h14"/>,
  arrow: <path d="M4 12h15m-6-6 6 6-6 6"/>,
  key: <><circle cx="8" cy="10" r="4"/><path d="m11 13 7 7m-2-2 3-3m-5 1 2-2"/></>,
  dice: <><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8 8h.01m8 0h.01m-4 4h.01m-4 4h.01m8 0h.01" strokeWidth="3"/></>,
  stack: <><rect x="7" y="3" width="12" height="16" rx="2"/><path d="M4 7v12a3 3 0 0 0 3 3h9m-5-13h4m-2-2v4"/></>,
  book: <><path d="M12 6c-3-2-6-2-9-1v13c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1v13"/></>,
  chevron: <path d="m9 5 7 7-7 7"/>,
  close: <path d="m6 6 12 12M18 6 6 18"/>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></>,
  check: <path d="m5 12 4 4L19 6"/>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  exit: <><path d="M11 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5m-1-8h10m-4-4 4 4-4 4"/></>,
  crown: <path d="m3 7 4 4 5-6 5 6 4-4-2 12H5L3 7Z"/>,
  sparkle: <path d="M12 3c0 6-3 9-9 9 6 0 9 3 9 9 0-6 3-9 9-9-6 0-9-3-9-9Z"/>,
  play: <path d="m8 5 12 7-12 7V5Z"/>,
  flag: <path d="M5 21V5c7-4 8 4 15 0v10c-7 4-8-4-15 0"/>,
  trophy: <><path d="M7 4h10v8a5 5 0 0 1-10 0V4Zm5 13v4m-4 0h8M7 7H3v2a5 5 0 0 0 4 5m10-7h4v2a5 5 0 0 1-4 5"/></>,
};

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icons[name]}</svg>;
}

const suitPaths = {
  spades: 'M12 2C9.4 5.4 3 8.6 3 13.3a4.6 4.6 0 0 0 8.6 2.2c-.4 2.9-1.5 4.4-3 6h6.8c-1.5-1.6-2.6-3.1-3-6a4.6 4.6 0 0 0 8.6-2.2C21 8.6 14.6 5.4 12 2Z',
  hearts: 'M12 21.3 4.2 13.6C-1.7 7.6 5.8.6 12 6.8c6.2-6.2 13.7.8 7.8 6.8L12 21.3Z',
  clubs: 'M12 3a4.1 4.1 0 0 0-3.5 6.3A4.4 4.4 0 1 0 11 16c-.5 2.7-1.6 4.1-2.7 5.4h7.4c-1.1-1.3-2.2-2.7-2.7-5.4a4.4 4.4 0 1 0 2.5-6.7A4.1 4.1 0 0 0 12 3Z',
  diamonds: 'm12 1.5 8.1 10.6-8.1 10.4-8.1-10.4L12 1.5Z',
  joker: 'M12 1.5c0 6.7 3.8 10.5 10.5 10.5C15.8 12 12 15.8 12 22.5 12 15.8 8.2 12 1.5 12 8.2 12 12 8.2 12 1.5Z',
};

export function SuitMark({ suit = 'spades', size = 24 }: { suit?: Card['suit']; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d={suitPaths[suit]}/></svg>;
}

function randomBelow(limit: number) { return Math.floor(Math.random() * limit); }

function Eyes({ y = 24, left = 18, right = 30, color = '#212732' }: { y?: number; left?: number; right?: number; color?: string }) {
  return <g fill={color}><circle cx={left} cy={y} r="2.2"/><circle cx={right} cy={y} r="2.2"/></g>;
}

const portraits = [
  // Each silhouette stays recognizable at the 30 px size used in the player list.
  { backgrounds: ['#eea961', '#eabbb0', '#e8ce83'], art: <><path d="M8 25 9 10l11 7h8l11-7 1 15c0 11-7 16-16 16S8 36 8 25Z" fill="#593532"/><path d="m12 15 6 4-5 3Zm24 0-6 4 5 3Z" fill="#ea8c7e"/><Eyes y={26} color="#ffdb9a"/><path d="m21 31 3 3 3-3m-13-1-5-1m6 5-5 1m23-5 6-1m-6 5 5 1" fill="none" stroke="#ffdb9a" strokeWidth="1.6" strokeLinecap="round"/></> },
  { backgrounds: ['#a3d5e7', '#96cbc2', '#c0c7ee'], art: <><path d="M7 34C7 23 11 8 24 8s17 15 17 26l-3 7H10Z" fill="#243b56"/><path d="M12 31c0-10 8-12 12-6 4-6 12-4 12 6 0 4-2 8-4 10H16c-2-2-4-6-4-10Z" fill="#ffffec"/><Eyes y={28}/><path d="m20 32 4 5 4-5-4-2Z" fill="#e89536"/><path d="M11 42h8m10 0h8" stroke="#e89536" strokeWidth="3" strokeLinecap="round"/></> },
  { backgrounds: ['#e8b8d5', '#c6b5e9', '#efbcac'], art: <><path d="M13 22C9 11 11 5 15 5c4 0 7 8 7 15h4c0-7 3-15 7-15 4 0 6 6 2 17 10 11 3 20-11 20S3 33 13 22Z" fill="#fff4e7"/><path d="M15 10c2 2 3 6 3 10m15-10c-2 2-3 6-3 10" stroke="#e386a6" strokeWidth="2.8" strokeLinecap="round"/><Eyes y={29}/><path d="M21 34h6l-3 4Z" fill="#b85676"/></> },
  { backgrounds: ['#c5dc89', '#b3dfbd', '#e7d878'], art: <><path d="M7 30c0-5 2-8 5-10a7 7 0 1 1 13-4 7 7 0 1 1 12 6c3 2 4 5 4 8 0 7-7 10-17 10S7 37 7 30Z" fill="#38814e"/><circle cx="17" cy="19" r="5" fill="#fff3b7"/><circle cx="32" cy="19" r="5" fill="#fff3b7"/><Eyes y={19} left={17} right={32}/><path d="M15 30q9 9 18 0" fill="none" stroke="#d9e992" strokeWidth="2.5" strokeLinecap="round"/></> },
  { backgrounds: ['#b5acf0', '#a4c5ee', '#e9a9c9'], art: <><path d="M24 7v8" stroke="#42356e" strokeWidth="3"/><circle cx="24" cy="7" r="3.5" fill="#ffdc71"/><path d="M7 24h34v10H7Z" fill="#5f4a9b"/><rect x="10" y="15" width="28" height="26" rx="6" fill="#392f62"/><rect x="14" y="20" width="20" height="11" rx="3" fill="#aee9dc"/><Eyes y={25.5} left={19} right={29}/><path d="M20 35h8" stroke="#e4c9ff" strokeWidth="2.5" strokeLinecap="round"/></> },
  { backgrounds: ['#e98b76', '#e8b57a', '#edaa9e'], art: <><path d="m7 7 13 11h8L41 7l-2 15 2 9-17 11L7 31l2-9Z" fill="#8d3527"/><path d="m12 13 8 7-8 3Zm24 0-8 7 8 3Z" fill="#ffbd7a"/><path d="M8 29c8-4 13-1 16 5 3-6 8-9 16-5L24 42Z" fill="#fff1cb"/><Eyes y={26} left={16} right={32} color="#fff1cb"/><circle cx="24" cy="34" r="3" fill="#382a31"/></> },
  { backgrounds: ['#e2c68e', '#d7b2bd', '#b4c7a9'], art: <><circle cx="13" cy="15" r="7" fill="#363344"/><circle cx="35" cy="15" r="7" fill="#363344"/><ellipse cx="24" cy="27" rx="17" ry="14" fill="#fff5dc"/><ellipse cx="17" cy="25" rx="5" ry="6" fill="#363344" transform="rotate(25 17 25)"/><ellipse cx="31" cy="25" rx="5" ry="6" fill="#363344" transform="rotate(-25 31 25)"/><Eyes y={24} left={17} right={31} color="#fff5dc"/><path d="m20 31 4 4 4-4Z" fill="#363344"/></> },
  { backgrounds: ['#9ac9bf', '#b3bbe6', '#e5aeb5'], art: <><path d="M9 29C9 18 14 9 24 9s15 9 15 20c7 4 5 11-1 9-2 5-7 5-10 0-3 6-7 6-10 0-3 4-8 4-9-1-6 3-8-5 0-8Z" fill="#6b407f"/><Eyes y={24} left={18} right={30} color="#ffecdd"/><ellipse cx="24" cy="32" rx="3.5" ry="2.5" fill="#ffc5bc"/><circle cx="16" cy="15" r="2" fill="#cda0e3"/></> },
  { backgrounds: ['#e9a6bb', '#e6bd8a', '#b4d4eb'], art: <><path d="M6 24C6 14 13 9 24 9s18 5 18 15c0 8-9 17-18 18C15 41 6 32 6 24Z" fill="#32946f"/><ellipse cx="16.5" cy="25" rx="4.7" ry="6.8" transform="rotate(-32 16.5 25)" fill="#263651"/><ellipse cx="31.5" cy="25" rx="4.7" ry="6.8" transform="rotate(32 31.5 25)" fill="#263651"/><path d="M20 35q4 3 8 0" fill="none" stroke="#def4a9" strokeWidth="2" strokeLinecap="round"/><path d="M8 7v8m-4-4h8m26-4v6m-3-3h6" fill="none" stroke="#fff2b6" strokeWidth="1.5" strokeLinecap="round"/></> },
  { backgrounds: ['#a8c6f1', '#bad5b2', '#dfbddf'], art: <><path d="M9 18 8 8l10 6a20 20 0 0 1 12 0l10-6-1 10c8 13-2 23-15 23S1 31 9 18Z" fill="#493c62"/><circle cx="17" cy="24" r="8" fill="#f8d29a"/><circle cx="31" cy="24" r="8" fill="#f8d29a"/><Eyes y={24} left={17} right={31}/><path d="m20 30 4 6 4-6-4-3Z" fill="#df863a"/><path d="m16 36 3 2m13-2-3 2" stroke="#c1a3ce" strokeWidth="1.7" strokeLinecap="round"/></> },
  { backgrounds: ['#6fbec1', '#dfaed3', '#a7bdea'], art: <><path d="M12 28c-2-10 3-17 12-17 8 0 12 6 12 11l7 3v6l-9 4c-3 5-9 6-15 6h-4C6 41 5 34 12 28Z" fill="#ffe15f"/><path d="m35 22 8 3v6l-10 1v-6Z" fill="#e97a39"/><circle cx="29" cy="21" r="2.4" fill="#343045"/><path d="M13 32q8 7 15 0" fill="none" stroke="#ce9a43" strokeWidth="2" strokeLinecap="round"/></> },
  { backgrounds: ['#a3b2ef', '#8dc1cd', '#d4aedc'], art: <><path d="M24 6c4 0 4 9 8 12s12 0 13 4c1 4-7 7-8 11s3 10-1 12c-3 2-8-5-12-5s-9 7-12 5c-4-2 0-8-1-12S2 26 3 22c1-4 9-1 13-4S20 6 24 6Z" fill="#ffe38f"/><Eyes y={27} left={19} right={29}/><path d="M21 32q3 4 6 0" fill="none" stroke="#ad675c" strokeWidth="1.8" strokeLinecap="round"/></> },
];

export function randomAvatar(current?: number) {
  const count = portraits.length;
  const portrait = current === undefined ? randomBelow(count) : (current % count + 1 + randomBelow(count - 1)) % count;
  return randomBelow(portraits[portrait].backgrounds.length) * count + portrait;
}

export function Avatar({ seed, size = 42 }: { seed: number; size?: number }) {
  const { backgrounds, art } = portraits[seed % portraits.length];
  const background = backgrounds[Math.floor(seed / portraits.length) % backgrounds.length];
  return <svg className="avatar" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
    <rect width="48" height="48" rx="14" fill={background}/>
    <path d="M0 38Q13 30 24 33t24-4v19H0Z" fill="#172231" opacity=".12"/>
    {art}
  </svg>;
}

const suits = { spades: '黑桃', hearts: '红桃', clubs: '梅花', diamonds: '方片', joker: '' };
export function cardName(card: Card) { return `${suits[card.suit]}${cardRank(card.rank)}`; }

function JokerPortrait({ big }: { big: boolean }) {
  return <svg className="joker-portrait" viewBox="0 0 48 60" fill="none" aria-hidden="true">
    {big ? <>
      <rect x="3" y="2" width="42" height="56" rx="20" fill="#862d29" stroke="#d5a158" strokeWidth="2"/>
      <path d="M24 6v5M11 13l4 4m22-4-4 4M8 30h4m24 0h4" stroke="#efb96d" strokeWidth="2" strokeLinecap="round"/>
      <path d="M10 49c0-6 6-11 14-11s14 5 14 11c-4 5-9 7-14 7s-10-2-14-7Z" fill="#f1bc70"/>
      <path d="M15 28h18v8c0 6-4 10-9 12-5-2-9-6-9-12Z" fill="#fff0d3" stroke="#5b2721" strokeWidth="1.6"/>
      <path d="m13 17 6 5 5-9 5 9 6-5-2 12H15Z" fill="#f6c879" stroke="#572720" strokeWidth="1.6" strokeLinejoin="round"/>
      <path d="M19 33h2m6 0h2m-9 6 4-2 4 2" stroke="#622b27" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="m24 46 4 4-4 4-4-4Z" fill="#ab3e31"/>
    </> : <>
      <path d="M24 2c14 0 21 13 21 28s-7 28-21 28S3 45 3 30 10 2 24 2Z" fill="#263a53" stroke="#8fa8b5" strokeWidth="2"/>
      <path d="M33 7a6 6 0 0 0 5 9 7 7 0 1 1-5-9Z" fill="#d2e3dd"/>
      <path d="m10 31-2 3m32 5-2 3M14 10l1 3m-6 0 3 1" stroke="#b6d6cf" strokeWidth="1.7" strokeLinecap="round"/>
      <path d="M14 28c0 9 3 15 10 17 6-2 10-8 10-17Z" fill="#f5ead3" stroke="#14283f" strokeWidth="1.5"/>
      <path d="M13 30C5 26 6 16 11 15c1 5 7 4 11 9 2-8 10-9 16-4-5 1-3 8-5 11-7-3-14-3-20-1Z" fill="#78bdb1" stroke="#152a42" strokeWidth="1.5"/>
      <circle cx="10" cy="15" r="2.6" fill="#ecd598"/><circle cx="38" cy="20" r="2.6" fill="#ecd598"/>
      <path d="m11 46 6-5 7 4 7-4 6 5-7 7-6-4-6 4Z" fill="#a6d5c9" stroke="#152a42" strokeWidth="1.5"/>
      <path d="M19 33h2m6 0h2m-9 4q4 6 8 0" stroke="#20384d" strokeWidth="1.7" strokeLinecap="round"/>
    </>}
  </svg>;
}

export function PlayingCard({ card, selected, drawn, playable, onClick }: { card: Card; selected?: boolean; drawn?: boolean; playable?: boolean; onClick?: () => void }) {
  const red = card.suit === 'hearts' || card.suit === 'diamonds' || card.rank === 17;
  const label = cardRank(card.rank);
  const joker = card.suit === 'joker';
  const content = <>{drawn && <span className="new-card-tag" aria-hidden="true">新</span>}<span className="card-corner"><b>{label}</b>{!joker && <SuitMark suit={card.suit} size={12}/>}</span><span className="card-suit">{joker ? <JokerPortrait big={card.rank === 17}/> : <SuitMark suit={card.suit} size={34}/>}</span><span className="card-corner card-corner-bottom"><b>{label}</b>{!joker && <SuitMark suit={card.suit} size={12}/>}</span></>;
  const classes = `playing-card ${red ? 'red-card' : ''} ${joker ? 'joker-card' : ''} ${selected ? 'selected-card' : ''} ${drawn ? 'drawn-card' : ''} ${playable ? 'playable-card' : ''}`;
  return onClick ? <button type="button" data-card-id={card.id} aria-label={cardName(card) + (drawn ? '，刚摸到' : '') + (playable ? '，可单出或凑牌' : '')} aria-pressed={selected} onClick={onClick} className={classes}>{content}</button> : <span className={classes} role="img" aria-label={cardName(card)}>{content}</span>;
}

export function CardBack() {
  return <span className="card-back" aria-hidden="true"><span><SuitMark size={32}/></span></span>;
}

export function PreviewCards() {
  return <div className="preview-cards" aria-hidden="true">
    <div className="preview-left"><CardBack/></div>
    <div className="preview-right"><PlayingCard card={{ id: '', rank: 15, suit: 'hearts' }}/></div>
    <div className="preview-front"><PlayingCard card={{ id: '', rank: 14, suit: 'spades' }}/></div>
    <span className="preview-sparkle sparkle-left"><Icon name="sparkle" size={20}/></span>
    <span className="preview-sparkle sparkle-right"><Icon name="sparkle" size={27}/></span>
  </div>;
}
