/**
 * 🧙 Setup Wizard — موتور نصب خودکار روی Cloudflare و GitHub
 *
 * همه مراحل بدون حالت (stateless) هستند: توکن‌ها فقط در حافظهٔ همان درخواست استفاده می‌شوند
 * و هرگز ذخیره یا لاگ نمی‌شوند. همهٔ مراحل idempotent هستند و می‌توان دوباره اجرایشان کرد.
 */
import nacl from 'tweetnacl';
import blakejs from 'blakejs';

const { blake2b } = blakejs;

export const SOURCE_REPO = 'ArizoOwner/Arizo_Self';
export const WORKFLOW_FILE = 'telegram-clock.yml';
export const WORKER_ASSET_URL = `https://github.com/${SOURCE_REPO}/releases/latest/download/worker.js`;
export const COMPAT_DATE = '2024-09-23';
export const KV_TITLE = 'arizo-self-kv';
export const D1_NAME = 'arizo_db';
// شناسهٔ رسمی کلاینت تلگرام دسکتاپ (عمومی است و در wrangler.toml هم آمده)
const TELEGRAM_API_ID = '2040';
const TELEGRAM_API_HASH = 'b18441a1ff607e10a989891a5462e627';

const CF = 'https://api.cloudflare.com/client/v4';
const GH = 'https://api.github.com';

export class WizardError extends Error {
  constructor(code, fa, en, status = 400, extra = {}) {
    super(en);
    this.code = code;
    this.fa = fa;
    this.en = en;
    this.status = status;
    this.extra = extra;
  }
}

// ---------------------------------------------------------------- helpers
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,53}$/;
const SUBDOMAIN_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
export const REPO_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

export function validateWorkerName(name) {
  if (!NAME_RE.test(String(name || ''))) {
    throw new WizardError('bad_name',
      'نام Worker فقط می‌تواند شامل حروف کوچک انگلیسی، عدد و خط تیره باشد (حداکثر ۵۴ کاراکتر).',
      'Worker name may only contain lowercase letters, digits and dashes (max 54 chars).');
  }
  return name;
}

