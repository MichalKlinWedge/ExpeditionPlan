import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { tripCalendar } from '../calendar.ts';
import { TripDocument } from '../schemas/trip-document.ts';

const load = (slug: string) => TripDocument.parse(JSON.parse(readFileSync(fileURLToPath(new URL(`../../../../fixtures/plans/${slug}/plan.json`, import.meta.url)), 'utf8')));

describe('kalendarz ICS', () => {
  const doc = load('maroko');
  const ics = tripCalendar(doc, { tripId: 'trip-1', itemUrl: 'https://example.test/trips/trip-1/item/{ref}', now: Date.UTC(2026, 10, 3, 12) });
  const lines = ics.split('\r\n');

  it('jedno wydarzenie na punkt z godziną w UTC i stałym UID', () => {
    expect(lines[0]).toBe('BEGIN:VCALENDAR');
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    const events = ics.split('BEGIN:VEVENT').length - 1;
    expect(events).toBeGreaterThan(10);
    expect(ics).toMatch(/DTSTART:\d{8}T\d{6}Z/);
    const uids = lines.filter((line) => line.startsWith('UID:'));
    expect(new Set(uids).size).toBe(events);
    expect(uids[0]).toMatch(/^UID:trip-1-.+@expeditionplan$/);
  });

  it('linie najwyżej 75 bajtów, kontynuacja od spacji, bez gołych nowych linii', () => {
    const encoder = new TextEncoder();
    for (const line of lines) expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
    expect(lines.filter((line) => line.startsWith(' ')).length).toBeGreaterThan(0);
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });

  it('znaki specjalne w treści są zapisane z ukośnikiem', () => {
    const odd = { ...doc, trip: { ...doc.trip, title: 'Maroko; dzieci, psy\ni koty' } };
    expect(tripCalendar(odd, { tripId: 't', now: 0 })).toContain('X-WR-CALNAME:Maroko\\; dzieci\\, psy\\ni koty');
  });
});
