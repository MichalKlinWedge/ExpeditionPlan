import { describe, expect, it } from 'vitest';

import { journalMovedTime, journalRedated, journalTimeAt } from '../journal-order.ts';

const t = (hm: string) => `2026-12-06T${hm}:00.000Z`;

describe('journalMovedTime', () => {
  it('wyżej: minutę przed poprzednim, niżej: minutę po następnym', () => {
    const times = [t('09:00'), t('10:00'), t('15:42')];
    expect(journalMovedTime(times, 2, -1)).toBe(t('09:59'));
    expect(journalMovedTime(times, 0, 1)).toBe(t('10:01'));
  });
  it('ciasno: w połowie odstępu, żeby nie przeskoczyć dwóch miejsc', () => {
    const times = [t('10:00'), '2026-12-06T10:00:30.000Z', t('11:00')];
    expect(journalMovedTime(times, 2, -1)).toBe('2026-12-06T10:00:15.000Z');
  });
  it('na brzegu — null', () => {
    expect(journalMovedTime([t('10:00'), t('11:00')], 0, -1)).toBeNull();
    expect(journalMovedTime([t('10:00'), t('11:00')], 1, 1)).toBeNull();
  });
});

describe('journalRedated / journalTimeAt', () => {
  it('przepięcie zostawia godzinę lokalną i zmienia datę (także strefę)', () => {
    // 15:42 w Barcelonie (UTC+1) → 7 grudnia, wciąż 15:42 w Barcelonie.
    expect(journalRedated('2026-12-06T14:42:00.000Z', 'Europe/Madrid', { date: '2026-12-07', tz: 'Europe/Madrid' })).toBe('2026-12-07T14:42:00.000Z');
    expect(journalRedated('2026-12-06T14:42:00.000Z', 'Europe/Madrid', { date: '2026-12-07', tz: 'Europe/Warsaw' })).toBe('2026-12-07T14:42:00.000Z');
    // Ta sama godzina na zegarze nowego dnia: 15:42 w Casablance (zimą UTC+0).
    expect(journalRedated('2026-12-06T14:42:00.000Z', 'Europe/Madrid', { date: '2026-12-07', tz: 'Africa/Casablanca' })).toBe('2026-12-07T15:42:00.000Z');
  });
  it('godzina wpisana ręcznie', () => {
    expect(journalTimeAt({ date: '2026-12-06', tz: 'Europe/Madrid' }, '9:05')).toBe('2026-12-06T08:05:00.000Z');
    expect(journalTimeAt({ date: '2026-12-06', tz: 'Europe/Madrid' }, '24:00')).toBeNull();
    expect(journalTimeAt({ date: '2026-12-06', tz: 'Europe/Madrid' }, 'rano')).toBeNull();
  });
});