export function requireToken(token, kind) {
  const t = String(token || '').trim();
  if (t.length < 20 || t.length > 400 || /\s/.test(t)) {
    throw new WizardError(kind === 'cf' ? 'cf_token_format' : 'gh_token_format',
      kind === 'cf' ? 'فرمت توکن Cloudflare نامعتبر است.' : 'فرمت توکن GitHub نامعتبر است.',
      kind === 'cf' ? 'The Cloudflare token format is invalid.' : 'The GitHub token format is invalid.');
  }
  return t;
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function toHex(buf) {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * libsodium crypto_box_seal: رمزنگاری سکرت با کلید عمومی ریپوی GitHub
 * خروجی = ephemeralPublicKey(32) || crypto_box(msg, blake2b(epk||pk, 24), pk, esk)
 */
export function sealSecret(publicKeyB64, plaintext) {
  const pk = b64ToBytes(publicKeyB64);
  if (pk.length !== 32) throw new WizardError('bad_key', 'کلید عمومی ریپو نامعتبر است.', 'Invalid repository public key.', 502);
  const eph = nacl.box.keyPair();
  const input = new Uint8Array(64);
  input.set(eph.publicKey, 0);
  input.set(pk, 32);
  const nonce = blake2b(input, undefined, 24);
  const box = nacl.box(new TextEncoder().encode(String(plaintext)), nonce, pk, eph.secretKey);
  const out = new Uint8Array(32 + box.length);
  out.set(eph.publicKey, 0);
  out.set(box, 32);
  return bytesToB64(out);
}

// ---------------------------------------------------------------- Cloudflare
export async function cfCall(token, path, { method = 'GET', body, form } = {}) {
  const headers = { Authorization: 'Bearer ' + token };
  let payload;
  if (form) {
    payload = form;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(CF + path, { method, headers, body: payload });
  } catch (_) {
    throw new WizardError('network', 'ارتباط با Cloudflare برقرار نشد. دوباره تلاش کنید.', 'Could not reach Cloudflare. Please retry.', 502);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.success === false) {
    const err = data && data.errors && data.errors[0];
    const msg = err ? err.message : 'HTTP ' + res.status;
    if (res.status === 401 || res.status === 403 || (err && (err.code === 10000 || err.code === 9109))) {
      throw new WizardError('cf_auth',
        'توکن Cloudflare نامعتبر است یا دسترسی کافی ندارد (' + msg + '). دسترسی‌های Workers Scripts، KV Storage، D1 و Account Settings لازم است.',
        'The Cloudflare token is invalid or lacks permissions (' + msg + '). Workers Scripts, KV Storage, D1 and Account Settings are required.');
    }
    throw new WizardError('cf_api', 'خطای Cloudflare: ' + msg, 'Cloudflare error: ' + msg, 502, { cfCode: err && err.code });
  }
  return data.result;
}

/** مرحلهٔ ۱: اعتبارسنجی توکن، فهرست اکانت‌ها و وضعیت ساب‌دامین workers.dev */
export async function cfVerify(tokenRaw) {
  const token = requireToken(tokenRaw, 'cf');
  const accounts = await cfCall(token, '/accounts?per_page=50');
  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new WizardError('cf_no_account', 'هیچ اکانت Cloudflare‌ای برای این توکن پیدا نشد.', 'No Cloudflare account was found for this token.');
  }
  const list = accounts.map(a => ({ id: a.id, name: a.name }));
  let subdomain = null;
  try {
    const sub = await cfCall(token, `/accounts/${list[0].id}/workers/subdomain`);
    subdomain = (sub && sub.subdomain) || null;
  } catch (_) { /* اکانت جدید هنوز ساب‌دامین ندارد */ }
  return { accounts: list, accountId: list[0].id, subdomain };
}

/** ساخت ساب‌دامین workers.dev برای اکانت‌های تازه */
export async function cfEnsureSubdomain(tokenRaw, accountId, subdomain) {
  const token = requireToken(tokenRaw, 'cf');
  const name = String(subdomain || '').toLowerCase();
  if (!SUBDOMAIN_RE.test(name)) {
    throw new WizardError('bad_subdomain', 'ساب‌دامین فقط شامل حروف انگلیسی، عدد و خط تیره باشد.', 'The subdomain may only contain letters, digits and dashes.');
  }
  const res = await cfCall(token, `/accounts/${accountId}/workers/subdomain`, { method: 'PUT', body: { subdomain: name } });
  return { subdomain: (res && res.subdomain) || name };
}

/** نام منابع: برای Worker پیش‌فرض نام‌های قدیمی؛ برای بقیه مشتق از نام Worker تا چند نصب با هم تداخل نکنند */
export function resourceNames(workerName) {
  if (workerName === 'arizo-self') return { kv: KV_TITLE, d1: D1_NAME };
  return { kv: workerName + '-kv', d1: workerName.replace(/-/g, '_') + '_db' };
}

/** مرحلهٔ ۲: ساخت (یا استفادهٔ مجدد از) KV و D1 و تشخیص وجود Worker هم‌نام */
export async function cfEnsureResources(tokenRaw, accountId, workerName) {
  const token = requireToken(tokenRaw, 'cf');
  validateWorkerName(workerName);

  const namespaces = await cfCall(token, `/accounts/${accountId}/storage/kv/namespaces?per_page=100`);
  const names = resourceNames(workerName);
  let kv = (namespaces || []).find(n => n.title === names.kv);
  const kvReused = !!kv;
  if (!kv) kv = await cfCall(token, `/accounts/${accountId}/storage/kv/namespaces`, { method: 'POST', body: { title: names.kv } });

  const databases = await cfCall(token, `/accounts/${accountId}/d1/database?per_page=100`);
  let d1 = (databases || []).find(d => d.name === names.d1);
  const d1Reused = !!d1;
  if (!d1) d1 = await cfCall(token, `/accounts/${accountId}/d1/database`, { method: 'POST', body: { name: names.d1 } });

  const scripts = await cfCall(token, `/accounts/${accountId}/workers/scripts`);
  const workerExists = (scripts || []).some(s => s.id === workerName);

  return { kvId: kv.id, d1Id: d1.uuid || d1.id, kvReused, d1Reused, workerExists };
}

/** دانلود worker.js از ریلیز رسمی و راستی‌آزمایی با SHA-256 */
/** GET با چند تلاش مجدد برای ۴۲۹/۵xx و خطای شبکه (IPهای مشترک Workers گاهی از GitHub محدودیت نرخ می‌گیرند) */
export async function fetchRetry(url, init = {}, tries = 4) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, init);
      if (res.status !== 429 && res.status < 500) return res;
      last = res;
    } catch (e) { last = e; }
    if (i < tries - 1) await new Promise(r => setTimeout(r, 400 * (i + 1) ** 2));
  }
  if (last instanceof Response) return last;
  throw last;
}

