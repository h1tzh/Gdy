const descriptions = ['发呆', '暴躁', '慢熟', '迟到', '迷路', '认真', '有脚气', '机灵', '淡定'];
const nouns = ['馒头', '蘑菇', '土豆', '杯子', '石头', '蛤蟆', '拖鞋', '地瓜', '柿子', '篮子'];
const fixed = ['黑子的好大儿', '峰子严父', '田中湫泥子', '财哥', '曾亚兵家长', '伟子爸爸'];
const generated = descriptions.flatMap((description) => nouns.map((noun) => `${description}的${noun}`));
export const MAX_NICKNAME_LENGTH = 16;
export const NICKNAME_ERROR = `请输入 1–${MAX_NICKNAME_LENGTH} 个字符的昵称，不能包含换行或控制字符。`;

export function normalizeNickname(input: unknown): string | null {
  if (typeof input !== 'string' || /[\p{Cc}\p{Bidi_Control}\u2028\u2029]/u.test(input)) return null;
  const name = input.trim();
  return /[^\s\p{Cf}]/u.test(name) && [...name].length <= MAX_NICKNAME_LENGTH ? name : null;
}

export function randomNickname(current?: string, random = Math.random) {
  const pool = (random() < 0.25 ? fixed : generated).filter((name) => name !== current);
  return pool[Math.floor(random() * pool.length)];
}
