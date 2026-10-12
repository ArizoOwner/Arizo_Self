import { describe, it, assert, assertEqual } from './test-runner.js';
import { SHAMSI_EVENTS, getShamsiOccasion } from '../src/data/calendarEvents.js';
import { PERSIAN_QUOTES, TECH_QUOTES, getRandomQuote } from '../src/data/quotes.js';
import { renderDynamicBio, FONT_PRESETS } from '../src/clock.js';

describe('Data Suite — Persian Calendar Events & Quotes', () => {
  it('should retrieve correct Shamsi occasions for known dates', () => {
    const nowruz = getShamsiOccasion(1, 1);
    assert(nowruz !== null, '1-1 must have an occasion');
    assert(nowruz.includes('نوروز'), '1-1 must mention Nowruz');

    const yalda = getShamsiOccasion(9, 30);
    assert(yalda !== null, '9-30 must have an occasion');
    assert(yalda.includes('یلدا'), '9-30 must mention Yalda');

    const unknown = getShamsiOccasion(5, 12);
    assertEqual(unknown, null, 'Unlisted date should return null');
  });

  it('should deliver quotes for fa, en and mixed languages', () => {
    assert(PERSIAN_QUOTES.length >= 20, 'Persian quotes pool must have at least 20 items');
    assert(TECH_QUOTES.length >= 10, 'Tech quotes pool must have at least 10 items');

    const faQuote = getRandomQuote('fa');
    assert(faQuote && typeof faQuote === 'string' && faQuote.length > 5);

    const enQuote = getRandomQuote('en');
    assert(enQuote && typeof enQuote === 'string' && enQuote.length > 5);

    const mixedQuote = getRandomQuote('mixed');
    assert(mixedQuote && typeof mixedQuote === 'string');
  });

  it('should render bio with dynamic occasion and quote tokens', () => {
    // 2026-03-21 is 1 Farvardin (Nowruz)
    const fixedDate = new Date('2026-03-21T12:00:00.000Z');
    const template = '⚡ {time} | {occasion}';
    const rendered = renderDynamicBio(template, {
      digits: FONT_PRESETS.normal.digits,
      colon: ':',
      date: fixedDate
    });

    assert(rendered.includes('نوروز'), `Expected Nowruz occasion rendered in bio, got: ${rendered}`);
    assert(rendered.length <= 70, 'Bio length must stay under 70 chars');
  });
});
