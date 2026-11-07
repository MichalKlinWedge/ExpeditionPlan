import { describe, expect, it } from 'vitest';

import { HttpUrl, Link, LocalDateTime, TimeZone } from '../schemas/common.ts';
import { Price } from '../schemas/price.ts';
import { TripBrief } from '../schemas/trip-brief.ts';

describe('TimeZone', () => {
  it('przyjmuje strefy IANA z planów', () => {
    for (const zone of ['Europe/Warsaw', 'Africa/Casablanca', 'Asia/Tbilisi', 'Europe/Madrid']) {
      expect(TimeZone.safeParse(zone).success).toBe(true);
    }
  });

  it('odrzuca literówkę i skrót, który nie zna zmiany czasu', () => {
    expect(TimeZone.safeParse('Europe/Warsow').success).toBe(false);
    expect(TimeZone.safeParse('CET').success).toBe(false);
  });
});

describe('LocalDateTime', () => {
  it('nie przyjmuje strefy w samej dacie — strefa idzie osobnym polem', () => {
    expect(LocalDateTime.safeParse('2026-12-26T06:10').success).toBe(true);
    expect(LocalDateTime.safeParse('2026-12-26T06:10:00Z').success).toBe(false);
  });
});

describe('Price', () => {
  it('unosi progi wiekowe z kasy Pałacu Bahia', () => {
    const parsed = Price.parse({
      currency: 'MAD',
      basis: 'per_person',
      minMinor: 5000,
      maxMinor: 10000,
      tiers: [
        { label: 'dorosły', minAge: 14, amountMinor: 10000 },
        { label: 'dziecko 7–13', minAge: 7, maxAge: 13, amountMinor: 5000 },
      ],
    });

    expect(parsed.from).toBe(false);
    expect(parsed.tiers).toHaveLength(2);
  });

  it('odrzuca przedział odwrócony', () => {
    expect(Price.safeParse({ currency: 'EUR', basis: 'per_group', minMinor: 16500, maxMinor: 9500 }).success).toBe(false);
  });
});

describe('TripBrief', () => {
  const minimal = {
    title: 'Test',
    goal: 'Sprawdzić schemat',
    location: { kind: 'city', countries: ['PL'], places: ['Wrocław'] },
    dates: { kind: 'fixed', start: '2026-11-01', end: '2026-11-02' },
    profiles: ['sightseeing'],
    travelers: [{ name: 'Ala' }],
    transport: ['walk'],
    budget: { level: 'low', currency: 'PLN' },
  };

  it('uzupełnia wartości domyślne', () => {
    const brief = TripBrief.parse(minimal);

    expect(brief.homeTz).toBe('Europe/Warsaw');
    expect(brief.constraints.pace).toBe('normal');
    expect(brief.fixed).toEqual([]);
  });

  it('nie przyjmuje wyjazdu, który kończy się przed początkiem', () => {
    const result = TripBrief.safeParse({ ...minimal, dates: { kind: 'fixed', start: '2026-11-02', end: '2026-11-01' } });

    expect(result.success).toBe(false);
  });
});

describe('link dla człowieka', () => {
  it('tylko http(s)', () => {
    expect(HttpUrl.safeParse('https://example.com/a').success).toBe(true);
    expect(HttpUrl.safeParse('http://example.com').success).toBe(true);
    expect(HttpUrl.safeParse('javascript:alert(1)').success).toBe(false);
    expect(Link.safeParse({ label: 'x', url: 'javascript:alert(1)' }).success).toBe(false);
  });
});