export async function fetchWorkerSource(url = WORKER_ASSET_URL) {
  let res, shaRes;
  try {
    [res, shaRes] = await Promise.all([fetchRetry(url, { redirect: 'follow' }), fetchRetry(url + '.sha256', { redirect: 'follow' })]);
  } catch (_) {
    throw new WizardError('download', 'دانلود worker.js از GitHub ممکن نشد.', 'Could not download worker.js from GitHub.', 502);
  }
  if (!res.ok) {
    throw new WizardError('download', 'فایل worker.js در ریلیز GitHub پیدا نشد (HTTP ' + res.status + ').', 'worker.js was not found in the GitHub release (HTTP ' + res.status + ').', 502);
  }
  const buf = await res.arrayBuffer();
  if (buf.byteLength < 100000) {
    throw new WizardError('download', 'فایل worker.js ناقص دانلود شد.', 'worker.js was downloaded incompletely.', 502);
  }
  const expected = shaRes && shaRes.ok ? (await shaRes.text()).trim().split(/\s+/)[0].toLowerCase() : '';
  if (!/^[0-9a-f]{64}$/.test(expected)) {
    throw new WizardError('integrity', 'فایل هش SHA-256 ریلیز در دسترس نیست؛ نصب برای امنیت متوقف شد.', 'The release SHA-256 file is unavailable; installation was stopped for safety.', 502);
  }
  const actual = toHex(await crypto.subtle.digest('SHA-256', buf));
  if (actual !== expected) {
    throw new WizardError('integrity', 'هش فایل worker.js با هش ریلیز مطابقت ندارد؛ نصب متوقف شد.', 'The worker.js hash does not match the release hash; installation was stopped.', 502);
  }
  return buf;
}

export function buildWorkerMetadata({ kvId, d1Id, runnerSecret, setupCode }) {
  return {
    main_module: 'worker.js',
    compatibility_date: COMPAT_DATE,
    compatibility_flags: ['nodejs_compat'],
    bindings: [
      { type: 'kv_namespace', name: 'KV', namespace_id: kvId },
      { type: 'd1', name: 'DB', id: d1Id },
      { type: 'plain_text', name: 'API_ID', text: TELEGRAM_API_ID },
      { type: 'plain_text', name: 'API_HASH', text: TELEGRAM_API_HASH },
      { type: 'secret_text', name: 'RUNNER_SECRET', text: runnerSecret },
      { type: 'secret_text', name: 'SETUP_CODE', text: setupCode }
    ]
  };
}

/** کد راه‌اندازی یک‌بار مصرف: فقط دارندهٔ آن می‌تواند اولین حساب (مدیر کل) را بسازد */
function requireSetupCode(code) {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(String(code || ''))) {
    throw new WizardError('weak_secret', 'کد راه‌اندازی نامعتبر است.', 'The setup code is invalid.');
  }
}

/** مرحلهٔ ۳: آپلود Worker با بایندینگ‌ها و سکرت‌ها */
export async function cfDeployWorker(tokenRaw, accountId, { workerName, kvId, d1Id, runnerSecret, setupCode, source }) {
  const token = requireToken(tokenRaw, 'cf');
  validateWorkerName(workerName);
  if (!kvId || !d1Id) throw new WizardError('bad_request', 'شناسه KV یا D1 ارسال نشده است.', 'KV or D1 id is missing.');
  if (String(runnerSecret || '').length < 16) {
    throw new WizardError('weak_secret', 'رمز رانر باید حداقل ۱۶ کاراکتر باشد.', 'The runner secret must be at least 16 characters long.');
  }
  requireSetupCode(setupCode);
  const code = source || await fetchWorkerSource();
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(buildWorkerMetadata({ kvId, d1Id, runnerSecret, setupCode }))], { type: 'application/json' }));
  form.append('worker.js', new Blob([code], { type: 'application/javascript+module' }), 'worker.js');
  await cfCall(token, `/accounts/${accountId}/workers/scripts/${workerName}`, { method: 'PUT', form });
  return { workerName };
}

