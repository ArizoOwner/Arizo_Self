import { describe, it, assert, assertEqual } from './test-runner.js';
import worker, { resetStorageCachesForTests } from '../src/index.js';
import { generateTotpCode } from '../src/security/totp.js';
import { hashPassword, generateRandomHex } from '../src/crypto.js';

function createMockEnv(opts = {}) {
  resetStorageCachesForTests();
  const store = new Map();
  const env = {
    KV: {
      async get(key, type) {
        if (!store.has(key)) return null;
        const val = store.get(key);
        if (type === 'json') {
          try { return JSON.parse(val); } catch (_) { return null; }
        }
        return val;
      },
      async put(key, val) {
        store.set(key, typeof val === 'string' ? val : JSON.stringify(val));
      },
      async delete(key) {
        store.delete(key);
      },
      async list(opts = {}) {
        const prefix = opts.prefix || '';
        const keys = [];
        for (const k of store.keys()) {
          if (k.startsWith(prefix)) keys.push({ name: k });
        }
        return { keys };
      }
    },
    RUNNER_SECRET: 'SuperAdminPassword@2026',
    API_ID: '2040',
    API_HASH: 'b18441a1ff607e10a989891a5462e627',
    ENVIRONMENT: 'test',
    APP_NAME: 'Arizo Test Studio',
    APP_VERSION: '3.6.0-TEST'
  };

  if (opts.withDB) {
    let tablesCreated = opts.tablesCreated !== false;
    env.DB = {
      async exec(sql) {
        tablesCreated = true;
        return { success: true };
      },
      prepare(query) {
        return {
          bind(...params) { return this; },
          async first() {
            if (query.includes('sqlite_master')) {
              return tablesCreated ? { name: 'kv_store' } : null;
            }
            if (query.includes('count(*)')) {
              return { cnt: 12 };
            }
            return null;
          },
          async run() { return { success: true }; },
          async all() { return []; }
        };
      }
    };
  }

  return env;
}

