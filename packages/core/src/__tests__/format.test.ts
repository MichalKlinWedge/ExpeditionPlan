import { describe, expect, it } from 'vitest';

import { formatMoneyRange, moneyToInput } from '../budget.ts';
import { capitalized, dayChip, dayLabel, dayMonth, formatKm, plural, pluralForm, shortDate } from '../format.ts';
import { formatMinutes } from '../plan-info.ts';

describe('odmiana po liczbie', () => {
  const zmiany = ['zmiana', 'zmiany', 'zmian'] as const;
  it.each([
    [0, '0 zmian'],
    [1, '1 zmiana'],
    [2, '2 zmiany'],
    [4, '4 zmiany'],
    [5, '5 zmian'],
    [12, '12 zmian'],
    [14, '14 zmian'],
    [22, '22 zmiany'],
    [25, '25 zmian'],
    [112, '112 zmian'],
    [122, '122 zmiany'],
  ] as const)('%i', (count, text) => {
    expect(plural(count, zmiany)).toBe(text);
  });
  it('sama forma bez liczby', () => expect(pluralForm(3, ['noc', 'noce', 'nocy'])).toBe('noce'));
});

describe('dystans, czas i kwoty', () => {
  it('kilometry', () => {
    expect(formatKm(3.25)).toBe('3,3 km');
    expect(formatKm(63.6)).toBe('64 km');
  });
  it('minuty', () => {
    expect(formatMinutes(45)).toBe('45 min');
    expect(formatMinutes(120)).toBe('2 h');
    expect(formatMinutes(84)).toBe('1 h 24 min');
  });
  it('zaokrąglenie nie daje 60 minut', () => expect(formatMinutes(119.7)).toBe('2 h'));
  it('kwota do pola formularza', () => {
    expect(moneyToInput(1200)).toBe('12');
    expect(moneyToInput(127050)).toBe('1270,50');
  });
  it('zakres kwot', () => {
    expect(formatMoneyRange(1000, 2000, 'EUR')).toContain(' – ');
    expect(formatMoneyRange(1000, 1000, 'EUR')).not.toContain(' – ');
  });
});

describe('daty z planu', () => {
  it('etykiety', () => {
    expect(dayLabel('2026-12-05')).toBe('sobota, 5 grudnia');
    expect(capitalized(dayLabel('2026-12-05'))).toBe('Sobota, 5 grudnia');
    expect(dayChip('2026-12-05')).toBe('sob., 5.12');
    expect(dayMonth('2026-12-05')).toBe('5 grudnia');
    expect(shortDate('2026-12-05')).toBe('5 gru');
  });
});