/** حالت «اتصال»: پیدا کردن اکانتی که Worker در حال اجرا در آن است */
export async function cfLocateWorker(tokenRaw, workerName) {
  const token = requireToken(tokenRaw, 'cf');
  validateWorkerName(workerName);
  const accounts = await cfCall(token, '/accounts?per_page=50');
  for (const a of accounts || []) {
    let scripts;
    try {
      scripts = await cfCall(token, `/accounts/${a.id}/workers/scripts`);
    } catch (err) {
      if (err instanceof WizardError && err.code === 'cf_auth') throw err;
      continue;
    }
    if ((scripts || []).some(x => x.id === workerName)) {
      const found = { accountId: a.id, accountName: a.name };
      try {
        const cur = await cfCall(token, `/accounts/${a.id}/workers/scripts/${workerName}/settings`);
        const bs = Array.isArray(cur && cur.bindings) ? cur.bindings : [];
        const kv = bs.find(b => b.name === 'KV' && b.type === 'kv_namespace' && b.namespace_id);
        const d1 = bs.find(b => b.name === 'DB' && b.type === 'd1' && b.id);
        if (kv && d1) { found.kvId = kv.namespace_id; found.d1Id = d1.id; }
      } catch (_) { /* بدون بایندینگ فعلی؛ منابع جدید ساخته می‌شود */ }
      return found;
    }
  }
  throw new WizardError('worker_not_found',
    'Worker با نام «' + workerName + '» در اکانت‌های این توکن پیدا نشد. نام را بررسی کنید و توکنِ همان اکانتی را بدهید که Worker را در آن ساخته‌اید.',
    'No Worker named "' + workerName + '" was found in the accounts of this token. Check the name and use a token from the account that owns the Worker.', 404);
}

/** حالت «اتصال»: بایندینگ‌ها و رمزها را روی همین Worker در حال اجرا ثبت می‌کند (بدون آپلود دوبارهٔ کد) */
export async function cfAttachWorker(tokenRaw, accountId, { workerName, kvId, d1Id, runnerSecret, setupCode }) {
  const token = requireToken(tokenRaw, 'cf');
  validateWorkerName(workerName);
  if (!kvId || !d1Id) throw new WizardError('bad_request', 'شناسه KV یا D1 ارسال نشده است.', 'KV or D1 id is missing.');
  if (String(runnerSecret || '').length < 16) {
    throw new WizardError('weak_secret', 'رمز رانر باید حداقل ۱۶ کاراکتر باشد.', 'The runner secret must be at least 16 characters long.');
  }
  requireSetupCode(setupCode);
  const path = `/accounts/${accountId}/workers/scripts/${workerName}/settings`;
  const current = await cfCall(token, path);
  const existing = Array.isArray(current && current.bindings) ? current.bindings : [];
  const has = n => existing.some(b => b.name === n);
  const keepOwn = new Set(['KV', 'DB', 'API_ID', 'API_HASH'].filter(has));
  const replaced = new Set(['ADMIN_PASSWORD', 'RUNNER_SECRET', 'SETUP_CODE']);
  const bindings = [
    ...existing.filter(b => !replaced.has(b.name)).map(b => ({ type: 'inherit', name: b.name })),
    ...buildWorkerMetadata({ kvId, d1Id, runnerSecret, setupCode }).bindings.filter(b => !keepOwn.has(b.name))
  ];
  const settings = {
    bindings,
    compatibility_flags: [...new Set([...(current.compatibility_flags || []), 'nodejs_compat'])]
  };
  if (!current.compatibility_date) settings.compatibility_date = COMPAT_DATE;
  const form = new FormData();
  form.append('settings', new Blob([JSON.stringify(settings)], { type: 'application/json' }));
  await cfCall(token, path, { method: 'PATCH', form });
  return { workerName, keptKv: has('KV'), keptDb: has('DB') };
}

