import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { TripDocument } from '../schemas/trip-document.ts';
import { tripMemories } from '../trip-memories.ts';

const fixture = (slug: string) => TripDocument.parse(JSON.parse(readFileSync(fileURLToPath(new URL(`../../../../fixtures/plans/${slug}/plan.json`, import.meta.url)), 'utf8')));

describe('pamiątka po wyjeździe', () => {
  it('pięć planów: kolejność dzień po dniu, liczby sensowne, tylko aktywne warianty', () => {
    for (const slug of ['barcelona', 'chatka', 'dinara', 'gruzja', 'maroko']) {
      const doc = fixture(slug);
      const stats = tripMemories(doc, { done: [], skipRefs: [] });
      expect(stats.days).toBe(doc.days.length);
      expect(stats.planned).toBeGreaterThan(0);
      expect(stats.routeRefs).toHaveLength(stats.planned);
      expect(new Set(stats.routeRefs).size).toBe(stats.planned);
      const dates = stats.routeRefs.map((ref) => doc.days.find((day) => day.ref === doc.items.find((item) => item.ref === ref)!.dayRef)!.date);
      expect(dates).toEqual([...dates].sort());
    }
  });

  it('zrobione i pominięte z telefonu; pominięty punkt nie dodaje kilometrów ani nie wchodzi na trasę', () => {
    const doc = fixture('maroko');
    const before = tripMemories(doc, { done: [], skipRefs: [] });
    const withKm = doc.items.find((item) => before.routeRefs.includes(item.ref) && (item.leg?.distanceKm ?? 0) > 0 && item.leg?.mode !== 'flight')!;
    const other = before.routeRefs.find((ref) => ref !== withKm.ref)!;
    const after = tripMemories(doc, { done: [{ itemRef: other }], skipRefs: [withKm.ref] });
    expect(after.done).toBe(1);
    expect(after.skipped).toBe(1);
    expect(after.routeRefs).not.toContain(withKm.ref);
    const km = (stats: typeof before) => stats.footKm + stats.driveKm + stats.transitKm;
    expect(km(after)).toBeCloseTo(km(before) - withKm.leg!.distanceKm!, 0);
  });
});