describe('Worker Suite — Edge Security & API Lifecycle', () => {
  it('should serve HTML panel with enterprise security headers', async () => {
    const env = createMockEnv();
    const req = new Request('https://arizo.test/');
    const res = await worker.fetch(req, env);

    assertEqual(res.status, 200);
    assert(res.headers.get('Content-Type').includes('text/html'));
    assert(res.headers.get('Content-Security-Policy') !== null, 'CSP must be set');
    assert(res.headers.get('X-Content-Type-Options') === 'nosniff');
    const text = await res.text();
    assert(text.includes('Arizo') || text.includes('سلف‌بات'));
  });

  it('should trap honeypot scanners and return 403 Forbidden', async () => {
    const env = createMockEnv();
    const req = new Request('https://arizo.test/.env', {
      headers: { 'cf-connecting-ip': '198.51.100.99' }
    });
    const res = await worker.fetch(req, env);

    assertEqual(res.status, 403);
    assert(res.headers.get('X-Security-Policy').includes('Zero-Trust-Honeypot-Armed'));
    
    // Check that security audit event was logged
    const logs = await env.KV.get('security_audit_log', 'json');
    assert(Array.isArray(logs) && logs.length > 0);
    assertEqual(logs[0].eventType, 'HONEYPOT_TRIGGERED');
  });

  it('should have no master-password login endpoint and gate admin routes by user role', async () => {
    const env = createMockEnv();

    const unauth = await worker.fetch(new Request('https://arizo.test/api/admin/audit-logs'), env);
    assertEqual(unauth.status, 401);

    const login = await worker.fetch(new Request('https://arizo.test/api/admin/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'SuperAdminPassword@2026' })
    }), env);
    assertEqual(login.status, 404);

    const reg = await worker.fetch(new Request('https://arizo.test/api/user/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '198.51.100.21' },
      body: JSON.stringify({ username: 'owner_one', password: 'OwnerPassword@123' })
    }), env);
    const owner = await reg.json();
    assertEqual(reg.status, 200);
    assertEqual(owner.isAdmin, true);

    const authed = await worker.fetch(new Request('https://arizo.test/api/admin/audit-logs', { headers: { Authorization: 'Bearer ' + owner.token } }), env);
    assertEqual(authed.status, 200);
    assert(Array.isArray((await authed.json()).events));
  });

  it('should make only the very first registrant the owner, with no license code', async () => {
    const env = createMockEnv();
    const boot1 = await (await worker.fetch(new Request('https://arizo.test/api/bootstrap'), env)).json();
    assertEqual(boot1.firstAdmin, true);

    const first = await (await worker.fetch(new Request('https://arizo.test/api/user/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '198.51.100.22' },
      body: JSON.stringify({ username: 'founder', password: 'FounderPassword@123' })
    }), env)).json();
    assertEqual(first.role, 'admin');
    assertEqual(first.plan, 'lifetime');

    const boot2 = await (await worker.fetch(new Request('https://arizo.test/api/bootstrap'), env)).json();
    assertEqual(boot2.firstAdmin, false);

    const second = await worker.fetch(new Request('https://arizo.test/api/user/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '198.51.100.23' },
      body: JSON.stringify({ username: 'latecomer', password: 'LatePassword@123' })
    }), env);
    assertEqual(second.status, 400);

    const trick = await worker.fetch(new Request('https://arizo.test/api/user/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '198.51.100.24' },
      body: JSON.stringify({ username: 'sneaky', password: 'SneakyPassword@123', licenseCode: 'ADMIN' })
    }), env);
    assertEqual(trick.status, 400);

    const me = await (await worker.fetch(new Request('https://arizo.test/api/user/me', { headers: { Authorization: 'Bearer ' + first.token } }), env)).json();
    assertEqual(me.isAdmin, true);
  });

  it('should reject the runner endpoint without RUNNER_SECRET even if no other secret exists', async () => {
    const env = createMockEnv();
    delete env.RUNNER_SECRET;
    const res = await worker.fetch(new Request('https://arizo.test/api/internal/active-users', { headers: { Authorization: 'Bearer anything' } }), env);
    assertEqual(res.status, 401);
  });

  it('should execute complete user 2FA setup, verify and login lifecycle', async () => {
    const env = createMockEnv();
    const username = 'testuser2fa';
    const password = 'UserPassword@123';
    const salt = generateRandomHex(16);
    const passwordHash = await hashPassword(password, salt);

    // Seed test user in KV
    await env.KV.put('user:' + username, JSON.stringify({
      username,
      salt,
      passwordHash,
      role: 'user',
      plan: '1_month',
      subscriptionUntil: Date.now() + (30 * 86400000)
    }));

    // Generate user session token
    const token = generateRandomHex(32);
    await env.KV.put('token:' + token, JSON.stringify({ username, createdAt: Date.now() }));

    // 1. Request 2FA Setup
    const setupReq = new Request('https://arizo.test/api/user/2fa/setup', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const setupRes = await worker.fetch(setupReq, env);
    assertEqual(setupRes.status, 200);
    const setupData = await setupRes.json();
    assert(setupData.secret && setupData.otpauthUri);
    assertEqual(setupData.backupCodes.length, 8);

    // 2. Generate valid TOTP token and enable 2FA
    const validCode = await generateTotpCode(setupData.secret);
    const enableReq = new Request('https://arizo.test/api/user/2fa/enable', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: validCode })
    });
    const enableRes = await worker.fetch(enableReq, env);
    assertEqual(enableRes.status, 200);
    const enableData = await enableRes.json();
    assertEqual(enableData.enabled, true);

    // 3. Attempt login without 2FA code (should request 2FA)
    const loginNoTotpReq = new Request('https://arizo.test/api/user/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const loginNoTotpRes = await worker.fetch(loginNoTotpReq, env);
    const loginNoTotpData = await loginNoTotpRes.json();
    assertEqual(loginNoTotpData.requires2FA, true);

    // 4. Login with valid 2FA code
    const newTotpCode = await generateTotpCode(setupData.secret);
    const loginTotpReq = new Request('https://arizo.test/api/user/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, totpCode: newTotpCode })
    });
    const loginTotpRes = await worker.fetch(loginTotpReq, env);
    assertEqual(loginTotpRes.status, 200);
    const loginTotpData = await loginTotpRes.json();
    assertEqual(loginTotpData.ok, true);
    assert(loginTotpData.token);
  });

  it('should export and import encrypted user backups via API', async () => {
    const env = createMockEnv();
    const username = 'backupuser';
    const password = 'UserPassword@123';
    const salt = generateRandomHex(16);
    const passwordHash = await hashPassword(password, salt);

    await env.KV.put('user:' + username, JSON.stringify({
      username,
      salt,
      passwordHash,
      role: 'user',
      plan: '1_month',
      telegram: {
        enabled: true,
        colon: '-',
        prefix: 'VIP',
        ghostMode: true
      }
    }));

    const token = generateRandomHex(32);
    await env.KV.put('token:' + token, JSON.stringify({ username, createdAt: Date.now() }));

    // Export backup
    const exportReq = new Request('https://arizo.test/api/user/backup/export', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'BackupPassphrase@2026' })
    });
    const exportRes = await worker.fetch(exportReq, env);
    assertEqual(exportRes.status, 200);
    const exportData = await exportRes.json();
    assert(exportData.backup.includes('encrypted-backup-v2'));

    // Modify user settings
    const modifiedUser = await env.KV.get('user:' + username, 'json');
    modifiedUser.telegram.prefix = 'MODIFIED';
    await env.KV.put('user:' + username, JSON.stringify(modifiedUser));

    // Import and restore backup
    const importReq = new Request('https://arizo.test/api/user/backup/import', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ backupData: exportData.backup, password: 'BackupPassphrase@2026' })
    });
    const importRes = await worker.fetch(importReq, env);
    assertEqual(importRes.status, 200);
    const importData = await importRes.json();
    assertEqual(importData.restored, true);

    // Verify restored prefix
    const restoredUser = await env.KV.get('user:' + username, 'json');
    assertEqual(restoredUser.telegram.prefix, 'VIP');
    assertEqual(restoredUser.telegram.ghostMode, true);
  });

  it('should return rich telemetry for users and handle admin monitoring actions', async () => {
    const env = createMockEnv();

    // 1. Setup admin session
    const adminToken = 'adm_test_token_' + Date.now();
    await env.KV.put('user:test_owner', JSON.stringify({ username: 'test_owner', role: 'admin', plan: 'lifetime' }));
    await env.KV.put('token:' + adminToken, JSON.stringify({ username: 'test_owner', createdAt: Date.now() }));
    const adminHeaders = { 'Authorization': `Bearer ${adminToken}`, 'Content-Type': 'application/json' };

    // 2. Setup user with 2FA, bot, and telegram telemetry
    const username = 'telemetry_user';
    const userData = {
      username,
      role: 'user',
      plan: '1_month',
      planName: '۱ ماهه (۳۰ روز)',
      durationDays: 30,
      subscriptionUntil: Date.now() + 30 * 86400 * 1000,
      totp: {
        enabled: true,
        secret: 'JBSWY3DPEHPK3PXP',
        backupCodes: ['CODE1', 'CODE2', 'CODE3']
      },
      telegram: {
        enabled: true,
        sessionEncrypted: 'enc_session_sample',
        userId: '123456789',
        ghostMode: true,
        aiReplyEnabled: false,
        bioEnabled: true,
        afkEnabled: false,
        mutedUsers: ['98765', '43210'],
        bot: {
          token: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
          username: 'TestHelperBot',
          id: 654321,
          ownerId: 123456789,
          antiDeleteEnabled: true,
          antiEditEnabled: false,
          forwardTtlToBot: true
        }
      },
      status: {
        lastUpdate: Date.now(),
        lastTime: '14:30',
        error: 'Sample Warning'
      }
    };
    await env.KV.put('user:' + username, JSON.stringify(userData));
    await env.KV.put('users_list', JSON.stringify([username]));

    // 3. Test /api/admin/stats returns new monitoring fields
    const statsReq = new Request('https://arizo.test/api/admin/stats', { headers: adminHeaders });
    const statsRes = await worker.fetch(statsReq, env);
    assertEqual(statsRes.status, 200);
    const statsData = await statsRes.json();
    assertEqual(statsData.totalUsers, 1);
    assertEqual(statsData.activeBots, 1);
    assertEqual(statsData.activeHelperBots, 1);
    assertEqual(statsData.active2FA, 1);

    // 4. Test /api/admin/users returns rich telemetry
    const usersReq = new Request('https://arizo.test/api/admin/users', { headers: adminHeaders });
    const usersRes = await worker.fetch(usersReq, env);
    assertEqual(usersRes.status, 200);
    const usersData = await usersRes.json();
    assert(Array.isArray(usersData.users) && usersData.users.length === 1);
    const u = usersData.users[0];
    assertEqual(u.username, username);
    assertEqual(u.has2FA, true);
    assertEqual(u.backupCodesCount, 3);
    assertEqual(u.hasBot, true);
    assertEqual(u.botUsername, 'TestHelperBot');
    assertEqual(u.botAntiDelete, true);
    assertEqual(u.botAntiEdit, false);
    assertEqual(u.botForwardTtl, true);
    assertEqual(u.telegramUserId, '123456789');
    assertEqual(u.ghostMode, true);
    assertEqual(u.mutedCount, 2);

    // 5. Test /api/admin/users/action: toggle_bot_feature
    const toggleBotReq = new Request('https://arizo.test/api/admin/users/action', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ username, action: 'toggle_bot_feature', feature: 'antiEdit' })
    });
    const toggleBotRes = await worker.fetch(toggleBotReq, env);
    assertEqual(toggleBotRes.status, 200);
    const updatedUserBot = await env.KV.get('user:' + username, 'json');
    assertEqual(updatedUserBot.telegram.bot.antiEditEnabled, true);

    // 6. Test /api/admin/users/action: clear_error
    const clearErrReq = new Request('https://arizo.test/api/admin/users/action', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ username, action: 'clear_error' })
    });
    const clearErrRes = await worker.fetch(clearErrReq, env);
    assertEqual(clearErrRes.status, 200);
    const updatedUserErr = await env.KV.get('user:' + username, 'json');
    assertEqual(updatedUserErr.status.error, null);

    // 7. Test /api/admin/users/action: disable_2fa
    const disable2faReq = new Request('https://arizo.test/api/admin/users/action', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ username, action: 'disable_2fa' })
    });
    const disable2faRes = await worker.fetch(disable2faReq, env);
    assertEqual(disable2faRes.status, 200);
    const updatedUser2fa = await env.KV.get('user:' + username, 'json');
    assertEqual(updatedUser2fa.totp.enabled, false);

    // 8. Test /api/admin/users/action: disconnect_bot
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      if (typeof input === 'string' && input.includes('api.telegram.org')) {
        return new Response(JSON.stringify({ ok: true, result: true }), { status: 200 });
      }
      return originalFetch(input, init);
    };

    try {
      const disconnectBotReq = new Request('https://arizo.test/api/admin/users/action', {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ username, action: 'disconnect_bot' })
      });
      const disconnectBotRes = await worker.fetch(disconnectBotReq, env);
      assertEqual(disconnectBotRes.status, 200);
      const updatedUserNoBot = await env.KV.get('user:' + username, 'json');
      assertEqual(updatedUserNoBot.telegram.bot, undefined);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

});