const D1_SCHEMA = `CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY, value TEXT, expires_at INTEGER, updated_at INTEGER);
CREATE INDEX IF NOT EXISTS idx_kv_expires ON kv_store(expires_at);`;

/** مرحلهٔ ۴: کران هر دقیقه، فعال‌سازی workers.dev و ساخت جدول D1 */
export async function cfFinalize(tokenRaw, accountId, { workerName, d1Id }) {
  const token = requireToken(tokenRaw, 'cf');
  validateWorkerName(workerName);
  await cfCall(token, `/accounts/${accountId}/workers/scripts/${workerName}/schedules`, { method: 'PUT', body: [{ cron: '* * * * *' }] });
  await cfCall(token, `/accounts/${accountId}/workers/scripts/${workerName}/subdomain`, { method: 'POST', body: { enabled: true, previews_enabled: false } });
  if (d1Id) {
    const marker = `INSERT OR REPLACE INTO kv_store (key, value, expires_at, updated_at) VALUES ('setup:complete', '1', NULL, ${Date.now()});`;
    await cfCall(token, `/accounts/${accountId}/d1/database/${d1Id}/query`, { method: 'POST', body: { sql: D1_SCHEMA + '\n' + marker } });
  }
  const sub = await cfCall(token, `/accounts/${accountId}/workers/subdomain`);
  if (!sub || !sub.subdomain) {
    throw new WizardError('cf_no_subdomain', 'ساب‌دامین workers.dev هنوز ساخته نشده است.', 'The workers.dev subdomain has not been created yet.');
  }
  const url = `https://${workerName}.${sub.subdomain}.workers.dev`;
  return { url, adminUrl: url + '/admin' };
}

// ---------------------------------------------------------------- GitHub
export async function ghCall(token, path, { method = 'GET', body } = {}) {
  const headers = {
    Authorization: 'Bearer ' + token,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'Arizo-Setup-Wizard'
  };
  let payload;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(GH + path, { method, headers, body: payload });
  } catch (_) {
    throw new WizardError('network', 'ارتباط با GitHub برقرار نشد. دوباره تلاش کنید.', 'Could not reach GitHub. Please retry.', 502);
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
  return { status: res.status, ok: res.ok, data, headers: res.headers };
}

export function ghFail(res, fa, en) {
  const msg = (res.data && res.data.message) ? res.data.message : 'HTTP ' + res.status;
  if (res.status === 401) {
    return new WizardError('gh_auth', 'توکن GitHub نامعتبر یا منقضی است.', 'The GitHub token is invalid or expired.');
  }
  return new WizardError('gh_api', fa + ' (' + msg + ')', en + ' (' + msg + ')', 502);
}

/** مرحلهٔ ۶: اعتبارسنجی توکن GitHub و دسترسی‌های repo و workflow */
export async function ghVerify(tokenRaw) {
  const token = requireToken(tokenRaw, 'gh');
  const res = await ghCall(token, '/user');
  if (!res.ok) throw ghFail(res, 'بررسی توکن GitHub ناموفق بود', 'GitHub token check failed');
  const scopesHeader = res.headers.get('x-oauth-scopes');
  const scopes = scopesHeader ? scopesHeader.split(',').map(s => s.trim()).filter(Boolean) : null;
  if (scopes && (!scopes.includes('repo') || !scopes.includes('workflow'))) {
    throw new WizardError('gh_scopes',
      'توکن GitHub باید دسترسی‌های repo و workflow داشته باشد. توکن جدید را با دکمهٔ آماده بسازید.',
      'The GitHub token needs the repo and workflow scopes. Create a new token with the prepared button.');
  }
  return { login: res.data.login, scopes: scopes || [] };
}

