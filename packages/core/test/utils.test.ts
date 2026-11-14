import { describe, expect, it } from 'vitest';
import {
  alertMessage, constantTimeEqual, evaluateRule, evaluateRules, generateReporterCode, hashPhone, hashReporterCode,
  isGsm7, maskPhone, paginate, QA_MATCH_THRESHOLD, scoreQa, t, toGsm7, tokenize, truncate, type AlertRule, type DayForecast,
  registerLocale, lagosTime, shortDay,
} from '../src';

describe('i18n', () => {
  it('interpolates and falls back to English then the key', () => {
    expect(t('en', 'ussd.age_days', { n: 3 })).toBe('3d');
    expect(t('xx', 'ussd.back')).toBe('0 Back');
    expect(t('en', 'no.such.key')).toBe('no.such.key');
    registerLocale('pcm', { 'ussd.back': '0 Go back' });
    expect(t('pcm', 'ussd.back')).toBe('0 Go back');
    expect(t('pcm', 'ussd.next')).toBe('1 Next');
  });
});

describe('gsm', () => {
  it('validates', () => {
    expect(isGsm7('Hello N500, ok?')).toBe(true);
    expect(isGsm7('Price ₦500')).toBe(false);
    expect(isGsm7('emoji \u{1F600}')).toBe(false);
  });
  it('converts', () => {
    expect(toGsm7('₦500')).toBe('N500');
    expect(toGsm7('ọ́')).toBe('o');
    expect(toGsm7('\u{1F600}')).toBe('?');
    expect(isGsm7(toGsm7('mixed “quotes” ọṣ'))).toBe(true);
  });
});

describe('truncate and paginate', () => {
  it('leaves short text alone', () => expect(truncate('hello world', 20)).toBe('hello world'));
  it('cuts at a word boundary with ellipsis within max', () => {
    const out = truncate('Plant maize early in the season', 20);
    expect(out.length).toBeLessThanOrEqual(20);
    expect(out.endsWith('...')).toBe(true);
    expect(out).toBe('Plant maize early...');
  });
  it('boundary: exact length and one over', () => {
    expect(truncate('abcde', 5)).toBe('abcde');
    expect(truncate('abcdef', 5)).toBe('ab...');
    expect(truncate('abc', 2)).toBe('..');
  });
  it('paginates without exceeding max', () => {
    const pages = paginate('one two three four five six seven', 12);
    expect(pages.every((p) => p.length <= 12)).toBe(true);
    expect(pages.join(' ')).toBe('one two three four five six seven');
    expect(paginate('x'.repeat(25), 10)).toEqual(['x'.repeat(10), 'x'.repeat(10), 'x'.repeat(5)]);
    expect(paginate('', 10)).toEqual(['']);
  });
  it('date helpers', () => {
    expect(shortDay('2026-11-14')).toBe('Sat 14');
    expect(lagosTime('2026-11-14T23:30:00Z')).toBe('00:30');
  });
});

describe('qa scoring', () => {
  const item = { question: 'How do I store maize after harvest?', keywords: 'storage drying weevil' };
  it('tokenises without stop words and plurals', () => {
    expect(tokenize('How do the Maize bags?')).toEqual(['maize', 'bag']);
  });
  it('is 0 for unrelated and empty queries', () => {
    expect(scoreQa('price of fertilizer', item)).toBe(0);
    expect(scoreQa('the of a', item)).toBe(0);
  });
  it('keywords outweigh question words', () => {
    expect(scoreQa('weevil', item)).toBe(1);
    expect(scoreQa('harvest', item)).toBe(0.5);
  });
  it('threshold behaviour', () => {
    expect(scoreQa('store maize', item)).toBeGreaterThanOrEqual(QA_MATCH_THRESHOLD);
    expect(scoreQa('store pests fertilizer', item)).toBeLessThan(QA_MATCH_THRESHOLD);
  });
  it('stays within 0..1', () => {
    for (const q of ['storage storage', 'maize', 'weevil drying storage']) {
      const s = scoreQa(q, item);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
  });
});

describe('crypto helpers', () => {
  it('hashes phone numbers consistently and keyed', async () => {
    const a = await hashPhone('+234 801 000 0000', 's1');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashPhone('2348010000000', 's1')).toBe(a);
    expect(await hashPhone('2348010000000', 's2')).not.toBe(a);
  });
  it('hashes reporter codes case-insensitively', async () => {
    expect(await hashReporterCode('abcd2345', 'p')).toBe(await hashReporterCode('ABCD2345', 'p'));
  });
  it('constant time compare', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
    expect(constantTimeEqual('', '')).toBe(true);
  });
  it('masks all but last 2 digits', () => {
    expect(maskPhone('+2348012345678')).toBe('***********78');
    expect(maskPhone('7')).toBe('*');
    expect(maskPhone('')).toBe('');
  });
  it('generates unambiguous 8 char codes', () => {
    for (let i = 0; i < 50; i++) expect(generateReporterCode()).toMatch(/^[A-HJKMNP-Z2-9]{8}$/);
  });
});

