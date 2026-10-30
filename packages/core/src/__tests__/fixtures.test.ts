import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { TripBrief } from '../schemas/trip-brief.ts';
import { TripDocument } from '../schemas/trip-document.ts';

/**
 * Plany referencyjne z `fixtures/plans/` muszą zawsze przechodzić przez schemat. Zmiana schematu,
 * która je łamie, łamie też realne wyjazdy — i ma to wyjść tutaj, a nie przy imporcie.
 */

const root = fileURLToPath(new URL('../../../../fixtures/plans/', import.meta.url));
const plans = readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

const read = (plan: string, file: string): unknown => JSON.parse(readFileSync(join(root, plan, file), 'utf8'));

const problems = (result: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }) =>
  result.success ? [] : (result.error?.issues ?? []).map((issue) => `${issue.path.join('.')}: ${issue.message}`);

describe('plany referencyjne', () => {
  it('jest ich pięć, jak w exaples/', () => {
    expect(plans.sort()).toEqual(['barcelona', 'chatka', 'dinara', 'gruzja', 'maroko']);
  });

  it.each(plans)('%s: brief.json zgadza się ze schematem TripBrief', (plan) => {
    expect(problems(TripBrief.safeParse(read(plan, 'brief.json')))).toEqual([]);
  });

  const withDocument = plans.filter((plan) => existsSync(join(root, plan, 'plan.json')));

  it.runIf(withDocument.length > 0).each(withDocument)('%s: plan.json zgadza się ze schematem TripDocument', (plan) => {
    expect(problems(TripDocument.safeParse(read(plan, 'plan.json')))).toEqual([]);
  });
});