/** مرحلهٔ ۷: فورک ریپو (یا استفادهٔ مجدد از فورک قبلی). خروجی ready=false یعنی کلاینت باید دوباره بپرسد. */
export async function ghEnsureFork(tokenRaw, { source = SOURCE_REPO } = {}) {
  const token = requireToken(tokenRaw, 'gh');
  if (!REPO_RE.test(source)) throw new WizardError('bad_request', 'ریپوی مبدا نامعتبر است.', 'Invalid source repository.');
  const me = await ghCall(token, '/user');
  if (!me.ok) throw ghFail(me, 'بررسی توکن GitHub ناموفق بود', 'GitHub token check failed');
  const login = me.data.login;
  const [owner, name] = source.split('/');
  if (login.toLowerCase() === owner.toLowerCase()) {
    throw new WizardError('owner_repo',
      'این حساب مالک ریپوی اصلی است و نمی‌تواند از آن فورک بگیرد. برای نصب شخصی از یک حساب GitHub دیگر استفاده کنید.',
      'This account owns the source repository and cannot fork it. Use a different GitHub account for a personal install.');
  }

  const existing = await ghCall(token, `/repos/${login}/${name}`);
  if (existing.ok) {
    const parent = existing.data.parent && existing.data.parent.full_name;
    if (existing.data.fork && parent && parent.toLowerCase() === source.toLowerCase()) {
      return { repo: existing.data.full_name, ready: true, defaultBranch: existing.data.default_branch || 'main', reused: true };
    }
    throw new WizardError('repo_conflict',
      `در حساب شما از قبل ریپویی به نام ${name} وجود دارد که فورک پروژه نیست. آن را تغییر نام دهید و دوباره تلاش کنید.`,
      `Your account already has a repository named ${name} that is not a fork of the project. Rename it and retry.`);
  }
  if (existing.status !== 404) throw ghFail(existing, 'بررسی ریپو ناموفق بود', 'Repository check failed');

  const fork = await ghCall(token, `/repos/${source}/forks`, { method: 'POST', body: { default_branch_only: true } });
  if (!fork.ok && fork.status !== 202) throw ghFail(fork, 'ساخت فورک ناموفق بود', 'Creating the fork failed');
  return { repo: `${login}/${name}`, ready: false, defaultBranch: (fork.data && fork.data.default_branch) || 'main', reused: false };
}

/** مرحلهٔ ۸: ثبت سکرت‌های رانر در ریپوی کاربر (رمزنگاری‌شده با libsodium sealed box) */
export async function ghSetSecrets(tokenRaw, repo, { cloudflareUrl, runnerSecret }) {
  const token = requireToken(tokenRaw, 'gh');
  if (!REPO_RE.test(String(repo || ''))) throw new WizardError('bad_request', 'ریپو نامعتبر است.', 'Invalid repository.');
  if (!/^https:\/\/[a-z0-9.-]+\.workers\.dev$/.test(String(cloudflareUrl || ''))) {
    throw new WizardError('bad_request', 'آدرس Worker نامعتبر است.', 'Invalid Worker URL.');
  }
  if (String(runnerSecret || '').length < 16) throw new WizardError('weak_secret', 'رمز رانر نامعتبر است.', 'Invalid runner secret.');

  const keyRes = await ghCall(token, `/repos/${repo}/actions/secrets/public-key`);
  if (!keyRes.ok) throw ghFail(keyRes, 'دریافت کلید عمومی ریپو ناموفق بود (فورک هنوز آماده نیست؟)', 'Fetching the repository public key failed (is the fork ready?)');

  const secrets = {
    CLOUDFLARE_URL: cloudflareUrl,
    RUNNER_SECRET: runnerSecret,
    API_ID: TELEGRAM_API_ID,
    API_HASH: TELEGRAM_API_HASH
  };
  for (const [name, value] of Object.entries(secrets)) {
    const put = await ghCall(token, `/repos/${repo}/actions/secrets/${name}`, {
      method: 'PUT',
      body: { encrypted_value: sealSecret(keyRes.data.key, value), key_id: keyRes.data.key_id }
    });
    if (!put.ok) throw ghFail(put, `ثبت سکرت ${name} ناموفق بود`, `Saving secret ${name} failed`);
  }
  return { secrets: Object.keys(secrets) };
}

