import { describe, it, assert, assertEqual } from './test-runner.js';
import worker, { resetStorageCachesForTests } from '../src/index.js';
import { APP_BUILD, APP_VERSION } from '../src/version.js';
import { checkForUpdate, applyCodeUpdate, ghSyncRunner, guessWorkerName, resetReleaseCache, VERSION_INFO_URL } from '../src/modules/updater.js';
import { WORKER_ASSET_URL } from '../src/modules/wizardDeploy.js';

const CF_TOKEN = 'cf_' + 'x'.repeat(40);
const GH_TOKEN = 'gh_' + 'y'.repeat(40);
const WORKER_BYTES = new Uint8Array(150000).fill(9);

async function sha256Hex(bytes) {
  const d = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function createEnv() {
  resetStorageCachesForTests();
  const store = new Map();
  return {
    KV: {
      async get(k, t) { if (!store.has(k)) return null; const v = store.get(k); return t === 'json' ? JSON.parse(v) : v; },
      async put(k, v) { store.set(k, typeof v === 'string' ? v : JSON.stringify(v)); },
      async delete(k) { store.delete(k); },
      async list(o = {}) { return { keys: [...store.keys()].filter(k => k.startsWith(o.prefix || '')).map(name => ({ name })) }; }
    },
    RUNNER_SECRET: 'RunnerSecretForTests-0123456789abcdef'
  };
}

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

/** GitHub + Cloudflare ساختگی برای مسیر به‌روزرسانی */
function mockNetwork({ build = APP_BUILD + 1, hashOk = true, scripts = ['mypanel'], forkConflict = false } = {}) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const u = typeof input === 'string' ? input : input.url;
    const method = (init.method || 'GET').toUpperCase();
    const auth = (init.headers && (init.headers.Authorization || init.headers.authorization)) || '';
    calls.push({ u, method, auth, body: init.body });

    if (u === VERSION_INFO_URL) {
      return json({ version: '9.9.9', channel: 'PRO', build, sha256: hashOk ? await sha256Hex(WORKER_BYTES) : 'f'.repeat(64), size: WORKER_BYTES.length, publishedAt: 1700000000000, notes: { fa: ['یادداشت'], en: ['note'] } });
    }
    if (u === WORKER_ASSET_URL) return new Response(WORKER_BYTES, { status: 200 });
    if (u === WORKER_ASSET_URL + '.sha256') return new Response((await sha256Hex(WORKER_BYTES)) + '  worker.js\n', { status: 200 });

    if (u.startsWith('https://api.cloudflare.com/')) {
      const p = u.replace('https://api.cloudflare.com/client/v4', '');
      if (auth !== 'Bearer ' + CF_TOKEN) return json({ success: false, errors: [{ code: 10000, message: 'Authentication error' }] }, 403);
      if (p.startsWith('/accounts?')) return json({ success: true, result: [{ id: 'acc1', name: 'Acme' }] });
      if (p.endsWith('/workers/scripts') && method === 'GET') return json({ success: true, result: scripts.map(id => ({ id })) });
      if (p.endsWith('/settings') && method === 'GET') return json({ success: true, result: { bindings: [] } });
      if (/\/workers\/scripts\/[^/]+\/content$/.test(p) && method === 'PUT') return json({ success: true, result: {} });
      return json({ success: false, errors: [{ code: 1, message: 'unmocked ' + p }] }, 404);
    }

    if (u.startsWith('https://api.github.com/')) {
      const p = u.replace('https://api.github.com', '');
      if (auth !== 'Bearer ' + GH_TOKEN) return json({ message: 'Bad credentials' }, 401);
      if (p === '/user') return json({ login: 'alice' });
      if (p === '/repos/alice/Arizo_Self') return json({ full_name: 'alice/Arizo_Self', fork: true, default_branch: 'main' });
      if (p === '/repos/alice/Plain') return json({ full_name: 'alice/Plain', fork: false, default_branch: 'main' });
      if (p.endsWith('/merge-upstream')) return forkConflict ? json({ message: 'conflict' }, 409) : json({ message: 'ok', merge_type: 'fast-forward' }, 200);
      if (p.includes('/actions/runs?')) return json({ workflow_runs: [{ id: 77 }] });
      if (p.endsWith('/cancel')) return new Response(null, { status: 202 });
      if (p.endsWith('/dispatches')) return new Response(null, { status: 204 });
      return json({ message: 'unmocked ' + p }, 404);
    }
    return original(input, init);
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

async function registerOwner(env, ip) {
  const r = await worker.fetch(new Request('https://mypanel.acme.workers.dev/api/user/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': ip }, body: JSON.stringify({ username: 'boss', password: 'BossPassword@2026x' })
  }), env);
  return (await r.json()).token;
}

