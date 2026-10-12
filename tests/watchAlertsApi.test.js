import { describe, it, assert, assertEqual } from './test-runner.js';
import worker from '../src/index.js';
import { hashPassword, generateRandomHex } from '../src/crypto.js';

function createEnv() {
  const store = new Map();
  return {
    KV: {
      async get(key, type) {
        if (!store.has(key)) return null;
        const val = store.get(key);
        return type === 'json' ? JSON.parse(val) : val;
      },
      async put(key, val) { store.set(key, typeof val === 'string' ? val : JSON.stringify(val)); },
      async delete(key) { store.delete(key); },
      async list(opts = {}) {
        const prefix = opts.prefix || '';
        return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) };
      }
    },
    RUNNER_SECRET: 'SuperAdminPassword@2026',
    API_ID: '2040',
    API_HASH: 'b18441a1ff607e10a989891a5462e627',
    ENVIRONMENT: 'test'
  };
}

async function seedUser(env, username, extraTelegram = {}) {
  const salt = generateRandomHex(16);
  const passwordHash = await hashPassword('Password@123', salt);
  await env.KV.put('user:' + username, JSON.stringify({
    username, salt, passwordHash, role: 'user', plan: '1_month',
    subscriptionUntil: Date.now() + 30 * 86400000,
    telegram: { enabled: false, userId: '424242424', ...extraTelegram }
  }));
  const users = (await env.KV.get('users_list', 'json')) || [];
  users.push(username);
  await env.KV.put('users_list', JSON.stringify(users));
  const token = generateRandomHex(32);
  await env.KV.put('token:' + token, JSON.stringify({ username, createdAt: Date.now() }));
  return token;
}

const call = (env, token, path, method, body) => worker.fetch(new Request('https://arizo.test' + path, {
  method,
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: body ? JSON.stringify(body) : undefined
}), env);

const VALID_TOKEN = '777000111:test_only_not_a_real_token';

function mockTelegram(handler) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const u = typeof input === 'string' ? input : input.url;
    if (u.includes('api.telegram.org')) return handler(u, init);
    return originalFetch(input, init);
  };
  return () => { globalThis.fetch = originalFetch; };
}

const ok = (result = true) => new Response(JSON.stringify({ ok: true, result }), { status: 200 });

/** کش حافظه Worker سراسری است؛ کلیدهای این تست را پاک می‌کنیم تا روی تست‌های بعدی اثر نگذارد */
async function cleanup(env) {
  const raw = env.KV_RAW || env.KV;
  const { keys } = await raw.list({});
  for (const k of keys) await env.KV.delete(k.name);
  await env.KV.delete('users_list');
}

describe('Watch Alerts API — Separate Notification Bot', () => {
  it('should connect a separate bot, never leak its token, and persist rules', async () => {
    const env = createEnv();
    const token = await seedUser(env, 'watcher');
    const restore = mockTelegram((u) => u.includes('/getMe')
      ? ok({ id: 777000111, is_bot: true, first_name: 'Alerts', username: 'alerts_bot' })
      : ok());
    try {
      const res = await call(env, token, '/api/telegram/watch-bot/connect', 'POST', { token: VALID_TOKEN });
      assertEqual(res.status, 200);
      const data = await res.json();
      assertEqual(data.watchAlerts.hasBot, true);
      assertEqual(data.watchAlerts.botUsername, 'alerts_bot');
      assertEqual(data.watchAlerts.chatId, '424242424');
      assert(!JSON.stringify(data).includes(VALID_TOKEN));

      const save = await call(env, token, '/api/fonts', 'POST', {
        watchAlerts: {
          enabled: true,
          chatId: '424242424',
          rules: [{ target: '@darkbitgap', mode: 'admins' }, { target: 'private', mode: 'all' }]
        }
      });
      assertEqual(save.status, 200);

      const settings = await (await call(env, token, '/api/user/me', 'GET')).json();
      assertEqual(settings.watchAlerts.enabled, true);
      assertEqual(settings.watchAlerts.rules.length, 2);
      assertEqual(settings.watchAlerts.rules[0].mode, 'admins');
      assert(!JSON.stringify(settings).includes(VALID_TOKEN));

      const stored = await env.KV.get('user:watcher', 'json');
      assertEqual(stored.telegram.watchAlerts.botToken, VALID_TOKEN);
    } finally {
      restore();
      await cleanup(env);
    }
  });

  it('should reject using the main assistant bot token as the alert bot', async () => {
    const env = createEnv();
    const token = await seedUser(env, 'mainbotuser', { bot: { token: VALID_TOKEN } });
    const res = await call(env, token, '/api/telegram/watch-bot/connect', 'POST', { token: VALID_TOKEN });
    assertEqual(res.status, 400);
    await cleanup(env);
  });

  it('should reject a bot already registered by another user', async () => {
    const env = createEnv();
    await seedUser(env, 'owner1', { watchAlerts: { botToken: VALID_TOKEN, botId: '777000111', rules: [] } });
    const token = await seedUser(env, 'thief');
    const restore = mockTelegram(() => ok({ id: 777000111, is_bot: true, username: 'alerts_bot' }));
    try {
      const res = await call(env, token, '/api/telegram/watch-bot/connect', 'POST', { token: VALID_TOKEN });
      assertEqual(res.status, 400);
    } finally {
      restore();
      await cleanup(env);
    }
  });

  it('should send a test message through the alert bot and disconnect cleanly', async () => {
    const env = createEnv();
    const token = await seedUser(env, 'tester', {
      watchAlerts: { enabled: true, botToken: VALID_TOKEN, chatId: '424242424', rules: [{ target: 'all', mode: 'all', users: [] }] }
    });
    let sentTo = null;
    const restore = mockTelegram((u, init) => {
      if (u.includes('/sendMessage')) sentTo = JSON.parse(init.body).chat_id;
      return ok();
    });
    try {
      const t = await call(env, token, '/api/telegram/watch-bot/test', 'POST');
      assertEqual(t.status, 200);
      assertEqual(sentTo, '424242424');

      const d = await call(env, token, '/api/telegram/watch-bot/disconnect', 'POST');
      assertEqual(d.status, 200);
      const stored = await env.KV.get('user:tester', 'json');
      assertEqual(stored.telegram.watchAlerts.botToken, undefined);
      assertEqual(stored.telegram.watchAlerts.enabled, false);
      assertEqual(stored.telegram.watchAlerts.rules.length, 1);
    } finally {
      restore();
      await cleanup(env);
    }
  });

  it('should accept rule updates from the runner but never change bot or enabled state', async () => {
    const env = createEnv();
    await seedUser(env, 'runneruser', {
      sessionEncrypted: 'x', enabled: true,
      watchAlerts: { enabled: true, botToken: VALID_TOKEN, chatId: '1234567', rules: [] }
    });
    const upd = await worker.fetch(new Request('https://arizo.test/api/internal/update-user-feature', {
      method: 'POST',
      headers: { Authorization: 'Bearer SuperAdminPassword@2026', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'runneruser',
        watchAlerts: { botToken: 'evil:tok', enabled: false, rules: [{ target: '-100123456', mode: 'admins', label: 'G' }] }
      })
    }), env);
    assertEqual(upd.status, 200);
    const stored = await env.KV.get('user:runneruser', 'json');
    assertEqual(stored.telegram.watchAlerts.botToken, VALID_TOKEN);
    assertEqual(stored.telegram.watchAlerts.enabled, true);
    assertEqual(stored.telegram.watchAlerts.rules[0].label, 'G');
    await cleanup(env);
  });
});
