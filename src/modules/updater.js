/**
 * 🔄 به‌روزرسانی خودکار از آخرین ریلیز رسمی
 *
 * - اطلاعات نسخه از version.json ریلیز خوانده می‌شود (بدون محدودیت API گیت‌هاب).
 * - کد Worker فقط با «به‌روزرسانی محتوا» جایگزین می‌شود؛ بایندینگ‌ها، سکرت‌ها و کران دست‌نخورده می‌مانند.
 * - توکن‌ها فقط در حافظهٔ همان درخواست استفاده می‌شوند.
 */
import { APP_VERSION, APP_BUILD, APP_CHANNEL } from '../version.js';
import {
  SOURCE_REPO, WORKFLOW_FILE, REPO_RE, WizardError,
  cfCall, ghCall, ghFail, requireToken, validateWorkerName,
  fetchWorkerSource, cfLocateWorker
} from './wizardDeploy.js';

export const VERSION_INFO_URL = `https://github.com/${SOURCE_REPO}/releases/latest/download/version.json`;
const HEX64 = /^[0-9a-f]{64}$/;

/** حدس نام Worker از آدرس workers.dev (name.sub.workers.dev)؛ برای دامنهٔ دلخواه خالی برمی‌گردد */
export function guessWorkerName(hostname) {
  const l = String(hostname || '').toLowerCase().split('.');
  if (l.length === 4 && l[2] === 'workers' && l[3] === 'dev' && /^[a-z0-9][a-z0-9-]{0,53}$/.test(l[0])) return l[0];
  return '';
}

function cleanNotes(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.filter(x => typeof x === 'string').slice(0, 12).map(x => x.slice(0, 200));
}

let releaseCache = null;
export function resetReleaseCache() { releaseCache = null; }

export async function fetchLatestRelease({ fresh = false } = {}) {
  if (!fresh && releaseCache && Date.now() - releaseCache.at < 60000) return releaseCache.data;
  let res;
  try {
    res = await fetch(VERSION_INFO_URL, { redirect: 'follow' });
  } catch (_) {
    throw new WizardError('network', 'ارتباط با GitHub برقرار نشد.', 'Could not reach GitHub.', 502);
  }
  if (!res.ok) {
    throw new WizardError('no_release_info', `اطلاعات آخرین نسخه پیدا نشد (HTTP ${res.status}).`, `Latest release info was not found (HTTP ${res.status}).`, 502);
  }
  const j = await res.json().catch(() => null);
  if (!j || !Number.isFinite(Number(j.build)) || !HEX64.test(String(j.sha256 || ''))) {
    throw new WizardError('bad_release_info', 'فایل اطلاعات نسخه نامعتبر است.', 'The release info file is invalid.', 502);
  }
  const data = {
    version: String(j.version || '').slice(0, 32),
    channel: String(j.channel || '').slice(0, 16),
    build: Number(j.build),
    sha256: String(j.sha256),
    size: Number(j.size) || 0,
    publishedAt: Number(j.publishedAt) || 0,
    notes: { fa: cleanNotes(j.notes && j.notes.fa), en: cleanNotes(j.notes && j.notes.en) }
  };
  releaseCache = { at: Date.now(), data };
  return data;
}

export async function checkForUpdate({ fresh = false } = {}) {
  const latest = await fetchLatestRelease({ fresh });
  return {
    current: { version: APP_VERSION, build: APP_BUILD, channel: APP_CHANNEL },
    latest,
    updateAvailable: latest.build > APP_BUILD,
    checkedAt: Date.now()
  };
}

async function sha256Hex(buf) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  return Array.from(d).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** جایگزینی فقط کد Worker؛ بایندینگ‌ها، سکرت‌ها، کران و فلگ‌ها حفظ می‌شوند */
export async function cfUpdateWorkerCode(tokenRaw, accountId, workerName, source) {
  const token = requireToken(tokenRaw, 'cf');
  validateWorkerName(workerName);
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify({ main_module: 'worker.js' })], { type: 'application/json' }));
  form.append('worker.js', new Blob([source], { type: 'application/javascript+module' }), 'worker.js');
  await cfCall(token, `/accounts/${accountId}/workers/scripts/${workerName}/content`, { method: 'PUT', form });
  return { workerName };
}

