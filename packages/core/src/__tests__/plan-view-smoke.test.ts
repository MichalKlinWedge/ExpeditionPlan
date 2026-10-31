import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { proposeCuts, scheduleDay, TripDocument } from '../index.ts';

/** To, co liczy widok planu na webie: każdy dzień w obu scenariuszach i cięcia — bez wyjątków. */
const dir = fileURLToPath(new URL('../../../../fixtures/plans/', import.meta.url));

describe('widok planu: silnik na planach wzorcowych', () => {
  it.each(['barcelona', 'chatka', 'dinara', 'gruzja', 'maroko'])('%s', (slug) => {
    const doc = TripDocument.parse(JSON.parse(readFileSync(`${dir}${slug}/plan.json`, 'utf8')));
    for (const day of doc.days) {
      for (const scenario of ['optimistic', 'pessimistic'] as const) {
        const schedule = scheduleDay(doc, day.ref, { scenario });
        const hard = schedule.warnings.filter((warning) => warning.severity === 'hard');
        if (scenario === 'pessimistic' && (hard.length > 0 || schedule.slack === 'negative')) {
          expect(Array.isArray(proposeCuts(doc, day.ref, { scenario }))).toBe(true);
        }
        expect(schedule.items.length).toBeGreaterThan(0);
      }
    }
  });
});
