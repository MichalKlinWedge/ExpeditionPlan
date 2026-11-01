import { TripBrief } from '@expeditionplan/core';
import { describe, expect, it } from 'vitest';

import { chunksFor, dayFact, stagePlanSchema, tripContext, tripDates } from '@expeditionplan/planner';
import { detectRisks } from '../metrics.ts';
import { assertAllowed, costUsd } from '../pricing.ts';

const brief = TripBrief.parse({
  title: 'Test',
  goal: 'Test',
  location: { kind: 'city', countries: ['ES'], places: ['Barcelona'] },
  dates: { kind: 'fixed', start: '2026-12-05', end: '2026-12-07' },
  profiles: ['sightseeing'],
  travelers: [{ name: 'Dorosły', age: 40 }],
  transport: ['public'],
  budget: { level: 'medium', currency: 'PLN' },
});

describe('części etapu 2', () => {
  it('wyjazd nie dłuższy niż część w jednym zapytaniu, dłuższy po 4 dni z przedrostkami ref', () => {
    expect(chunksFor(tripDates('2026-12-26', '2026-12-30'), 5)).toEqual([
      { index: 0, dates: ['2026-12-26', '2026-12-27', '2026-12-28', '2026-12-29', '2026-12-30'], dayRefs: ['d1', 'd2', 'd3', 'd4', 'd5'], refPrefix: '' },
    ]);
    const long = chunksFor(tripDates('2027-08-04', '2027-08-15'));
    expect(long.map((chunk) => chunk.dayRefs.join(','))).toEqual(['d1,d2,d3,d4', 'd5,d6,d7,d8', 'd9,d10,d11,d12']);
    expect(long[1]!.refPrefix).toBe('c2-');
  });

  it('schemat odpowiedzi łapie złe dni, przedrostki i odwołania do nieistniejących miejsc', () => {
    const chunk = { index: 1, dates: ['2026-12-06'], dayRefs: ['d2'], refPrefix: 'c2-' };
    const result = stagePlanSchema(tripContext(brief, 'Europe/Madrid'), chunk).safeParse({
      days: [{ ref: 'd1', date: '2026-12-06', tz: 'Europe/Madrid' }],
      items: [{ ref: 'x', dayRef: 'd1', sortKey: '0010', kind: 'visit', title: 'Sagrada', placeRef: 'brak' }],
    });

    expect(result.success).toBe(false);
    const messages = result.error!.issues.map((issue) => issue.message).join(' | ');
    expect(messages).toContain('Dozwolone dni: d2=2026-12-06');
    expect(messages).toContain('„c2-”');
    expect(messages).toMatch(/brak/);
  });
});

describe('fakty dnia', () => {
  it('Barcelona 5.12: zachód ok. 17:22, święto z listy, bez zmiany czasu', () => {
    const fact = dayFact({ date: '2026-12-06', base: 'Barcelona' }, 'Europe/Madrid', { lat: 41.39, lng: 2.17 }, [
      { date: '2026-12-06', localName: 'Día de la Constitución', name: 'Constitution Day', countryCode: 'ES' },
    ]);

    expect(fact.sunset).toMatch(/^17:2\d$/);
    expect(fact.holidays).toEqual(['Día de la Constitución (Constitution Day)']);
    expect(fact.dst).toBeUndefined();
  });
});

describe('ryzyka i koszt', () => {
  it('wykrywa ryzyka z planów ręcznych w tekście odpowiedzi', () => {
    const risks = detectRisks('chatka', 'Uwaga: w nocy zmiana czasu na zimowy; zabierz czołówki.');
    expect(risks.filter((risk) => risk.found).map((risk) => risk.risk)).toEqual(['zmiana czasu w nocy', 'zmrok, czołówki']);
  });

  it('Fable jest zablokowany, Opus tylko podany wprost (nie ma go w domyślnych), koszt z cennika', async () => {
    const { DEFAULT_RUN_MODELS } = await import('../pricing.ts');
    expect(() => assertAllowed('claude-fable-5-1')).toThrow();
    expect(() => assertAllowed('claude-opus-5-5')).not.toThrow();
    expect(DEFAULT_RUN_MODELS).not.toContain('claude-opus-5-5');
    expect(costUsd('claude-sonnet-5-5', { inputTokens: 1_000_000, outputTokens: 100_000 })).toBeCloseTo(3);
    expect(costUsd('claude-haiku-5-5', { inputTokens: 200_000, outputTokens: 0 })).toBeCloseTo(0.1);
  });
});

describe('pinezki z briefu', () => {
  it('„Przełęcz Spalona” dostaje współrzędne pinezki „Parking na Przełęczy Spalonej (…)”, schronisko z OSM zostaje', async () => {
    const { applyPins } = await import('@expeditionplan/planner');
    const { TripDocument } = await import('@expeditionplan/core');
    const doc = TripDocument.parse({
      schemaVersion: 1,
      trip: { title: 'T', startDate: '2026-10-24', endDate: '2026-10-25', primaryTz: 'Europe/Warsaw', baseCurrency: 'PLN' },
      places: [
        { ref: 'parking', name: 'Przełęcz Spalona' },
        { ref: 'schronisko', name: 'Schronisko PTTK Jagodna', lat: 50.2771, lng: 16.5373, provider: 'osm' },
        { ref: 'wroclaw', name: 'Wrocław' },
      ],
    });
    const pinned = applyPins(doc, [{ name: 'Parking na Przełęczy Spalonej (schronisko PTTK „Jagodna”)', lat: 50.2767, lng: 16.5373 }]);

    expect(pinned.places.map((place) => [place.ref, place.lat ?? null, place.provider])).toEqual([
      ['parking', 50.2767, 'user'],
      ['schronisko', 50.2771, 'osm'],
      ['wroclaw', null, 'unknown'],
    ]);
  });
});