const adminReq = (path, token, init = {}) => new Request('https://mypanel.acme.workers.dev' + path, {
  ...init, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, 'cf-connecting-ip': '198.51.100.90', ...(init.headers || {}) }
});

describe('Updater — version check', () => {
  it('should detect a newer build and report the current one', async () => {
    resetReleaseCache();
    const net = mockNetwork({ build: APP_BUILD + 5 });
    try {
      const r = await checkForUpdate({ fresh: true });
      assertEqual(r.updateAvailable, true);
      assertEqual(r.current.build, APP_BUILD);
      assertEqual(r.current.version, APP_VERSION);
      assertEqual(r.latest.version, '9.9.9');
      assertEqual(r.latest.notes.fa.length, 1);
    } finally { net.restore(); resetReleaseCache(); }
  });

  it('should report up-to-date when the release is not newer', async () => {
    resetReleaseCache();
    const net = mockNetwork({ build: APP_BUILD });
    try {
      assertEqual((await checkForUpdate({ fresh: true })).updateAvailable, false);
    } finally { net.restore(); resetReleaseCache(); }
  });

  it('should reject malformed release info instead of trusting it', async () => {
    resetReleaseCache();
    const original = globalThis.fetch;
    globalThis.fetch = async () => json({ version: '1', build: 'abc', sha256: 'nothex' });
    try {
      let code = '';
      try { await checkForUpdate({ fresh: true }); } catch (e) { code = e.code; }
      assertEqual(code, 'bad_release_info');
    } finally { globalThis.fetch = original; resetReleaseCache(); }
  });

  it('should guess the worker name only from workers.dev hostnames', () => {
    assertEqual(guessWorkerName('mypanel.acme.workers.dev'), 'mypanel');
    assertEqual(guessWorkerName('panel.example.com'), '');
    assertEqual(guessWorkerName('a.b.c.workers.dev'), '');
  });
});

describe('Updater — applying the code update', () => {
  it('should upload only the code via the content endpoint after verifying the hash', async () => {
    resetReleaseCache();
    const net = mockNetwork();
    try {
      const out = await applyCodeUpdate({ cfToken: CF_TOKEN, workerName: 'mypanel' });
      assertEqual(out.latest.version, '9.9.9');
      const put = net.calls.find(c => c.method === 'PUT' && c.u.endsWith('/workers/scripts/mypanel/content'));
      assert(put && put.body instanceof FormData);
      const meta = JSON.parse(await put.body.get('metadata').text());
      assertEqual(meta.main_module, 'worker.js');
      assertEqual(meta.bindings, undefined);
      assertEqual(net.calls.filter(c => c.u.endsWith('/settings') && c.method !== 'GET').length, 0);
    } finally { net.restore(); resetReleaseCache(); }
  });

  it('should refuse and upload nothing when the downloaded file does not match the release hash', async () => {
    resetReleaseCache();
    const net = mockNetwork({ hashOk: false });
    try {
      let code = '';
      try { await applyCodeUpdate({ cfToken: CF_TOKEN, workerName: 'mypanel' }); } catch (e) { code = e.code; }
      assertEqual(code, 'integrity');
      assertEqual(net.calls.filter(c => c.method === 'PUT').length, 0);
    } finally { net.restore(); resetReleaseCache(); }
  });

  it('should say you are up to date unless forced', async () => {
    resetReleaseCache();
    const net = mockNetwork({ build: APP_BUILD });
    try {
      let code = '';
      try { await applyCodeUpdate({ cfToken: CF_TOKEN, workerName: 'mypanel' }); } catch (e) { code = e.code; }
      assertEqual(code, 'up_to_date');
      const forced = await applyCodeUpdate({ cfToken: CF_TOKEN, workerName: 'mypanel', force: true });
      assertEqual(forced.accountId, 'acc1');
    } finally { net.restore(); resetReleaseCache(); }
  });

  it('should fail clearly when the worker is not in the token\'s accounts or the token is wrong', async () => {
    resetReleaseCache();
    const net = mockNetwork();
    try {
      let code = '';
      try { await applyCodeUpdate({ cfToken: CF_TOKEN, workerName: 'someone-else' }); } catch (e) { code = e.code; }
      assertEqual(code, 'worker_not_found');
      code = '';
      try { await applyCodeUpdate({ cfToken: 'z'.repeat(40), workerName: 'mypanel' }); } catch (e) { code = e.code; }
      assertEqual(code, 'cf_auth');
    } finally { net.restore(); resetReleaseCache(); }
  });
});

