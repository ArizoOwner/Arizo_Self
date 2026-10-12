import { describe, it, assert, assertEqual } from './test-runner.js';
import worker from '../src/index.js';

function createEnv() {
  const store = new Map();
  return {
    KV: {
      async get(k, t) { if (!store.has(k)) return null; const v = store.get(k); return t === 'json' ? JSON.parse(v) : v; },
      async put(k, v) { store.set(k, typeof v === 'string' ? v : JSON.stringify(v)); },
      async delete(k) { store.delete(k); },
      async list(o = {}) { return { keys: [...store.keys()].filter(k => k.startsWith(o.prefix || '')).map(name => ({ name })) }; }
    },
    ADMIN_PASSWORD: 'SuperAdminPassword@2026',
    RUNNER_SECRET: 'SuperAdminPassword@2026',
    API_ID: '2040',
    API_HASH: 'b18441a1ff607e10a989891a5462e627'
  };
}

const hook = (env, user, headers = {}) => worker.fetch(new Request('https://arizo.test/api/bot-webhook/' + user, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify({ message: { message_id: 1, from: { id: 111 }, chat: { id: 111 }, text: '/start' } })
}), env);

describe('Webhook security — Telegram secret token', () => {
  it('should reject forged updates for a user whose webhook is secured', async () => {
    const env = createEnv();
    await env.KV.put('user:victim', JSON.stringify({
      username: 'victim', role: 'user',
      telegram: { userId: '111', bot: { token: '123456:FAKE_VALID_TOKEN_1234567890abcdefgh', webhookSecured: true } }
    }));
    const noHeader = await hook(env, 'victim');
    assertEqual(noHeader.status, 403);
    const wrong = await hook(env, 'victim', { 'X-Telegram-Bot-Api-Secret-Token': 'not-the-secret' });
    assertEqual(wrong.status, 403);
  });

  it('should keep working for users not migrated yet (no lockout during rollout)', async () => {
    const env = createEnv();
    await env.KV.put('user:legacy', JSON.stringify({
      username: 'legacy', role: 'user',
      telegram: { userId: '111', bot: { token: '123456:FAKE_VALID_TOKEN_1234567890abcdefgh' } }
    }));
    const res = await hook(env, 'legacy');
    assertEqual(res.status, 200);
  });
});