/** مرحلهٔ ۹: فعال‌سازی Actions و ورک‌فلو در فورک و اجرای اولین رانر */
export async function ghEnableAndRun(tokenRaw, repo, branch = 'main') {
  const token = requireToken(tokenRaw, 'gh');
  if (!REPO_RE.test(String(repo || ''))) throw new WizardError('bad_request', 'ریپو نامعتبر است.', 'Invalid repository.');
  const warnings = [];

  const perms = await ghCall(token, `/repos/${repo}/actions/permissions`, { method: 'PUT', body: { enabled: true, allowed_actions: 'all' } });
  if (!perms.ok && perms.status !== 204) warnings.push('actions_permissions');

  const list = await ghCall(token, `/repos/${repo}/actions/workflows`);
  const wf = list.ok && list.data && (list.data.workflows || []).find(w => String(w.path || '').endsWith(WORKFLOW_FILE));
  if (wf) {
    const en = await ghCall(token, `/repos/${repo}/actions/workflows/${wf.id}/enable`, { method: 'PUT' });
    if (!en.ok && en.status !== 204) warnings.push('workflow_enable');
  } else {
    warnings.push('workflow_missing');
  }

  const run = await ghCall(token, `/repos/${repo}/actions/workflows/${WORKFLOW_FILE}/dispatches`, { method: 'POST', body: { ref: branch } });
  if (!run.ok && run.status !== 204) {
    throw ghFail(run, 'اجرای رانر ناموفق بود؛ در صفحهٔ Actions ریپو ورک‌فلو را دستی فعال کنید', 'Starting the runner failed; enable the workflow manually on the repository Actions page');
  }
  return { actionsUrl: `https://github.com/${repo}/actions`, warnings };
}

// ---------------------------------------------------------------- dispatcher
/** نگاشت مسیر API به مراحل؛ همیشه { status, data } برمی‌گرداند و هرگز ورودی را در خروجی بازتاب نمی‌دهد */
export async function handleWizardApi(step, body = {}, options = {}) {
  try {
    const b = body && typeof body === 'object' ? body : {};
    switch (step) {
      case 'cloudflare/verify':
        return ok(await cfVerify(b.token));
      case 'cloudflare/subdomain':
        return ok(await cfEnsureSubdomain(b.token, str(b.accountId), b.subdomain));
      case 'cloudflare/locate':
        return ok(await cfLocateWorker(b.token, b.workerName));
      case 'cloudflare/attach':
        return ok(await cfAttachWorker(b.token, str(b.accountId), pick(b, ['workerName', 'kvId', 'd1Id', 'runnerSecret', 'setupCode'])));
      case 'cloudflare/resources':
        return ok(await cfEnsureResources(b.token, str(b.accountId), b.workerName));
      case 'cloudflare/deploy':
        return ok(await cfDeployWorker(b.token, str(b.accountId), { ...pick(b, ['workerName', 'kvId', 'd1Id', 'runnerSecret', 'setupCode']), source: options.workerSource }));
      case 'cloudflare/finalize':
        return ok(await cfFinalize(b.token, str(b.accountId), pick(b, ['workerName', 'd1Id'])));
      case 'github/verify':
        return ok(await ghVerify(b.token));
      case 'github/fork':
        return ok(await ghEnsureFork(b.token, { source: options.sourceRepo || SOURCE_REPO }));
      case 'github/secrets':
        return ok(await ghSetSecrets(b.token, b.repo, pick(b, ['cloudflareUrl', 'runnerSecret'])));
      case 'github/run':
        return ok(await ghEnableAndRun(b.token, b.repo, typeof b.branch === 'string' && b.branch ? b.branch : 'main'));
      default:
        return { status: 404, data: { ok: false, code: 'unknown_step', fa: 'مرحلهٔ ناشناخته', en: 'Unknown step' } };
    }
  } catch (err) {
    if (err instanceof WizardError) {
      return { status: err.status, data: { ok: false, code: err.code, fa: err.fa, en: err.en, ...err.extra } };
    }
    return { status: 500, data: { ok: false, code: 'internal', fa: 'خطای داخلی ویزارد', en: 'Internal wizard error' } };
  }
}

function ok(data) { return { status: 200, data: { ok: true, ...data } }; }
function str(v) { return String(v || '').replace(/[^a-zA-Z0-9]/g, ''); }
function pick(obj, keys) { const o = {}; for (const k of keys) o[k] = obj[k]; return o; }