/** دانلود + راستی‌آزمایی هش + جایگزینی کد روی همین Worker */
export async function applyCodeUpdate({ cfToken, workerName, force = false }) {
  const latest = await fetchLatestRelease({ fresh: true });
  if (!force && latest.build <= APP_BUILD) {
    throw new WizardError('up_to_date', 'نسخهٔ شما از قبل آخرین نسخه است.', 'You already have the latest version.', 409);
  }
  const source = await fetchWorkerSource();
  const actual = await sha256Hex(source);
  if (actual !== latest.sha256) {
    throw new WizardError('integrity',
      'فایل دانلودشده با اطلاعات نسخه یکی نیست؛ شاید ریلیز در حال انتشار است. چند دقیقه بعد دوباره تلاش کنید.',
      'The downloaded file does not match the release info; the release may still be publishing. Retry in a few minutes.', 502);
  }
  const loc = await cfLocateWorker(cfToken, workerName);
  await cfUpdateWorkerCode(cfToken, loc.accountId, workerName, source);
  return { latest, accountId: loc.accountId, sha256: actual };
}

/** هماهنگ‌سازی فورک رانر با ریپوی اصلی و ری‌استارت رانر */
export async function ghSyncRunner(tokenRaw, explicitRepo) {
  const token = requireToken(tokenRaw, 'gh');
  const me = await ghCall(token, '/user');
  if (!me.ok) throw ghFail(me, 'بررسی توکن GitHub ناموفق بود', 'GitHub token check failed');

  let repo = String(explicitRepo || '').trim();
  if (!repo) repo = `${me.data.login}/${SOURCE_REPO.split('/')[1]}`;
  if (!REPO_RE.test(repo)) throw new WizardError('bad_request', 'نام ریپو نامعتبر است.', 'Invalid repository name.');

  if (repo.toLowerCase() === SOURCE_REPO.toLowerCase()) {
    return { repo, skipped: 'source', mergeType: 'none', restarted: false };
  }
  const info = await ghCall(token, `/repos/${repo}`);
  if (!info.ok) throw ghFail(info, 'ریپوی رانر پیدا نشد', 'The runner repository was not found');
  if (!info.data.fork) {
    throw new WizardError('not_fork', 'این ریپو فورک پروژه نیست و خودکار هماهنگ نمی‌شود.', 'This repository is not a fork of the project, so it cannot be synced automatically.');
  }
  const branch = info.data.default_branch || 'main';

  const sync = await ghCall(token, `/repos/${repo}/merge-upstream`, { method: 'POST', body: { branch } });
  if (sync.status === 409) {
    throw new WizardError('gh_conflict', 'ریپوی شما تغییرات محلی دارد و خودکار ادغام نشد؛ از دکمهٔ Sync fork در GitHub استفاده کنید.', 'Your repository has local changes and could not be merged automatically; use "Sync fork" on GitHub.', 409);
  }
  if (!sync.ok) throw ghFail(sync, 'هماهنگ‌سازی ریپوی رانر ناموفق بود', 'Syncing the runner repository failed');

  const runs = await ghCall(token, `/repos/${repo}/actions/runs?status=in_progress&per_page=20`);
  if (runs.ok && runs.data && Array.isArray(runs.data.workflow_runs)) {
    for (const r of runs.data.workflow_runs) {
      await ghCall(token, `/repos/${repo}/actions/runs/${r.id}/cancel`, { method: 'POST' });
    }
  }
  const run = await ghCall(token, `/repos/${repo}/actions/workflows/${WORKFLOW_FILE}/dispatches`, { method: 'POST', body: { ref: branch } });
  return {
    repo,
    mergeType: (sync.data && sync.data.merge_type) || 'none',
    restarted: run.ok || run.status === 204
  };
}
