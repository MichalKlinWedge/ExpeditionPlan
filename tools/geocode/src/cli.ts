/**
 * Geokodowanie miejsc w planach wzorcowych (`fixtures/plans/<slug>/plan.json`) przez Nominatim.
 *
 *   npm run geocode -- [slug…] [--write]
 *
 * Bez `--write` tylko raport. Wynik dalej niż promień obszaru wyjazdu od mediany trafień nie jest
 * zapisywany (geokoder trafił w imiennika). Cache zapytań: tools/geocode/.cache.json (poza git).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ALIASES } from './aliases.ts';
import { describeResult, groundPlaces, type PlaceInput, RADIUS_KM, withCoordinates } from '@expeditionplan/planner';

import { cachedLookup } from './ground.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const lookup = cachedLookup(fileURLToPath(new URL('../.cache.json', import.meta.url)));

const args = process.argv.slice(2);
const write = args.includes('--write');
const slugs = args.filter((arg) => !arg.startsWith('--'));
const plans = slugs.length > 0 ? slugs : ['barcelona', 'chatka', 'dinara', 'gruzja', 'maroko'];

type Place = PlaceInput & { lat?: number; lng?: number; provider?: string; [key: string]: unknown };

for (const slug of plans) {
  const planPath = join(root, 'fixtures/plans', slug, 'plan.json');
  const doc = JSON.parse(readFileSync(planPath, 'utf8')) as { places: Place[] };
  const brief = JSON.parse(readFileSync(join(root, 'fixtures/plans', slug, 'brief.json'), 'utf8')) as {
    location: { kind: string; countries: string[] };
  };

  // Wszystkie miejsca, także te ze współrzędnymi: z nich liczy się środek obszaru wyjazdu.
  const results = await groundPlaces(doc.places, {
    countries: brief.location.countries,
    kind: brief.location.kind,
    lookup,
    aliases: ALIASES[slug] ?? {},
  });
  const todo = new Set(doc.places.filter((place) => place.lat === undefined).map((place) => place.ref));
  const byRef = new Map(results.filter((result) => todo.has(result.ref)).map((result) => [result.ref, result]));
  const report = doc.places.map((place) => {
    const result = byRef.get(place.ref);
    return result === undefined ? `  = ${place.ref}: już ma współrzędne` : describeResult(result, place.name);
  });

  doc.places = doc.places.map((place) => {
    const result = byRef.get(place.ref);
    return result?.status === 'found' ? withCoordinates(place, result.hit) : place;
  });
  const withCoords = doc.places.filter((place) => place.lat !== undefined).length;

  console.log(`\n${slug}: ${withCoords}/${doc.places.length} z współrzędnymi (promień ${RADIUS_KM[brief.location.kind] ?? 300} km)`);
  console.log(report.sort().join('\n'));
  if (write) writeFileSync(planPath, JSON.stringify(doc, null, 2) + '\n');
}
