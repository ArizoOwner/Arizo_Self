/**
 * 🔔 Watch Alerts — اعلان هوشمند پیام‌های چت‌های انتخاب‌شده در یک ربات تلگرامی جداگانه
 *
 * منطق خالص (بدون وابستگی به شبکه) برای:
 *  - پاکسازی و اعتبارسنجی تنظیمات و قوانین
 *  - تطبیق چت و فرستنده با قوانین (همه پیام‌ها / فقط ادمین‌ها و سازنده / افراد مشخص)
 *  - ساخت متن اعلان و لینک پیام
 */

export const WATCH_MODES = ['all', 'admins', 'users'];
export const MAX_WATCH_RULES = 30;
export const MAX_RULE_USERS = 20;

const KEYWORDS_ALL = new Set(['all', '*', 'همه']);
const KEYWORDS_PRIVATE = new Set(['private', 'pv', 'پیوی']);
const KEYWORDS_GROUPS = new Set(['groups', 'group', 'گروه', 'گروه‌ها', 'گروهها']);

function normalizeDigits(str) {
  return String(str)
    .replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
    .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
}

/** نرمال‌سازی ورودی هدف: آیدی عددی، @username، لینک t.me یا کلیدواژه */
export function cleanTarget(raw) {
  if (raw === null || raw === undefined) return '';
  let s = normalizeDigits(String(raw).trim().toLowerCase());
  s = s.replace(/^https?:\/\/(www\.)?t\.me\//, '').replace(/^t\.me\//, '').replace(/^@+/, '');
  const priv = s.match(/^c\/(\d+)/);
  if (priv) return priv[1];
  return s.split(/[/?#]/)[0].trim();
}

/** حذف پیشوند -100 / - از آیدی عددی گروه و کانال برای مقایسه یکسان */
export function bareChatId(value) {
  const s = normalizeDigits(String(value ?? '').trim());
  if (/^-100\d+$/.test(s)) return s.slice(4);
  if (/^-\d+$/.test(s)) return s.slice(1);
  return s;
}

function splitList(raw) {
  if (Array.isArray(raw)) return raw.map(x => String(x).trim()).filter(Boolean);
  if (typeof raw === 'string') return raw.replace(/[،;]/g, ',').split(/[,\s]+/).map(x => x.trim()).filter(Boolean);
  return [];
}

/** پاکسازی کامل تنظیمات اعلان؛ توکن ربات فقط از مقدار قبلی (ثبت‌شده با اعتبارسنجی سرور) حفظ می‌شود */
export function sanitizeWatchAlerts(input, prev = {}) {
  const src = input && typeof input === 'object' ? input : {};
  const old = prev && typeof prev === 'object' ? prev : {};

  const out = {
    enabled: src.enabled !== undefined ? !!src.enabled : !!old.enabled,
    chatId: old.chatId || '',
    rules: Array.isArray(old.rules) ? old.rules : []
  };
  for (const key of ['botToken', 'botUsername', 'botName', 'botId']) {
    if (old[key]) out[key] = old[key];
  }

  if (src.removeBot === true) {
    for (const key of ['botToken', 'botUsername', 'botName', 'botId']) delete out[key];
    out.enabled = false;
  }

  if (src.chatId !== undefined) {
    const id = normalizeDigits(String(src.chatId).trim());
    out.chatId = /^-?\d{5,16}$/.test(id) ? id : '';
  }

  if (src.rules !== undefined) {
    const rules = [];
    const seen = new Set();
    for (const r of Array.isArray(src.rules) ? src.rules : []) {
      if (!r || typeof r !== 'object') continue;
      const target = String(r.target ?? '').trim().slice(0, 100);
      if (!target) continue;
      const mode = WATCH_MODES.includes(r.mode) ? r.mode : 'all';
      const users = mode === 'users' ? splitList(r.users).map(x => x.slice(0, 64)).slice(0, MAX_RULE_USERS) : [];
      if (mode === 'users' && users.length === 0) continue;
      const key = cleanTarget(target) + '|' + mode + '|' + users.map(cleanTarget).sort().join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      const label = String(r.label ?? '').trim().slice(0, 100);
      rules.push(label ? { target, mode, users, label } : { target, mode, users });
      if (rules.length >= MAX_WATCH_RULES) break;
    }
    out.rules = rules;
  }
  return out;
}

/** آیا هدف قانون با این چت مطابقت دارد؟ chat: { id, username, title, kind: 'private'|'group'|'channel' } */
export function ruleMatchesChat(rule, chat) {
  if (!rule || !chat) return false;
  const t = cleanTarget(rule.target);
  if (!t) return false;
  if (KEYWORDS_ALL.has(t)) return true;
  if (KEYWORDS_PRIVATE.has(t)) return chat.kind === 'private';
  if (KEYWORDS_GROUPS.has(t)) return chat.kind !== 'private';
  if (/^-?\d+$/.test(t)) return chat.id !== undefined && chat.id !== '' && bareChatId(t) === bareChatId(chat.id);
  const username = String(chat.username || '').replace(/^@/, '').toLowerCase();
  if (username && t === username) return true;
  const title = String(chat.title || '').trim().toLowerCase();
  return !!title && String(rule.target).trim().toLowerCase() === title;
}

/** آیا فرستنده در لیست افراد مشخص قانون است؟ sender: { id, username } */
export function senderMatches(users, sender) {
  if (!sender || !Array.isArray(users)) return false;
  const id = bareChatId(sender.id);
  const username = String(sender.username || '').replace(/^@/, '').toLowerCase();
  return users.some(u => {
    const t = cleanTarget(u);
    if (!t) return false;
    if (/^-?\d+$/.test(t)) return !!id && bareChatId(t) === id;
    return !!username && t === username;
  });
}

/**
 * اولین قانونی که باید برای این پیام اعلان بفرستد را برمی‌گرداند (یا null).
 * isAdminFn فقط برای قانون‌های «ادمین‌ها» و فقط یک‌بار و در صورت نیاز فراخوانی می‌شود.
 */
export async function pickNotifyingRule(rules, chat, sender, isAdminFn) {
  if (!Array.isArray(rules)) return null;
  let adminResult;
  for (const rule of rules) {
    if (!ruleMatchesChat(rule, chat)) continue;
    if (rule.mode === 'users') {
      if (senderMatches(rule.users, sender)) return rule;
    } else if (rule.mode === 'admins') {
      // در گفتگوی خصوصی مفهوم «ادمین» وجود ندارد؛ طرف مقابل همیشه معتبر است
      if (chat.kind === 'private') return rule;
      if (adminResult === undefined) {
        try { adminResult = !!(await isAdminFn()); } catch (_) { adminResult = false; }
      }
      if (adminResult) return rule;
    } else {
      return rule;
    }
  }
  return null;
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** لینک مستقیم پیام (فقط برای گروه/کانال؛ پیوی لینک ندارد) */
export function buildMessageLink(chat, messageId) {
  if (!chat || chat.kind === 'private' || !messageId) return null;
  const username = String(chat.username || '').replace(/^@/, '');
  if (username) return `https://t.me/${username}/${messageId}`;
  const bare = bareChatId(chat.id);
  return /^\d+$/.test(bare) ? `https://t.me/c/${bare}/${messageId}` : null;
}

const KIND_LABEL = { private: 'گفتگوی خصوصی', group: 'گروه', channel: 'کانال' };

/** ساخت متن HTML اعلان برای ارسال از ربات اعلان */
export function buildAlertText({ chat, sender, text, mediaLabel, rule, timeLabel }) {
  const senderName = sender?.name || sender?.username || 'ناشناس';
  const senderUser = sender?.username ? ` (@${escapeHtml(sender.username)})` : '';
  const roleBadge = rule?.mode === 'admins' ? ' 👑' : '';
  const body = String(text || '').trim().slice(0, 3000);
  const lines = [
    '🔔 <b>پیام جدید در چت پایش‌شده</b>',
    '━━━━━━━━━━━━━━━━━━━━',
    `💬 <b>${KIND_LABEL[chat?.kind] || 'چت'}:</b> ${escapeHtml(chat?.title || chat?.username || chat?.id || '—')}`,
    `👤 <b>فرستنده:</b> ${escapeHtml(senderName)}${senderUser}${roleBadge}`
  ];
  if (timeLabel) lines.push(`🕒 <b>زمان:</b> <code>${escapeHtml(timeLabel)}</code>`);
  if (mediaLabel) lines.push(`📎 <b>رسانه:</b> <code>${escapeHtml(mediaLabel)}</code>`);
  lines.push(`📝 <b>متن:</b>\n<blockquote>${body ? escapeHtml(body) : '<i>(بدون متن)</i>'}</blockquote>`);
  return lines.join('\n');
}
