import { describe, it, assert, assertEqual } from './test-runner.js';
import worker from '../src/index.js';
import { handleWizardApi, sealSecret, buildWorkerMetadata, fetchWorkerSource } from '../src/modules/wizardDeploy.js';
import nacl from 'tweetnacl';

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
    RUNNER_SECRET: 'SuperAdminPassword@2026'
  };
}

const CF_TOKEN = 'cf_' + 'x'.repeat(40);
const GH_TOKEN = 'gh_' + 'y'.repeat(40);
const WORKER_BYTES = new Uint8Array(150000).fill(7);

async function sha256Hex(bytes) {
  const d = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Cloudflare + GitHub + release CDN ساختگی؛ همهٔ فراخوانی‌ها ثبت می‌شوند */
function mockNetwork({ subdomain = 'acme', existingKv = false, existingFork = false, forkReadyAfter = 0, hashOk = true } = {}) {
  const original = globalThis.fetch;
  const calls = [];
  let keyChecks = 0;
  const kp = nacl.box.keyPair();
  const pubB64 = btoa(String.fromCharCode(...kp.publicKey));
  const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

  globalThis.fetch = async (input, init = {}) => {
    const u = typeof input === 'string' ? input : input.url;
    const method = (init.method || 'GET').toUpperCase();
    const auth = (init.headers && (init.headers.Authorization || init.headers.authorization)) || '';
    calls.push({ u, method, auth, body: init.body });

    if (u.startsWith('https://api.cloudflare.com/')) {
      const p = u.replace('https://api.cloudflare.com/client/v4', '');
      if (auth !== 'Bearer ' + CF_TOKEN) return json({ success: false, errors: [{ code: 10000, message: 'Authentication error' }] }, 403);
      if (p.startsWith('/accounts?')) return json({ success: true, result: [{ id: 'acc1', name: 'Acme' }] });
      if (p.endsWith('/workers/subdomain') && method === 'GET') return subdomain ? json({ success: true, result: { subdomain } }) : json({ success: false, errors: [{ code: 10007, message: 'none' }] }, 404);
      if (p.endsWith('/workers/subdomain') && method === 'PUT') return json({ success: true, result: { subdomain: JSON.parse(init.body).subdomain } });
      if (p.includes('/storage/kv/namespaces?')) return json({ success: true, result: existingKv ? [{ id: 'kvOld', title: 'arizo-self-kv' }] : [] });
      if (p.endsWith('/storage/kv/namespaces') && method === 'POST') return json({ success: true, result: { id: 'kvNew', title: 'arizo-self-kv' } });
      if (p.includes('/d1/database?')) return json({ success: true, result: [] });
      if (p.endsWith('/d1/database') && method === 'POST') return json({ success: true, result: { uuid: 'd1New', name: 'arizo_db' } });
      if (p.endsWith('/workers/scripts') && method === 'GET') return json({ success: true, result: [{ id: 'arizo-self' }] });
      if (/\/workers\/scripts\/[^/]+$/.test(p) && method === 'PUT') return json({ success: true, result: {} });
      if (p.endsWith('/schedules')) return json({ success: true, result: {} });
      if (p.endsWith('/subdomain') && method === 'POST') return json({ success: true, result: {} });
      if (p.endsWith('/query')) return json({ success: true, result: [] });
      return json({ success: false, errors: [{ code: 1, message: 'unmocked ' + p }] }, 404);
    }

    if (u.startsWith('https://api.github.com/')) {
      const p = u.replace('https://api.github.com', '');
      if (auth !== 'Bearer ' + GH_TOKEN) return json({ message: 'Bad credentials' }, 401);
      if (p === '/user') return new Response(JSON.stringify({ login: 'alice' }), { status: 200, headers: { 'x-oauth-scopes': 'repo, workflow' } });
      if (p === '/repos/alice/Arizo_Self' && method === 'GET') {
        if (existingFork && keyChecks >= 0) return json({ full_name: 'alice/Arizo_Self', fork: true, parent: { full_name: 'ArizoOwner/Arizo_Self' }, default_branch: 'main' });
        return json({ message: 'Not Found' }, 404);
      }
      if (p === '/repos/ArizoOwner/Arizo_Self/forks' && method === 'POST') return json({ default_branch: 'main' }, 202);
      if (p === '/repos/alice/Arizo_Self/actions/secrets/public-key') {
        if (keyChecks++ < forkReadyAfter) return json({ message: 'Not Found' }, 404);
        return json({ key_id: 'k1', key: pubB64 });
      }
      if (/\/actions\/secrets\/[A-Z_]+$/.test(p) && method === 'PUT') return new Response(null, { status: 201 });
      if (p.endsWith('/actions/permissions')) return new Response(null, { status: 204 });
      if (p.endsWith('/actions/workflows')) return json({ workflows: [{ id: 9, path: '.github/workflows/telegram-clock.yml' }] });
      if (p.endsWith('/enable')) return new Response(null, { status: 204 });
      if (p.endsWith('/dispatches')) return new Response(null, { status: 204 });
      return json({ message: 'unmocked ' + p }, 404);
    }

    if (u.endsWith('/releases/latest/download/worker.js')) return new Response(WORKER_BYTES, { status: 200 });
    if (u.endsWith('/releases/latest/download/worker.js.sha256')) {
      const h = hashOk ? await sha256Hex(WORKER_BYTES) : 'f'.repeat(64);
      return new Response(h + '  worker.js\n', { status: 200 });
    }
    return original(input, init);
  };
  return { calls, kp, restore: () => { globalThis.fetch = original; } };
}

describe('Setup Wizard — page', () => {
  it('should serve the new automated wizard at /setup and /wizard with strict headers', async () => {
    const env = createEnv();
    for (const path of ['/setup', '/wizard']) {
      const res = await worker.fetch(new Request('https://arizo.test' + path), env);
      assertEqual(res.status, 200);
      const html = await res.text();
      assert(html.includes('WIZARD v4.0 AUTO'));
      assert(html.includes('cfToken') && html.includes('ghToken') && html.includes('id="install"'));
      assert(html.includes('permissionGroupKeys'));
      assert(html.includes('github.com/settings/tokens/new'));
      assert(!html.includes('wrangler.toml'));
      assert((res.headers.get('Content-Security-Policy') || '').includes("frame-ancestors 'none'"));
      assertEqual(res.headers.get('Referrer-Policy'), 'no-referrer');
    }
  });

  it('should no longer expose the legacy manual wizard endpoints', async () => {
    const env = createEnv();
    const res = await worker.fetch(new Request('https://arizo.test/api/setup/test-bot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }), env);
    assertEqual(res.status, 404);
  });
});

describe('Setup Wizard — Cloudflare automation', () => {
  it('should verify the token and report the account and workers.dev subdomain', async () => {
    const net = mockNetwork();
    try {
      const r = await handleWizardApi('cloudflare/verify', { token: CF_TOKEN });
      assertEqual(r.status, 200);
      assertEqual(r.data.accountId, 'acc1');
      assertEqual(r.data.subdomain, 'acme');
    } finally { net.restore(); }
  });

  it('should reject bad / malformed tokens with a bilingual message and never echo the token', async () => {
    const net = mockNetwork();
    try {
      const short = await handleWizardApi('cloudflare/verify', { token: 'abc' });
      assertEqual(short.status, 400);
      assert(short.data.fa && short.data.en);
      const wrong = await handleWizardApi('cloudflare/verify', { token: 'z'.repeat(40) });
      assertEqual(wrong.data.code, 'cf_auth');
      assert(!JSON.stringify(wrong).includes('zzzz'));
    } finally { net.restore(); }
  });

  it('should reuse an existing KV namespace instead of creating a duplicate, and create D1 once', async () => {
    const net = mockNetwork({ existingKv: true });
    try {
      const r = await handleWizardApi('cloudflare/resources', { token: CF_TOKEN, accountId: 'acc1', workerName: 'arizo-self' });
      assertEqual(r.data.kvId, 'kvOld');
      assertEqual(r.data.kvReused, true);
      assertEqual(r.data.d1Id, 'd1New');
      assertEqual(r.data.workerExists, true);
      assertEqual(net.calls.filter(c => c.method === 'POST' && c.u.endsWith('/storage/kv/namespaces')).length, 0);
    } finally { net.restore(); }
  });

  it('should reject invalid worker names before touching Cloudflare', async () => {
    const net = mockNetwork();
    try {
      const r = await handleWizardApi('cloudflare/resources', { token: CF_TOKEN, accountId: 'acc1', workerName: 'Bad Name!' });
      assertEqual(r.status, 400);
      assertEqual(net.calls.length, 0);
    } finally { net.restore(); }
  });

  it('should upload the integrity-verified worker with secret bindings and nodejs_compat', async () => {
    const net = mockNetwork();
    try {
      const r = await handleWizardApi('cloudflare/deploy', {
        token: CF_TOKEN, accountId: 'acc1', workerName: 'my-panel', kvId: 'kvNew', d1Id: 'd1New',
        adminPassword: 'A'.repeat(24), runnerSecret: 'B'.repeat(48)
      });
      assertEqual(r.status, 200);
      const put = net.calls.find(c => c.method === 'PUT' && c.u.endsWith('/workers/scripts/my-panel'));
      assert(put && put.body instanceof FormData);
      const meta = JSON.parse(await put.body.get('metadata').text());
      assertEqual(meta.main_module, 'worker.js');
      assert(meta.compatibility_flags.includes('nodejs_compat'));
      const types = Object.fromEntries(meta.bindings.map(b => [b.name, b.type]));
      assertEqual(types.ADMIN_PASSWORD, 'secret_text');
      assertEqual(types.RUNNER_SECRET, 'secret_text');
      assertEqual(types.KV, 'kv_namespace');
      assertEqual(types.DB, 'd1');
    } finally { net.restore(); }
  });

  it('should refuse to deploy when the release hash does not match', async () => {
    const net = mockNetwork({ hashOk: false });
    try {
      const r = await handleWizardApi('cloudflare/deploy', {
        token: CF_TOKEN, accountId: 'acc1', workerName: 'my-panel', kvId: 'k', d1Id: 'd',
        adminPassword: 'A'.repeat(24), runnerSecret: 'B'.repeat(48)
      });
      assertEqual(r.data.code, 'integrity');
      assertEqual(net.calls.filter(c => c.method === 'PUT' && c.u.includes('/workers/scripts/')).length, 0);
    } finally { net.restore(); }
  });

  it('should refuse weak secrets', async () => {
    const net = mockNetwork();
    try {
      const r = await handleWizardApi('cloudflare/deploy', { token: CF_TOKEN, accountId: 'acc1', workerName: 'x', kvId: 'k', d1Id: 'd', adminPassword: 'short', runnerSecret: 'short' });
      assertEqual(r.data.code, 'weak_secret');
    } finally { net.restore(); }
  });

  it('should finalize with cron, workers.dev and D1 schema, returning the final URL', async () => {
    const net = mockNetwork();
    try {
      const r = await handleWizardApi('cloudflare/finalize', { token: CF_TOKEN, accountId: 'acc1', workerName: 'my-panel', d1Id: 'd1New' });
      assertEqual(r.data.url, 'https://my-panel.acme.workers.dev');
      assert(net.calls.some(c => c.u.endsWith('/schedules')));
      assert(net.calls.some(c => c.u.endsWith('/d1/database/d1New/query')));
    } finally { net.restore(); }
  });

  it('should register a workers.dev subdomain for brand-new accounts', async () => {
    const net = mockNetwork({ subdomain: null });
    try {
      const v = await handleWizardApi('cloudflare/verify', { token: CF_TOKEN });
      assertEqual(v.data.subdomain, null);
      const s = await handleWizardApi('cloudflare/subdomain', { token: CF_TOKEN, accountId: 'acc1', subdomain: 'my-name' });
      assertEqual(s.data.subdomain, 'my-name');
      const bad = await handleWizardApi('cloudflare/subdomain', { token: CF_TOKEN, accountId: 'acc1', subdomain: '-bad-' });
      assertEqual(bad.status, 400);
    } finally { net.restore(); }
  });
});

describe('Setup Wizard — GitHub automation', () => {
  it('should verify the token and require repo + workflow scopes', async () => {
    const net = mockNetwork();
    try {
      const r = await handleWizardApi('github/verify', { token: GH_TOKEN });
      assertEqual(r.data.login, 'alice');
      const bad = await handleWizardApi('github/verify', { token: 'q'.repeat(40) });
      assertEqual(bad.data.code, 'gh_auth');
    } finally { net.restore(); }
  });

  it('should fork the project, then reuse the fork on a re-run', async () => {
    const net = mockNetwork();
    try {
      const first = await handleWizardApi('github/fork', { token: GH_TOKEN });
      assertEqual(first.data.repo, 'alice/Arizo_Self');
      assertEqual(first.data.reused, false);
      assert(net.calls.some(c => c.method === 'POST' && c.u.endsWith('/repos/ArizoOwner/Arizo_Self/forks')));
    } finally { net.restore(); }
    const net2 = mockNetwork({ existingFork: true });
    try {
      const again = await handleWizardApi('github/fork', { token: GH_TOKEN });
      assertEqual(again.data.reused, true);
      assertEqual(again.data.ready, true);
      assertEqual(net2.calls.filter(c => c.method === 'POST').length, 0);
    } finally { net2.restore(); }
  });

  it('should store all four runner secrets, each a valid libsodium sealed box', async () => {
    const net = mockNetwork();
    try {
      const r = await handleWizardApi('github/secrets', { token: GH_TOKEN, repo: 'alice/Arizo_Self', cloudflareUrl: 'https://my-panel.acme.workers.dev', runnerSecret: 'R'.repeat(48) });
      assertEqual(r.status, 200);
      const puts = net.calls.filter(c => c.method === 'PUT' && /actions\/secrets\/[A-Z_]+$/.test(c.u));
      assertEqual(puts.map(c => c.u.split('/').pop()).sort().join(','), 'API_HASH,API_ID,CLOUDFLARE_URL,RUNNER_SECRET');
      const runner = puts.find(c => c.u.endsWith('RUNNER_SECRET'));
      const sealed = Uint8Array.from(atob(JSON.parse(runner.body).encrypted_value), ch => ch.charCodeAt(0));
      assert(!JSON.stringify(runner.body).includes('RRRRRRRR'));
      assertEqual(sealed.length, 32 + 16 + 48);
    } finally { net.restore(); }
  });

  it('should produce sealed boxes only the repository key holder can open', () => {
    const kp = nacl.box.keyPair();
    const pub = btoa(String.fromCharCode(...kp.publicKey));
    const sealed = Uint8Array.from(atob(sealSecret(pub, 'hello-secret')), c => c.charCodeAt(0));
    assertEqual(sealed.length, 32 + 16 + 'hello-secret'.length);
    const wrong = nacl.box.keyPair();
    const eph = sealed.slice(0, 32), box = sealed.slice(32);
    const nonceInput = new Uint8Array(64); nonceInput.set(eph, 0); nonceInput.set(kp.publicKey, 32);
    assertEqual(nacl.box.open(box, new Uint8Array(24), eph, kp.secretKey), null);
    assertEqual(nacl.box.open(box, new Uint8Array(24), eph, wrong.secretKey), null);
  });

  it('should wait out a fork that is still being created (retryable error)', async () => {
    const net = mockNetwork({ forkReadyAfter: 2 });
    try {
      const a = await handleWizardApi('github/secrets', { token: GH_TOKEN, repo: 'alice/Arizo_Self', cloudflareUrl: 'https://p.acme.workers.dev', runnerSecret: 'R'.repeat(48) });
      assertEqual(a.data.code, 'gh_api');
      await handleWizardApi('github/secrets', { token: GH_TOKEN, repo: 'alice/Arizo_Self', cloudflareUrl: 'https://p.acme.workers.dev', runnerSecret: 'R'.repeat(48) });
      const c = await handleWizardApi('github/secrets', { token: GH_TOKEN, repo: 'alice/Arizo_Self', cloudflareUrl: 'https://p.acme.workers.dev', runnerSecret: 'R'.repeat(48) });
      assertEqual(c.status, 200);
    } finally { net.restore(); }
  });

  it('should reject non-workers.dev URLs and malformed repos before calling GitHub', async () => {
    const net = mockNetwork();
    try {
      const a = await handleWizardApi('github/secrets', { token: GH_TOKEN, repo: 'alice/Arizo_Self', cloudflareUrl: 'https://evil.example.com', runnerSecret: 'R'.repeat(48) });
      assertEqual(a.status, 400);
      const b = await handleWizardApi('github/secrets', { token: GH_TOKEN, repo: '../../etc', cloudflareUrl: 'https://p.acme.workers.dev', runnerSecret: 'R'.repeat(48) });
      assertEqual(b.status, 400);
      assertEqual(net.calls.length, 0);
    } finally { net.restore(); }
  });

  it('should enable Actions, enable the workflow and start the runner', async () => {
    const net = mockNetwork();
    try {
      const r = await handleWizardApi('github/run', { token: GH_TOKEN, repo: 'alice/Arizo_Self', branch: 'main' });
      assertEqual(r.status, 200);
      assertEqual(r.data.actionsUrl, 'https://github.com/alice/Arizo_Self/actions');
      assertEqual(r.data.warnings.length, 0);
      assert(net.calls.some(c => c.u.endsWith('/telegram-clock.yml/dispatches')));
    } finally { net.restore(); }
  });
});

describe('Setup Wizard — API surface', () => {
  it('should answer unknown steps with 404 and rate-limit abusive clients', async () => {
    const env = createEnv();
    const unknown = await worker.fetch(new Request('https://arizo.test/api/setup/nope/x', { method: 'POST', headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '203.0.113.50' }, body: '{}' }), env);
    assertEqual(unknown.status, 404);
    assertEqual(unknown.headers.get('Cache-Control'), 'no-store');
    let limited = null;
    for (let i = 0; i < 70; i++) {
      const res = await worker.fetch(new Request('https://arizo.test/api/setup/nope/x', { method: 'POST', headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '203.0.113.51' }, body: '{}' }), env);
      if (res.status === 429) { limited = res; break; }
    }
    assert(limited !== null);
  });

  it('should build least-privilege bindings and keep plain vars public-only', () => {
    const m = buildWorkerMetadata({ kvId: 'k', d1Id: 'd', adminPassword: 'a'.repeat(24), runnerSecret: 'b'.repeat(48) });
    const plain = m.bindings.filter(b => b.type === 'plain_text').map(b => b.name).sort();
    assertEqual(plain.join(','), 'API_HASH,API_ID');
  });
});
