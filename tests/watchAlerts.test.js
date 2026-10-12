import { describe, it, assert, assertEqual } from './test-runner.js';
import {
  cleanTarget,
  bareChatId,
  sanitizeWatchAlerts,
  ruleMatchesChat,
  senderMatches,
  pickNotifyingRule,
  buildMessageLink,
  buildAlertText
} from '../src/modules/watchAlerts.js';

const group = { id: '-1001234567890', kind: 'group', username: 'darkbitgap', title: 'darkbit' };
const pv = { id: '555', kind: 'private', username: 'ali', title: 'علی' };

describe('Watch Alerts — Target Normalization', () => {
  it('should normalize usernames, t.me links and persian digits', () => {
    assertEqual(cleanTarget('@DarkBitGap'), 'darkbitgap');
    assertEqual(cleanTarget('https://t.me/darkbitgap'), 'darkbitgap');
    assertEqual(cleanTarget('https://t.me/c/1234567890/55'), '1234567890');
    assertEqual(cleanTarget('۱۲۳۴۵'), '12345');
  });

  it('should treat -100 prefixed ids and bare ids as the same chat', () => {
    assertEqual(bareChatId('-1001234567890'), '1234567890');
    assertEqual(bareChatId('1234567890'), '1234567890');
    assertEqual(bareChatId('-987'), '987');
  });
});

describe('Watch Alerts — Settings Sanitizer', () => {
  it('should keep stored bot token and never accept a token from input', () => {
    const prev = { botToken: '1:abc', botUsername: 'alertbot', rules: [] };
    const out = sanitizeWatchAlerts({ enabled: true, botToken: 'evil:token', chatId: '123456789' }, prev);
    assertEqual(out.botToken, '1:abc');
    assertEqual(out.enabled, true);
    assertEqual(out.chatId, '123456789');
  });

  it('should reject invalid chat ids and drop invalid / duplicate rules', () => {
    const out = sanitizeWatchAlerts({
      chatId: 'abc',
      rules: [
        { target: '@darkbitgap', mode: 'admins' },
        { target: '@DarkBitGap', mode: 'admins' },
        { target: '', mode: 'all' },
        { target: 'x', mode: 'users', users: [] },
        { target: 'y', mode: 'bogus' }
      ]
    }, {});
    assertEqual(out.chatId, '');
    assertEqual(out.rules.length, 2);
    assertEqual(out.rules[1].mode, 'all');
  });

  it('should disconnect bot and disable alerts with removeBot', () => {
    const out = sanitizeWatchAlerts({ removeBot: true }, { enabled: true, botToken: '1:abc', botUsername: 'b', rules: [{ target: 'all', mode: 'all', users: [] }] });
    assertEqual(out.botToken, undefined);
    assertEqual(out.enabled, false);
    assertEqual(out.rules.length, 1);
  });
});

describe('Watch Alerts — Rule Matching', () => {
  it('should match by numeric id with or without -100 prefix', () => {
    assert(ruleMatchesChat({ target: '-1001234567890' }, group));
    assert(ruleMatchesChat({ target: '1234567890' }, group));
    assert(!ruleMatchesChat({ target: '999' }, group));
  });

  it('should match by username and by t.me link', () => {
    assert(ruleMatchesChat({ target: '@darkbitgap' }, group));
    assert(ruleMatchesChat({ target: 'https://t.me/darkbitgap' }, group));
    assert(!ruleMatchesChat({ target: '@other' }, group));
  });

  it('should support keywords private / groups / all', () => {
    assert(ruleMatchesChat({ target: 'private' }, pv));
    assert(!ruleMatchesChat({ target: 'private' }, group));
    assert(ruleMatchesChat({ target: 'groups' }, group));
    assert(!ruleMatchesChat({ target: 'groups' }, pv));
    assert(ruleMatchesChat({ target: 'all' }, pv) && ruleMatchesChat({ target: 'all' }, group));
  });

  it('should match specific senders by id or username', () => {
    assert(senderMatches(['@Boss', '777'], { id: '1', username: 'boss' }));
    assert(senderMatches(['777'], { id: '777', username: '' }));
    assert(!senderMatches(['@boss'], { id: '1', username: 'other' }));
  });
});

describe('Watch Alerts — Notifying Rule Selection', () => {
  it('should notify for admin rule only when sender is admin and check admin lazily once', async () => {
    let calls = 0;
    const rules = [{ target: '@darkbitgap', mode: 'admins', users: [] }, { target: 'groups', mode: 'admins', users: [] }];
    const hit = await pickNotifyingRule(rules, group, { id: '1' }, async () => { calls++; return true; });
    assert(hit !== null);
    assertEqual(calls, 1);
    const miss = await pickNotifyingRule(rules, group, { id: '2' }, async () => false);
    assertEqual(miss, null);
  });

  it('should not call admin check when no admin rule matches the chat', async () => {
    let calls = 0;
    const hit = await pickNotifyingRule([{ target: '999', mode: 'admins', users: [] }], group, { id: '1' }, async () => { calls++; return true; });
    assertEqual(hit, null);
    assertEqual(calls, 0);
  });

  it('should always notify in private chats for admins mode and fail closed on admin check error', async () => {
    const pvHit = await pickNotifyingRule([{ target: 'private', mode: 'admins', users: [] }], pv, { id: '555' }, async () => false);
    assert(pvHit !== null);
    const errMiss = await pickNotifyingRule([{ target: 'groups', mode: 'admins', users: [] }], group, { id: '9' }, async () => { throw new Error('x'); });
    assertEqual(errMiss, null);
  });

  it('should honor users-mode rules', async () => {
    const rules = [{ target: 'groups', mode: 'users', users: ['@boss'] }];
    assert(await pickNotifyingRule(rules, group, { id: '1', username: 'boss' }, async () => false));
    assertEqual(await pickNotifyingRule(rules, group, { id: '2', username: 'x' }, async () => false), null);
  });
});

describe('Watch Alerts — Message Link & Text', () => {
  it('should build public and private links, none for private chats', () => {
    assertEqual(buildMessageLink(group, 42), 'https://t.me/darkbitgap/42');
    assertEqual(buildMessageLink({ ...group, username: '' }, 42), 'https://t.me/c/1234567890/42');
    assertEqual(buildMessageLink(pv, 42), null);
  });

  it('should escape HTML in alert text', () => {
    const t = buildAlertText({
      chat: group,
      sender: { name: '<b>x</b>', username: 'u' },
      text: 'a & <script>',
      rule: { mode: 'admins' },
      timeLabel: '10:00'
    });
    assert(t.includes('&lt;b&gt;x&lt;/b&gt;'));
    assert(t.includes('a &amp; &lt;script&gt;'));
    assert(!t.includes('<script>'));
    assert(t.includes('👑'));
  });
});
