import { describe, it, assert, assertEqual } from './test-runner.js';
import {
  hashPassword,
  verifyPassword,
  timingSafeEqualHex,
  timingSafeStringCompare,
  generateRandomHex,
  generateRedeemCode,
  encryptSession,
  decryptSession,
  validatePasswordStrength
} from '../src/crypto.js';

describe('Crypto & Security Engine Tests', () => {
  it('should validate password strength accurately', () => {
    assertEqual(validatePasswordStrength('short').valid, false);
    assertEqual(validatePasswordStrength('secure_password_1234').valid, true);
    assertEqual(validatePasswordStrength(12345).valid, false);
  });

  it('should perform timing-safe hex and string comparisons', async () => {
    assertEqual(timingSafeEqualHex('abcdef', 'abcdef'), true);
    assertEqual(timingSafeEqualHex('abcdef', 'abcdeg'), false);
    assertEqual(timingSafeEqualHex('abc', 'abcd'), false);

    const match = await timingSafeStringCompare('secret_token_alpha', 'secret_token_alpha');
    assertEqual(match, true);

    const noMatch = await timingSafeStringCompare('secret_token_alpha', 'secret_token_beta');
    assertEqual(noMatch, false);
  });

  it('should hash and verify passwords using PBKDF2 with salt', async () => {
    const password = 'MasterAdminPassword@2026';
    const salt = generateRandomHex(16);
    const hash = await hashPassword(password, salt);

    assert(hash && hash.length === 64, 'Hash must be 64-character hex (SHA-256)');
    
    const isValid = await verifyPassword(password, salt, hash);
    assertEqual(isValid, true, 'Valid password verification must succeed');

    const isInvalid = await verifyPassword('WrongPassword', salt, hash);
    assertEqual(isInvalid, false, 'Invalid password verification must fail');
  });

  it('should generate valid redeem codes with standard pattern', () => {
    const code = generateRedeemCode();
    assert(code.startsWith('ARIZO-'), 'Redeem code must start with ARIZO-');
    const parts = code.split('-');
    assertEqual(parts.length, 4, 'Redeem code must have 4 segments');
  });

  it('should encrypt and decrypt Telegram session strings with AES-GCM', async () => {
    const secretKey = 'test-secret-key-1234567890';
    const originalSession = '1BJWap1wBu5T8lXqX1R8Z6W_Telegram_Session_Data_Mock_2026';

    const encrypted = await encryptSession(originalSession, secretKey);
    assert(encrypted.startsWith('v2:'), 'Encrypted session must have v2 prefix');

    const decrypted = await decryptSession(encrypted, secretKey);
    assertEqual(decrypted, originalSession, 'Decrypted session must match original');

    const wrongDecrypted = await decryptSession(encrypted, 'wrong-key');
    assertEqual(wrongDecrypted, '', 'Decryption with wrong key must fail and return empty');
  });
});
