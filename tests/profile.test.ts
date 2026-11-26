import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { normalizeProfile } from '../server/game.js';
import { MAX_NICKNAME_LENGTH, randomNickname } from '../shared/nicknames.js';
import { Avatar, randomAvatar } from '../src/visuals.js';

test('随机昵称符合服务端规则，且不会连续生成相同昵称', () => {
  let name = randomNickname();
  for (let i = 0; i < 100; i++) {
    const next = randomNickname(name);
    assert.notEqual(next, name);
    assert.equal(normalizeProfile({ name: next, avatar: 0 }).name, next);
    name = next;
  }
});

test('固定名单和形容词加名词都可随机抽出', () => {
  const fixed = ['黑子的好大儿', '峰子严父', '田中湫泥子', '财哥', '曾亚兵家长', '伟子爸爸'];
  for (const [index, expected] of fixed.entries()) {
    const rolls = [0, (index + .5) / fixed.length];
    assert.equal(randomNickname(undefined, () => rolls.shift()!), expected);
    assert.equal(normalizeProfile({ name: expected, avatar: 0 }).name, expected);
  }
  const mixed = [0.5, 0];
  assert.match(randomNickname(undefined, () => mixed.shift()!), /^发呆的.+$/);
});

test('接受自定义昵称并去掉首尾空格，拒绝空白、超长和控制字符', () => {
  assert.equal(normalizeProfile({ name: '  自定义昵称 🃏  ', avatar: 0 }).name, '自定义昵称 🃏');
  const max = '🃏'.repeat(MAX_NICKNAME_LENGTH);
  assert.equal(normalizeProfile({ name: max, avatar: 0 }).name, max);
  for (const name of [null, 123, '', '　 ', '\u200b', '昵称\n换行', '甲\u202e乙', `${max}甲`]) {
    assert.throws(() => normalizeProfile({ name, avatar: 0 }), /请输入.*字符的昵称/);
  }
});

test('随机更换头像会改变角色轮廓，而不只是背景颜色', () => {
  const silhouette = (seed: number) => renderToStaticMarkup(createElement(Avatar, { seed })).replace(/<rect width="48"[^>]+>/, '');
  for (let current = 0; current < 36; current++) {
    const next = randomAvatar(current);
    assert.notEqual(silhouette(next), silhouette(current));
  }
});