describe('Updater — GitHub runner sync', () => {
  it('should sync the fork, cancel the running job and restart the runner', async () => {
    const net = mockNetwork();
    try {
      const r = await ghSyncRunner(GH_TOKEN, '');
      assertEqual(r.repo, 'alice/Arizo_Self');
      assertEqual(r.mergeType, 'fast-forward');
      assertEqual(r.restarted, true);
      assert(net.calls.some(c => c.u.endsWith('/merge-upstream')));
      assert(net.calls.some(c => c.u.endsWith('/runs/77/cancel')));
      assert(net.calls.some(c => c.u.endsWith('/telegram-clock.yml/dispatches')));
    } finally { net.restore(); }
  });

  it('should explain merge conflicts and refuse non-fork repositories', async () => {
    const net = mockNetwork({ forkConflict: true });
    try {
      let code = '';
      try { await ghSyncRunner(GH_TOKEN, 'alice/Arizo_Self'); } catch (e) { code = e.code; }
      assertEqual(code, 'gh_conflict');
      code = '';
      try { await ghSyncRunner(GH_TOKEN, 'alice/Plain'); } catch (e) { code = e.code; }
      assertEqual(code, 'not_fork');
      code = '';
      try { await ghSyncRunner(GH_TOKEN, '../../etc'); } catch (e) { code = e.code; }
      assertEqual(code, 'bad_request');
    } finally { net.restore(); }
  });
});

