import { TripBrief } from '@expeditionplan/core';
import { describe, expect, it } from 'vitest';

import { stagePlanSchema, tripContext } from '../assemble.ts';

const brief = TripBrief.parse({
  title: 'T',
  goal: 'T',
  location: { kind: 'region', countries: ['HR'], places: ['Zadar'] },
  dates: { kind: 'fixed', start: '2026-04-24', end: '2026-04-26' },
  profiles: ['trekking'],
  travelers: [{ name: 'Dorosły' }],
  transport: ['rental_car'],
  budget: { level: 'medium', currency: 'EUR' },
});

describe('części etapu 2', () => {
  it('przedrostek części doklejony do dnia („c1-d1”) jest zdejmowany, a odwołania do rezerwacji usuwane', () => {
    const chunk = { index: 0, dates: ['2026-04-24'], dayRefs: ['d1'], refPrefix: 'c1-' };
    const result = stagePlanSchema(tripContext(brief, 'Europe/Zagreb'), chunk).safeParse({
      days: [{ ref: 'c1-d1', date: '2026-04-24', tz: 'Europe/Zagreb', lodgingRef: 'c1-nocleg' }],
      items: [{ ref: 'c1-lot', dayRef: 'c1-d1', sortKey: '0010', kind: 'transport', title: 'Lot', bookingRef: 'c1-bilet', leg: { mode: 'flight' } }],
    });

    expect(result.error?.issues).toBeUndefined();
    expect(result.data?.days[0]?.ref).toBe('d1');
    expect(result.data?.items[0]?.dayRef).toBe('d1');
    expect(result.data?.items[0]?.bookingRef).toBeUndefined();
  });
});
