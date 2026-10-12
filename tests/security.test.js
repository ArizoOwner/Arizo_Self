import { describe, it, assert, assertEqual } from './test-runner.js';
import {
  generateTotpSecret,
  generateTotpCode,
  verifyTotpToken,
  generateBackupCodes,
  getTotpAuthUri
} from '../src/security/totp.js';
import {
  checkRateLimit,
  isHoneypot,
  unbanIp
} from '../src/security/rateLimiter.js';
import {
  logSecurityEvent,
  getRecentSecurityEvents,
  AUDIT_EVENT_TYPES,
  AUDIT_SEVERITY
} from '../src/security/auditLogger.js';

describe('Security Suite — 2FA & TOTP Engine', () => {
  it('should generate valid Base32 secret', () => {
    const secret = generateTotpSecret(20);
    assert(secret && secret.length >= 26, 'Secret must be valid Base32 length');
    assert(/^[A-Z2-7]+$/.test(secret), 'Secret must only contain Base32 characters');
  });

  it('should generate and verify 6-digit TOTP token', async () => {
    const secret = generateTotpSecret(20);
    const code = await generateTotpCode(secret);
    assertEqual(code.length, 6, 'TOTP code must be 6 digits');
    assert(/^\d{6}$/.test(code), 'TOTP code must be numeric');

    const isValid = await verifyTotpToken(code, secret);
    assertEqual(isValid, true, 'Valid code must verify successfully');

    const isInvalid = await verifyTotpToken('000000', secret);
    assertEqual(isInvalid, false, 'Invalid code must be rejected');
  });

  it('should generate 8 valid backup emergency codes', () => {
    const backupCodes = generateBackupCodes(8);
    assertEqual(backupCodes.length, 8);
    for (const c of backupCodes) {
      assert(/^\d{4}-\d{4}$/.test(c), `Backup code ${c} must match 0000-0000 pattern`);
    }
  });

  it('should generate valid otpauth URI for authenticator apps', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    const uri = getTotpAuthUri('admin', secret, 'Arizo Studio');
    assert(uri.startsWith('otpauth://totp/Arizo%20Studio:admin?secret=JBSWY3DPEHPK3PXP'), 'URI must match standard format');
  });
});

describe('Security Suite — Adaptive Rate Limiter & Honeypot', () => {
  it('should correctly identify honeypot scanner paths', () => {
    assertEqual(isHoneypot('/.env'), true);
    assertEqual(isHoneypot('/wp-login.php'), true);
    assertEqual(isHoneypot('/api/clock/status'), false);
    assertEqual(isHoneypot('/dashboard'), false);
  });

  it('should trap and immediately ban honeypot hits', () => {
    const badIp = '198.51.100.44';
    unbanIp(badIp);

    const result = checkRateLimit(badIp, '/wp-login.php');
    assertEqual(result.allowed, false, 'Honeypot hit must be blocked');
    assert(result.reason.includes('Honeypot'), 'Reason must mention honeypot');

    // Subsequent normal requests from this IP should also be blocked
    const subsequent = checkRateLimit(badIp, '/api/normal');
    assertEqual(subsequent.allowed, false, 'Blacklisted IP must be blocked on all endpoints');

    unbanIp(badIp);
  });

  it('should allow normal requests within threshold and throttle when exceeded', () => {
    const testIp = '203.0.113.99';
    unbanIp(testIp);

    // Initial request
    const first = checkRateLimit(testIp, '/api/test', { max: 3 });
    assertEqual(first.allowed, true);

    checkRateLimit(testIp, '/api/test', { max: 3 });
    checkRateLimit(testIp, '/api/test', { max: 3 });

    // 4th request exceeds threshold of 3
    const fourth = checkRateLimit(testIp, '/api/test', { max: 3 });
    assertEqual(fourth.allowed, false);

    unbanIp(testIp);
  });
});

describe('Security Suite — Audit Logger', () => {
  it('should record and retrieve security audit events', async () => {
    const mockEnv = {
      KV: {
        store: {},
        async get(k) { return this.store[k] ? JSON.parse(this.store[k]) : null; },
        async put(k, v) { this.store[k] = v; }
      }
    };

    const event = await logSecurityEvent(mockEnv, AUDIT_EVENT_TYPES.AUTH_SUCCESS, {
      ip: '127.0.0.1',
      user: 'admin',
      details: { method: 'totp' }
    }, AUDIT_SEVERITY.INFO);

    assert(event.id.startsWith('sec_'), 'Event must have sec_ prefix');
    assertEqual(event.eventType, AUDIT_EVENT_TYPES.AUTH_SUCCESS);

    const history = await getRecentSecurityEvents(mockEnv);
    assert(history.length >= 1, 'History must contain logged event');
    assertEqual(history[0].user, 'admin');
  });
});