describe('Updater — admin API', () => {
  it('should hide every update endpoint from anonymous and non-admin users', async () => {
    const env = createEnv();
    await registerOwner(env, '198.51.100.81');
    for (const [path, method] of [['/api/admin/system', 'GET'], ['/api/admin/update/check', 'GET'], ['/api/admin/update/apply', 'POST'], ['/api/admin/update/runner', 'POST']]) {
      const anon = await worker.fetch(new Request('https://mypanel.acme.workers.dev' + path, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'POST' ? '{}' : undefined }), env);
      assertEqual(anon.status, 401);
    }
  });

  it('should return system specs to the owner with no secrets inside', async () => {
    const env = createEnv();
    const token = await registerOwner(env, '198.51.100.82');
    const res = await worker.fetch(adminReq('/api/admin/system', token), env);
    assertEqual(res.status, 200);
    const text = await res.text();
    const d = JSON.parse(text);
    assertEqual(d.app.version, APP_VERSION);
    assertEqual(d.app.build, APP_BUILD);
    assertEqual(d.worker.name, 'mypanel');
    assertEqual(d.storage.kv, true);
    assertEqual(d.users, 1);
    assert(!text.includes('RunnerSecretForTests'), 'runner secret must never leave the server');
  });

  it('should check for updates and apply them end to end through the API', async () => {
    const env = createEnv();
    const token = await registerOwner(env, '198.51.100.83');
    resetReleaseCache();
    const net = mockNetwork();
    try {
      const chk = await (await worker.fetch(adminReq('/api/admin/update/check?fresh=1', token), env)).json();
      assertEqual(chk.updateAvailable, true);

      const apply = await worker.fetch(adminReq('/api/admin/update/apply', token, { method: 'POST', body: JSON.stringify({ cfToken: CF_TOKEN }) }), env);
      assertEqual(apply.status, 200);
      const out = await apply.json();
      assertEqual(out.ok, true);
      assertEqual(out.workerName, 'mypanel');
      assert(net.calls.some(c => c.method === 'PUT' && c.u.endsWith('/workers/scripts/mypanel/content')));
    } finally { net.restore(); resetReleaseCache(); }
  });

  it('should ask for the worker name on custom domains and never echo the token', async () => {
    const env = createEnv();
    const token = await registerOwner(env, '198.51.100.84');
    const res = await worker.fetch(new Request('https://panel.example.com/api/admin/update/apply', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, 'cf-connecting-ip': '198.51.100.85' }, body: JSON.stringify({ cfToken: CF_TOKEN })
    }), env);
    assertEqual(res.status, 400);
    const text = await res.text();
    assertEqual(JSON.parse(text).code, 'need_worker_name');
    assert(!text.includes(CF_TOKEN));
  });

  it('should record updates in the audit log', async () => {
    const env = createEnv();
    const token = await registerOwner(env, '198.51.100.86');
    resetReleaseCache();
    const net = mockNetwork();
    try {
      await worker.fetch(adminReq('/api/admin/update/apply', token, { method: 'POST', body: JSON.stringify({ cfToken: CF_TOKEN }) }), env);
      const logs = await (await worker.fetch(adminReq('/api/admin/audit-logs', token), env)).json();
      assert(logs.events.some(e => e.details && e.details.action === 'panel_update'));
    } finally { net.restore(); resetReleaseCache(); }
  });

  it('should rate-limit repeated update attempts', async () => {
    const env = createEnv();
    const token = await registerOwner(env, '198.51.100.87');
    let limited = false;
    for (let i = 0; i < 16 && !limited; i++) {
      const res = await worker.fetch(new Request('https://panel.example.com/api/admin/update/apply', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, 'cf-connecting-ip': '198.51.100.88' }, body: '{}'
      }), env);
      if (res.status === 429) limited = true;
    }
    assert(limited);
  });
});

describe('Updater — panel UI', () => {
  it('should ship the System & Updates tab in the admin panel', async () => {
    const env = createEnv();
    const res = await worker.fetch(new Request('https://mypanel.acme.workers.dev/admin'), env);
    const html = await res.text();
    assert(html.includes('adminSubtabSystem') && html.includes('adminTabContentSystem'));
    assert(html.includes('/api/admin/update/check') && html.includes('/api/admin/update/apply'));
    assert(html.includes('System &amp; Updates') || html.includes('System & Updates'));
  });
});

