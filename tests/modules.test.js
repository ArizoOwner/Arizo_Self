import { describe, it, assert, assertEqual } from './test-runner.js';
import { AutoResponderEngine } from '../src/modules/autoResponder.js';
import { AntiDeleteSniper } from '../src/modules/antiDelete.js';
import { MediaSaverVault } from '../src/modules/mediaSaver.js';
import { GhostModeController } from '../src/modules/ghostMode.js';
import { CleanerStudio } from '../src/modules/cleaner.js';
import { BackupManager } from '../src/modules/backupManager.js';

describe('Modules — Auto-Responder & AFK Engine', () => {
  it('should trigger AFK auto-reply when AFK is active', () => {
    const engine = new AutoResponderEngine({ enabled: true, isAfk: true, afkReason: 'درس خواندن' });
    const result = engine.evaluate({
      chatId: '12345',
      senderId: '67890',
      senderName: 'علی',
      text: 'سلام چطوری؟',
      isPrivate: true
    });

    assertEqual(result.shouldReply, true);
    assertEqual(result.reason, 'afk');
    assert(result.replyText.includes('درس خواندن'));
    assert(result.replyText.includes('علی'));
  });

  it('should respect cooldown and avoid duplicate replies', () => {
    const engine = new AutoResponderEngine({ enabled: true, isAfk: true, cooldownSeconds: 60 });
    const first = engine.evaluate({ chatId: 'chat_99', senderId: 'u1', text: 'سلام', isPrivate: true });
    assertEqual(first.shouldReply, true);

    // Second message immediately after should be blocked by cooldown
    const second = engine.evaluate({ chatId: 'chat_99', senderId: 'u1', text: 'کجایی پس؟', isPrivate: true });
    assertEqual(second.shouldReply, false);
    assertEqual(second.reason, 'cooldown');
  });

  it('should match custom keyword rules', () => {
    const engine = new AutoResponderEngine({
      enabled: true,
      isAfk: false,
      rules: [
        { trigger: 'قیمت', reply: 'تعرفه اشتراک ماهانه ۵۰ هزار تومان است.', type: 'contains' },
        { trigger: '^ping$', reply: 'pong!', type: 'regex' }
      ]
    });

    const priceResult = engine.evaluate({ chatId: 'c1', senderId: 'u1', text: 'سلام لطفا قیمت رو بفرمایید' });
    assertEqual(priceResult.shouldReply, true);
    assert(priceResult.replyText.includes('تعرفه اشتراک'));

    const pingResult = engine.evaluate({ chatId: 'c2', senderId: 'u2', text: 'ping' });
    assertEqual(pingResult.shouldReply, true);
    assertEqual(pingResult.replyText, 'pong!');
  });
});

describe('Modules — Anti-Delete & Edit Sniper', () => {
  it('should cache messages and catch deleted ones', () => {
    const sniper = new AntiDeleteSniper({ maxCached: 50 });
    sniper.cacheMessage({
      id: 101,
      chatId: 'priv_123',
      chatTitle: 'چت تست',
      senderId: 'user_456',
      senderName: 'سارا',
      text: 'پیام محرمانه که قراره پاک شه'
    });

    const detected = sniper.handleDeletions('priv_123', [101]);
    assertEqual(detected.length, 1);
    assertEqual(detected[0].senderName, 'سارا');
    assertEqual(detected[0].text, 'پیام محرمانه که قراره پاک شه');

    const report = AntiDeleteSniper.formatReport(detected[0]);
    assert(report.includes('سارا'));
    assert(report.includes('پیام محرمانه'));
  });

  it('should detect message edits and provide diff', () => {
    const sniper = new AntiDeleteSniper({ maxCached: 50 });
    sniper.cacheMessage({
      id: 202,
      chatId: 'c1',
      senderName: 'محمد',
      text: 'متن اولیه پیام'
    });

    const edit = sniper.handleEdit({
      id: 202,
      chatId: 'c1',
      text: 'متن ویرایش شده جدید'
    });

    assertEqual(edit.wasEdited, true);
    assertEqual(edit.oldText, 'متن اولیه پیام');
    assertEqual(edit.newText, 'متن ویرایش شده جدید');
  });
});

