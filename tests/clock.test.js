import { describe, it, assert, assertEqual } from './test-runner.js';
import {
  FONT_PRESETS,
  getTehranTimeParts,
  getStylizedTime,
  renderDynamicBio,
  isSleepTime,
  getPersianDateString,
  getPersianDayName,
  getEnglishDayName,
  gregorianToJalali,
  getDynamicBattery,
  getDynamicMood
} from '../src/clock.js';

describe('Clock & Bio Engine Tests', () => {
  it('should have 30+ defined font presets with exactly 10 digits each', () => {
    assert(Object.keys(FONT_PRESETS).length >= 30, `Expected at least 30 font presets, found ${Object.keys(FONT_PRESETS).length}`);
    for (const [key, preset] of Object.entries(FONT_PRESETS)) {
      assert(preset.name, `Preset ${key} must have a name`);
      assert(Array.isArray(preset.digits), `Preset ${key} digits must be an array`);
      assertEqual(preset.digits.length, 10, `Preset ${key} must have 10 digits`);
    }
  });

  it('should calculate Tehran time parts accurately', () => {
    const fixedDate = new Date('2026-03-21T12:00:00.000Z'); // 12:00 UTC = 15:30 Tehran
    const parts = getTehranTimeParts(fixedDate);
    assertEqual(parts.hh, '15');
    assertEqual(parts.mm, '30');
    assertEqual(parts.rawHours, 15);
    assertEqual(parts.rawMinutes, 30);
  });

  it('should convert Gregorian date to pure algorithmic Jalali calendar', () => {
    // 2026-03-21 is 1 Farvardin 1405 (Nowruz!)
    const nowruz = new Date('2026-03-21T00:00:00.000Z');
    const j = gregorianToJalali(nowruz);
    assertEqual(j.jy, 1405, 'Year should be 1405');
    assertEqual(j.jm, 1, 'Month should be 1');
    assertEqual(j.jd, 1, 'Day should be 1');
    assertEqual(j.monthName, 'فروردین');
    assert(j.season.includes('بهار'), 'Season should be Spring');
    assertEqual(j.zodiac.symbol, '♈', 'Zodiac should be Aries');
  });

  it('should generate dynamic battery and mood strings', () => {
    const morningBattery = getDynamicBattery(7);
    assert(morningBattery.includes('100%'));

    const morningMood = getDynamicMood(7);
    assert(morningMood.includes('صبح'));

    const lateNightMood = getDynamicMood(2);
    assert(lateNightMood.includes('خواب'));
  });

  it('should generate stylized time with custom font and 12h/24h formats', () => {
    const fixedDate = new Date('2026-03-21T12:00:00.000Z'); // 15:30 Tehran
    const boldTime = getStylizedTime(FONT_PRESETS.bold.digits, ':', fixedDate);
    assertEqual(boldTime, '𝟏𝟓:𝟑𝟎');

    const persianTime = getStylizedTime(FONT_PRESETS.persian.digits, ':', fixedDate);
    assertEqual(persianTime, '۱۵:۳۰');

    const fullwidthTime = getStylizedTime(FONT_PRESETS.fullwidth.digits, ':', fixedDate);
    assertEqual(fullwidthTime, '１５:３０');

    const time12h = getStylizedTime(FONT_PRESETS.normal.digits, ':', fixedDate, { is12h: true });
    assertEqual(time12h, '03:30 ᴾᴹ');
  });

  it('should correctly calculate sleep time windows', () => {
    const midnight = new Date('2026-03-21T20:30:00.000Z'); // 00:00 Tehran
    assertEqual(isSleepTime(23, 7, midnight), true);

    const noon = new Date('2026-03-21T08:30:00.000Z'); // 12:00 Tehran
    assertEqual(isSleepTime(23, 7, noon), false);

    const afternoon = new Date('2026-03-21T10:30:00.000Z'); // 14:00 Tehran
    assertEqual(isSleepTime(13, 15, afternoon), true);
  });

  it('should render rich dynamic bio templates with all variables', () => {
    const fixedDate = new Date('2026-03-21T12:00:00.000Z');
    const template = '⚡ {time} | {day} | {season} | {battery}';
    const rendered = renderDynamicBio(template, {
      digits: FONT_PRESETS.normal.digits,
      colon: ':',
      date: fixedDate
    });
    assert(rendered.includes('15:30'), 'Expected time rendered in bio');
    assert(rendered.length <= 70, 'Bio length must not exceed 70 characters');
  });

  it('should format Persian and English day names', () => {
    const now = new Date();
    const faDay = getPersianDayName(now);
    const enDay = getEnglishDayName(now);
    assert(faDay.length > 0, 'Persian day name must be non-empty');
    assert(enDay.length > 0, 'English day name must be non-empty');
  });
});