describe('Updater — stored tokens & automatic updates', () => {
  const body = o => JSON.stringify(o);

  it('should store tokens encrypted, never expose them, and update without re-entering a token', async () => {
    const env = createEnv();
    const token = await registerOwner(env, '198.51.100.91');
    resetReleaseCache();
    const net = mockNetwork();
    try {
      const c = await worker.fetch(adminReq('/api/admin/update/connect', token, { method: 'POST', body: body({ cfToken: CF_TOKEN, ghToken: GH_TOKEN }) }), env);
      assertEqual(c.status, 200);
      const raw = await env.KV.get('updater:creds');
      assert(raw && raw.startsWith('v2:'), 'creds must be stored encrypted');
      assert(!raw.includes(CF_TOKEN) && !raw.includes(GH_TOKEN));

      const sText = await (await worker.fetch(adminReq('/api/admin/update/settings', token), env)).text();
      const s = JSON.parse(sText);
      assertEqual(s.connected, true);
      assertEqual(s.hasGh, true);
      assertEqual(s.workerName, 'mypanel');
      assert(!sText.includes(CF_TOKEN) && !sText.includes(GH_TOKEN), 'tokens must never be returned');

      const a = await worker.fetch(adminReq('/api/admin/update/apply', token, { method: 'POST', body: '{}' }), env);
      assertEqual(a.status, 200);
      const out = await a.json();
      assertEqual(out.ok, true);
      assertEqual(out.runner, 'ok');
      assert(net.calls.some(c => c.method === 'PUT' && c.u.endsWith('/workers/scripts/mypanel/content')));
      assert(net.calls.some(c => c.u.endsWith('/telegram-clock.yml/dispatches')));
    } finally { net.restore(); resetReleaseCache(); }
  });

  it('should refuse to store a token that cannot see the worker, and refuse stored apply when not connected', async () => {
    const env = createEnv();
    const token = await registerOwner(env, '198.51.100.92');
    const net = mockNetwork({ scripts: ['other'] });
    try {
      const c = await worker.fetch(adminReq('/api/admin/update/connect', token, { method: 'POST', body: body({ cfToken: CF_TOKEN }) }), env);
      assertEqual((await c.json()).code, 'worker_not_found');
      assertEqual(await env.KV.get('updater:creds'), null);
      const a = await worker.fetch(adminReq('/api/admin/update/apply', token, { method: 'POST', body: '{}' }), env);
      assertEqual((await a.json()).code, 'not_connected');
      const t = await worker.fetch(adminReq('/api/admin/update/auto', token, { method: 'POST', body: body({ enabled: true }) }), env);
      assertEqual(t.status, 409);
    } finally { net.restore(); }
  });

  it('should install a newer release automatically from the cron and skip when up to date', async () => {
    const env = createEnv();
    const token = await registerOwner(env, '198.51.100.93');
    resetReleaseCache();
    let net = mockNetwork();
    try {
      await worker.fetch(adminReq('/api/admin/update/connect', token, { method: 'POST', body: body({ cfToken: CF_TOKEN }) }), env);
      await worker.fetch(adminReq('/api/admin/update/auto', token, { method: 'POST', body: body({ enabled: true }) }), env);
      globalThis.__updNext = 0;
      const pending = [];
      await worker.scheduled({}, env, { waitUntil: p => pending.push(p) });
      await Promise.all(pending);
      assert(net.calls.some(c => c.method === 'PUT' && c.u.endsWith('/workers/scripts/mypanel/content')), 'auto update should replace the code');
      const st = await (await worker.fetch(adminReq('/api/admin/update/settings', token), env)).json();
      assertEqual(st.lastResult.ok, true);
      assertEqual(st.lastResult.source, 'auto');
      assertEqual(st.auto, true);

      net.restore(); resetReleaseCache();
      net = mockNetwork({ build: APP_BUILD });
      await worker.fetch(adminReq('/api/admin/update/auto', token, { method: 'POST', body: body({ enabled: true }) }), env);
      globalThis.__updNext = 0;
      const p2 = [];
      await worker.scheduled({}, env, { waitUntil: p => p2.push(p) });
      await Promise.all(p2);
      assertEqual(net.calls.filter(c => c.method === 'PUT').length, 0);
    } finally { net.restore(); resetReleaseCache(); }
  });

  it('should forget everything on disconnect', async () => {
    const env = createEnv();
    const token = await registerOwner(env, '198.51.100.94');
    const net = mockNetwork();
    try {
      await worker.fetch(adminReq('/api/admin/update/connect', token, { method: 'POST', body: body({ cfToken: CF_TOKEN }) }), env);
      await worker.fetch(adminReq('/api/admin/update/disconnect', token, { method: 'POST', body: '{}' }), env);
      const s = await (await worker.fetch(adminReq('/api/admin/update/settings', token), env)).json();
      assertEqual(s.connected, false);
      assertEqual(s.auto, false);
      assertEqual(await env.KV.get('updater:creds'), null);
    } finally { net.restore(); }
  });

  it('should keep the new endpoints admin-only', async () => {
    const env = createEnv();
    await registerOwner(env, '198.51.100.95');
    for (const [path, method] of [['/api/admin/update/settings', 'GET'], ['/api/admin/update/connect', 'POST'], ['/api/admin/update/disconnect', 'POST'], ['/api/admin/update/auto', 'POST']]) {
      const r = await worker.fetch(new Request('https://mypanel.acme.workers.dev' + path, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'POST' ? '{}' : undefined }), env);
      assertEqual(r.status, 401);
    }
  });
});