describe('Modules — Anti-TTL Media Saver', () => {
  it('should identify TTL media flags and strictly reject groups/channels and 24h auto-delete', () => {
    const regularMsg = { media: { photo: { id: 1 } } };
    assertEqual(MediaSaverVault.isTtlMedia(regularMsg), false);

    const ttlMsg = { media: { ttlSeconds: 10, photo: { id: 2 } } };
    assertEqual(MediaSaverVault.isTtlMedia(ttlMsg), true);

    // پیام‌های گروه‌ها و کانال‌ها هرگز نباید به عنوان Anti-TTL تلقی شوند
    const groupMsg = { isGroup: true, media: { ttlSeconds: 10, photo: { id: 3 } } };
    assertEqual(MediaSaverVault.isTtlMedia(groupMsg), false);

    const channelDiscussionMsg = { isChannel: true, ttlPeriod: 86400, media: { photo: { id: 4 } } };
    assertEqual(MediaSaverVault.isTtlMedia(channelDiscussionMsg), false);

    const peerChannelMsg = { peerId: { className: 'PeerChannel' }, media: { ttlSeconds: 5, photo: { id: 5 } } };
    assertEqual(MediaSaverVault.isTtlMedia(peerChannelMsg), false);

    // قابلیت حذف خودکار ۲۴ ساعته (86400 ثانیه) نباید به عنوان رسانه زمان‌دار موقت شناسایی شود
    const autoDelete24hMsg = { ttlPeriod: 86400, media: { photo: { id: 6 } } };
    assertEqual(MediaSaverVault.isTtlMedia(autoDelete24hMsg), false);

    // عکس با تایمر موقت کوتاه یا ویو-وانس در پیوی باید تایید شود
    const viewOnceMsg = { media: { flags: 4, photo: { id: 7 } } };
    assertEqual(MediaSaverVault.isTtlMedia(viewOnceMsg), true);
  });

  it('should record saved media and generate vault caption', () => {
    const vault = new MediaSaverVault();
    const record = vault.recordSavedMedia({
      senderId: 'user_777',
      senderName: 'آرش',
      chatId: 'chat_888',
      ttlSeconds: 5,
      caption: 'عکس تست یکبار مصرف'
    });

    assertEqual(record.ttlSeconds, 5);
    const caption = MediaSaverVault.buildVaultCaption(record);
    assert(caption.includes('آرش'));
    assert(caption.includes('5 ثانیه'));
    assert(caption.includes('عکس تست یکبار مصرف'));
  });
});

describe('Modules — Ghost Mode & Cleaner', () => {
  it('should control read receipts based on stealth settings', () => {
    const ghost = new GhostModeController({ enabled: true, stealthRead: true });
    assertEqual(ghost.canSendReadReceipt('chat_1'), false);

    ghost.updateSettings({ stealthRead: false });
    assertEqual(ghost.canSendReadReceipt('chat_1'), true);
  });

  it('should chunk array items properly for batch processing', () => {
    const items = [1, 2, 3, 4, 5, 6, 7];
    const chunks = CleanerStudio.chunk(items, 3);
    assertEqual(chunks.length, 3);
    assertEqual(chunks[0].length, 3);
    assertEqual(chunks[2].length, 1);
  });
});

describe('Modules — Encrypted Backup Manager', () => {
  it('should export and import encrypted backup cleanly', async () => {
    const sampleData = {
      users: [{ username: 'admin', tier: 'PRO' }],
      config: { autoResponder: true }
    };
    const password = 'SuperSecretBackupPassword@2026';

    const backupFile = await BackupManager.exportEncryptedBackup(sampleData, password);
    assert(backupFile.includes('encrypted-backup-v2'), 'Backup file must contain format header');

    const restored = await BackupManager.importEncryptedBackup(backupFile, password);
    assertEqual(restored.users[0].username, 'admin');
    assertEqual(restored.config.autoResponder, true);
  });
});
