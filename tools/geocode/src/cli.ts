/**
 * Geokodowanie miejsc w planach wzorcowych (`fixtures/plans/<slug>/plan.json`) przez Nominatim.
 *
 *   npm run geocode --workspace tools/geocode -- [slug…] [--write]
 *
 * Bez `--write` tylko raport. Wynik dalej niż promień obszaru wyjazdu od mediany trafień nie jest
 * zapisywany (geokoder trafił w imiennika). Cache zapytań: tools/geocode/.cache.json (poza git).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type Box, type GeocodeHit, searchNominatim } from './nominatim.ts';
import { ALIASES } from './aliases.ts';
import { boxAround, candidateQueries, distanceKm, FAR_OK, medianPoint, type PlaceInput, skipReason, tooCoarse } from './queries.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const cachePath = fileURLToPath(new URL('../.cache.json', import.meta.url));
const cache: Record<string, GeocodeHit | null> = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : {};

/** Promień obszaru wyjazdu (km od mediany) według rodzaju wyjazdu z briefu. */
const RADIUS_KM: Record<string, number> = { city: 25, outdoor: 60, region: 200, route: 400, base_camps: 180 };
const HOME_COUNTRY = 'pl';

const args = process.argv.slice(2);
const write = args.includes('--write');
const slugs = args.filter((arg) => !arg.startsWith('--'));
const plans = slugs.length > 0 ? slugs : ['barcelona', 'chatka', 'dinara', 'gruzja', 'maroko'];

async function lookup(query: string, countries: string[], box?: Box): Promise<GeocodeHit | null> {
  const area = box === undefined ? '' : `|${[box.south, box.west, box.north, box.east].map((v) => v.toFixed(2)).join(',')}`;
  const key = `${countries.join(',')}|${query}${area}`;
  if (!(key in cache)) {
    cache[key] = await searchNominatim(query, countries, box);
    writeFileSync(cachePath, JSON.stringify(cache, null, 2) + '\n');
  }
  return cache[key] ?? null;
}

type Place = PlaceInput & { lat?: number; lng?: number; provider?: string; [key: string]: unknown };

/** Współrzędne wstawione zaraz po `category` (albo `name`), żeby diff pliku był czytelny. */
function withCoordinates(place: Place, hit: GeocodeHit): Place {
  const after = 'category' in place ? 'category' : 'name';
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(place)) {
    if (key === 'lat' || key === 'lng' || key === 'provider') continue;
    result[key] = value;
    if (key === after) {
      result.lat = Math.round(hit.lat * 1e5) / 1e5;
      result.lng = Math.round(hit.lng * 1e5) / 1e5;
      result.provider = 'osm';
    }
  }
  return result as Place;
}

for (const slug of plans) {
  const planPath = join(root, 'fixtures/plans', slug, 'plan.json');
  const doc = JSON.parse(readFileSync(planPath, 'utf8')) as { places: Place[] };
  const brief = JSON.parse(readFileSync(join(root, 'fixtures/plans', slug, 'brief.json'), 'utf8')) as {
    location: { kind: string; countries: string[] };
  };
  const tripCountries = brief.location.countries.map((code) => code.toLowerCase());
  const countries = [...new Set([...tripCountries, HOME_COUNTRY])];

  const found = new Map<string, { hit: GeocodeHit; query: string }>();
  const report: string[] = [];
  for (const place of doc.places) {
    if (place.lat !== undefined) {
      report.push(`  = ${place.ref}: już ma współrzędne`);
      continue;
    }
    const skip = skipReason(place);
    if (skip !== null) {
      report.push(`  - ${place.ref}: pominięte (${skip})`);
      continue;
    }
    let match: { hit: GeocodeHit; query: string } | null = null;
    for (const query of candidateQueries(place, ALIASES[slug]?.[place.ref])) {
      const hit = await lookup(query, countries);
      if (hit !== null && !tooCoarse(place.category, hit.category)) {
        match = { hit, query };
        break;
      }
    }
    if (match === null) report.push(`  ? ${place.ref}: nie znaleziono („${place.name}”)`);
    else found.set(place.ref, match);
  }

  // Trafienia w kraju domowym (lotnisko wylotu) nie liczą się do środka obszaru wyjazdu.
  const local = [...found.values()].filter(({ hit }) => tripCountries.includes(hit.countryCode));
  const center = medianPoint(local.map(({ hit }) => hit));
  const radius = RADIUS_KM[brief.location.kind] ?? 300;

  // Trafienie poza obszarem: drugie podejście tylko w prostokącie wokół środka wyjazdu.
  if (center !== null) {
    for (const [ref, match] of found) {
      const place = doc.places.find((each) => each.ref === ref)!;
      if (distanceKm(center, match.hit) <= radius || FAR_OK.has(place.category ?? '')) continue;
      for (const query of candidateQueries(place, ALIASES[slug]?.[place.ref])) {
        const hit = await lookup(query, countries, boxAround(center, radius));
        if (hit !== null && !tooCoarse(place.category, hit.category)) {
          found.set(ref, { hit, query: `${query} [w obszarze]` });
          break;
        }
      }
    }
  }

  let accepted = 0;
  doc.places = doc.places.map((place) => {
    const match = found.get(place.ref);
    if (match === undefined) return place;
    const away = center === null ? 0 : distanceKm(center, match.hit);
    // Kraj domowy tylko dla lotniska/miasta wylotu — „UNESCO” w Bieszczadach to pomyłka, nie dom.
    const home =
      match.hit.countryCode === HOME_COUNTRY && !tripCountries.includes(HOME_COUNTRY) && FAR_OK.has(place.category ?? '');
    const ok = home || (match.hit.countryCode !== HOME_COUNTRY || tripCountries.includes(HOME_COUNTRY)) && (away <= radius || FAR_OK.has(place.category ?? ''));
    report.push(
      `  ${ok ? '+' : '!'} ${place.ref}: ${match.hit.lat.toFixed(4)},${match.hit.lng.toFixed(4)} ` +
        `${home ? '(dom)' : `${Math.round(away)} km`} ← „${match.query}” → ${match.hit.displayName}`,
    );
    if (!ok) return place;
    accepted++;
    return withCoordinates(place, match.hit);
  });

  console.log(`\n${slug}: ${accepted}/${doc.places.length} z współrzędnymi (promień ${radius} km)`);
  console.log(report.sort().join('\n'));
  if (write) writeFileSync(planPath, JSON.stringify(doc, null, 2) + '\n');
}
