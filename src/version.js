// منبع یگانهٔ نسخه: پنل، بررسی به‌روزرسانی و اسکریپت انتشار ریلیز همه از همین فایل می‌خوانند.
// برای انتشار نسخهٔ جدید فقط APP_BUILD (و در صورت نیاز APP_VERSION و یادداشت‌ها) را بالا ببرید.
export const APP_NAME = 'Arizo Self';
export const APP_VERSION = '3.6.4';
export const APP_CHANNEL = 'PRO';
export const APP_BUILD = 2026102602;

export const RELEASE_NOTES = {
  fa: [
    'پیش‌نمایش زندهٔ نمایه حالا نام واقعی حساب تلگرامِ متصل را نشان می‌دهد، نه نام کاربری پنل',
    'رفع کامل سکوت (.mute/.unmute): تغییرات دیگر با همگام‌سازی دقیقه‌ای پاک نمی‌شود، .unmute با یوزرنیم آیدی را هم حذف می‌کند و سوییچ سکوت پنل واقعاً خاموش می‌کند',
    'دستور جدید .mutelist و پشتیبانی از .mute در پیوی بدون ریپلای؛ جلوگیری از سکوت اشتباه خودتان',
    'تغییرات .ghost / .ai / اعلان چت‌ها از داخل تلگرام هم دیگر برگردانده نمی‌شود',
    'به‌روزرسانی خودکار: توکن یک بار (رمزنگاری‌شده) ذخیره می‌شود؛ سایت هر ۶ ساعت GitHub را می‌بیند و نسخهٔ جدید را خودکار نصب می‌کند',
    'بخش «سیستم و به‌روزرسانی» در پنل مدیریت: مشخصات سامانه، بررسی نسخهٔ جدید و به‌روزرسانی با یک کلیک',
    'ویزارد راه‌اندازی خودکار روی Cloudflare و GitHub بدون رمز مدیر؛ اولین کاربر مدیر کل می‌شود',
    'ساخت اولین حساب فقط با کد راه‌اندازی یک‌بار مصرف',
    'ویزارد روی Worker دیپلوی‌شده فقط «راه‌اندازی» می‌کند و دیتابیس‌های موجود را دوباره استفاده می‌کند'
  ],
  en: [
    'The live profile preview now shows the connected Telegram account\'s real name instead of the panel username',
    'Mute fixed end-to-end: .mute/.unmute survive the minute sync, .unmute by username also clears the resolved ID, and the panel mute switch really turns it off',
    'New .mutelist command and .mute in a private chat without reply; you can no longer accidentally mute yourself',
    '.ghost / .ai / chat-alert changes made from Telegram are no longer reverted by the sync',
    'Automatic updates: store the token once (encrypted); the site checks GitHub every 6 hours and installs new releases by itself',
    'New "System & Updates" tab in the admin panel: system specs, update check and one-click update',
    'Fully automated Cloudflare + GitHub setup wizard with no admin password; the first user becomes the owner',
    'The first account can only be created with a one-time setup code',
    'On a deployed Worker the wizard only sets it up and reuses existing databases'
  ]
};
