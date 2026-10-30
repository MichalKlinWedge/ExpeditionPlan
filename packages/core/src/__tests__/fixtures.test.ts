import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { TripBrief } from '../schemas/trip-brief.ts';

/**
 * Plany referencyjne z `fixtures/plans/` muszą zawsze przechodzić przez schemat. Zmiana schematu,
 * która je łamie, łamie też realne wyjazdy — i ma to wyjść tutaj, a nie przy imporcie.
 */

const root = fileURLToPath(new URL('../../../../fixtures/plans/', import.meta.url));
const plans = readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

describe('plany referencyjne', () => {
  it('jest ich pięć, jak w exaples/', () => {
    expect(plans.sort()).toEqual(['barcelona', 'chatka', 'dinara', 'gruzja', 'maroko']);
  });

  it.each(plans)('%s: brief.json zgadza się ze schematem TripBrief', (plan) => {
    const raw: unknown = JSON.parse(readFileSync(join(root, plan, 'brief.json'), 'utf8'));
    const parsed = TripBrief.safeParse(raw);

    expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
  });
});