const day = (date: string, precipMm: number | null, tmaxC: number | null = 30): DayForecast => ({
  date, precipMm, tmaxC, tminC: 20, popPct: 10,
});
const rule = (over: Partial<AlertRule>): AlertRule => ({
  key: 'heavy_rain', metric: 'precip_day_mm', operator: '>=', threshold: 50, windowDays: 3,
  severity: 'warning', enabled: true, needsReview: true, ...over,
});

describe('alert rules: boundaries', () => {
  for (const [name, metric, build] of [
    ['precip', 'precip_day_mm', (v: number) => [day('2026-11-14', 0), day('2026-11-15', v), day('2026-11-16', 0)]],
    ['tmax', 'tmax_c', (v: number) => [day('2026-11-14', 0, 30), day('2026-11-15', 0, v), day('2026-11-16', 0, 30)]],
  ] as const) {
    it(`${name}: threshold-1 no, equal yes, +1 yes`, () => {
      const r = rule({ metric, threshold: 40 });
      expect(evaluateRule(build(39), r)).toBeNull();
      expect(evaluateRule(build(40), r)?.date).toBe('2026-11-15');
      expect(evaluateRule(build(41), r)?.value).toBe(41);
    });
  }
  it('dry spell: run length boundaries', () => {
    const r = rule({ key: 'dry_spell', metric: 'dry_days_consecutive', threshold: 3, windowDays: 7, severity: 'watch' });
    const mk = (p: number[]) => p.map((v, i) => day(`2026-11-${14 + i}`, v));
    expect(evaluateRule(mk([0, 0, 5, 0, 0, 5, 0]), r)).toBeNull();
    expect(evaluateRule(mk([0, 0, 0, 5, 0, 5, 0]), r)?.value).toBe(3);
    expect(evaluateRule(mk([5, 0, 0, 0, 0, 5, 0]), r)).toMatchObject({ value: 4, date: '2026-11-15' });
    expect(evaluateRule(mk([1, 1, 1, 1, 1, 1, 1]), r)).toBeNull(); // 1 mm is not dry
    expect(evaluateRule(mk([0.9, 0.9, 0.9, 5, 5, 5, 5]), r)?.value).toBe(3);
  });
  it('window limits what is considered', () => {
    const days = [day('a', 0), day('b', 0), day('c', 0), day('d', 90)];
    expect(evaluateRule(days, rule({ windowDays: 3 }))).toBeNull();
    expect(evaluateRule(days, rule({ windowDays: 4 }))?.date).toBe('d');
  });
  it('disabled, unknown metric, null data', () => {
    expect(evaluateRule([day('a', 99)], rule({ enabled: false }))).toBeNull();
    expect(evaluateRule([day('a', 99)], rule({ metric: 'wind' }))).toBeNull();
    expect(evaluateRule([day('a', null, null)], rule({}))).toBeNull();
  });
  it('operators', () => {
    expect(evaluateRule([day('a', 50)], rule({ operator: '>' }))).toBeNull();
    expect(evaluateRule([day('a', 51)], rule({ operator: '>' }))).not.toBeNull();
  });
  it('sorts warnings first and builds messages from templates', () => {
    const days = [day('2026-11-14', 60, 40)];
    const out = evaluateRules(days, [
      rule({ key: 'heat', metric: 'tmax_c', threshold: 38, severity: 'watch' }),
      rule({}),
    ]);
    expect(out.map((a) => a.ruleKey)).toEqual(['heavy_rain', 'heat']);
    expect(alertMessage(out[0]!, 'Abeokuta', 'en')).toBe('Heavy rain forecast for Abeokuta on 14 Nov: 60 mm');
    expect(alertMessage({ ...out[1]!, ruleKey: 'custom' }, 'X', 'en')).toContain('Weather alert for X');
  });
});
