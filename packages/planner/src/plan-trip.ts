import { type AiClient, type AiUsage, AiValidationError, askStructured } from '@expeditionplan/ai';
import { type StagePlan, type TripBrief, TripDocument, TripSkeleton } from '@expeditionplan/core';

import { assemble, chunksFor, stagePlanSchema, tripContext, tripDates } from './assemble.ts';
import { COUNTRY_TZ, type DayFact, dayFact, type Holiday } from './facts.ts';
import { type GroundResult, groundPlaces, type Lookup, withCoordinates } from './ground.ts';
import { applyPins } from './pins.ts';
import { stage1Prompt, stage2Prompt, SYSTEM } from './prompts.ts';

/**
 * Łańcuch „Zaplanuj z AI” (SPECYFIKACJA §4): brief → etap 1 (warianty układu) → bazy w OSM i fakty
 * dni (słońce, święta, zmiana czasu) → etap 2 (dni, punkty, pula, ograniczenia; części równolegle)
 * → pinezki z briefu → ugruntowanie miejsc (współrzędne, godziny otwarcia) → `TripDocument`.
 * Czyste TS: dostawca AI, źródło miejsc i święta przychodzą z zewnątrz (aplikacja, narzędzie PoC).
 */

export type PlannerDeps = {
  client: AiClient;
  lookup: Lookup;
  /** Drugie źródło miejsc dla nieznalezionych (narzędzia: Photon). */
  fallback?: Lookup;
  holidays: (country: string, year: number) => Promise<Holiday[]>;
  /** Strefa wyjazdu; domyślnie z `COUNTRY_TZ` dla pierwszego kraju briefu. */
  primaryTz?: string;
  /** Dni na jedno zapytanie etapu 2 (części idą równolegle). */
  chunkDays?: number;
  timeoutMs?: number;
  onUsage?: (usage: AiUsage) => void;
  /** Postęp do logu albo interfejsu: „etap 1”, „bazy”, „etap 2”, „miejsca”. */
  onStep?: (step: string) => void;
};

export type PlannedTrip = {
  doc: TripDocument;
  skeleton: TripSkeleton;
  stagePlans: StagePlan[];
  facts: DayFact[];
  grounding: GroundResult[];
  /** Ile razy model poprawiał odpowiedź po walidacji. */
  repairs: number;
  aiMs: number;
  groundMs: number;
};

export class PlannerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlannerError';
  }
}

/**
 * Jedna świeża próba po odpowiedzi, której model nie naprawił (askStructured ma jedną naprawę).
 * Gemini Flash-Lite potrafi raz na kilka przebiegów oddać JSON niezgodny ze schematem dwa razy
 * z rzędu; nowe zapytanie zwykle przechodzi. Inne błędy (sieć, klucz, limit) idą wyżej od razu.
 */
async function freshRetry<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!(error instanceof AiValidationError)) throw error;
    return run();
  }
}

export async function planTrip(brief: TripBrief, deps: PlannerDeps): Promise<PlannedTrip> {
  if (brief.dates.kind !== 'fixed') throw new PlannerError('AI planuje na razie tylko wyjazdy ze stałymi datami.');
  const country = brief.location.countries[0];
  if (country === undefined) throw new PlannerError('Brief nie podaje kraju wyjazdu.');
  const tz = deps.primaryTz ?? COUNTRY_TZ[country];
  if (tz === undefined) throw new PlannerError(`Brak strefy czasowej dla kraju ${country}.`);
  const ask = { system: SYSTEM, timeoutMs: deps.timeoutMs ?? 300_000, ...(deps.onUsage ? { onUsage: deps.onUsage } : {}) };
  const step = deps.onStep ?? (() => undefined);

  step('etap 1');
  let started = performance.now();
  const skeleton = await freshRetry(() =>
    askStructured(deps.client, TripSkeleton, stage1Prompt(brief), { ...ask, maxTokens: 12_000, label: `${brief.title} etap 1` }),
  );
  const variant = skeleton.data.variants.find((each) => each.recommended) ?? skeleton.data.variants[0]!;
  let aiMs = performance.now() - started;

  // Fakty dni: bazy w OSM → słońce; święta (błąd usługi nie zatrzymuje planu); zmiana czasu.
  step('bazy');
  started = performance.now();
  const bases = skeleton.data.bases.map((base, i) => ({ ref: `base-${i}`, name: base.name, searchName: base.searchName, category: 'town' }));
  const baseHits = await groundPlaces(bases, { countries: brief.location.countries, kind: brief.location.kind, lookup: deps.lookup });
  const baseCoords = new Map(
    bases.flatMap((base, i) => {
      const hit = baseHits[i]!;
      return hit.status === 'found' ? [[base.name, { lat: hit.hit.lat, lng: hit.hit.lng }] as const] : [];
    }),
  );
  const dates = tripDates(brief.dates.start, brief.dates.end);
  const years = [...new Set(dates.map((date) => Number(date.slice(0, 4))))];
  const allHolidays = (await Promise.all(years.map((year) => deps.holidays(country, year).catch(() => [] as Holiday[])))).flat();
  const facts = dates.map((date) => {
    const day = variant.days.find((each) => each.date === date) ?? { date, base: variant.days.at(-1)!.base };
    return dayFact(day, tz, baseCoords.get(day.base), allHolidays.filter((holiday) => holiday.date === date));
  });
  let groundMs = performance.now() - started;

  step('etap 2');
  const context = tripContext(brief, tz);
  const chunks = chunksFor(dates, deps.chunkDays ?? 2);
  started = performance.now();
  const answers = await Promise.all(
    chunks.map((chunk) =>
      freshRetry(() =>
        askStructured(
          deps.client,
          stagePlanSchema(context, chunk),
          stage2Prompt(brief, variant, chunk, facts.filter((fact) => chunk.dates.includes(fact.date)), dates.length),
          { ...ask, maxTokens: 32_000, label: `${brief.title} etap 2 część ${chunk.index + 1}` },
        ),
      ),
    ),
  );
  aiMs += performance.now() - started;
  const stagePlans = answers.map((answer) => answer.data);

  // Pinezki z briefu mają pierwszeństwo; geokoder uzupełnia resztę (środek obszaru liczy ze wszystkich).
  step('miejsca');
  started = performance.now();
  let doc = applyPins(assemble(context, stagePlans), brief.location.pins);
  const grounding = await groundPlaces(doc.places, {
    countries: brief.location.countries,
    kind: brief.location.kind,
    lookup: deps.lookup,
    ...(deps.fallback ? { fallback: deps.fallback } : {}),
  });
  doc = TripDocument.parse({
    ...doc,
    places: doc.places.map((place, i) => {
      const result = grounding[i]!;
      return result.status === 'found' && place.lat === undefined ? withCoordinates(place, result.hit, { openingHours: true }) : place;
    }),
  });
  groundMs += performance.now() - started;

  return {
    doc,
    skeleton: skeleton.data,
    stagePlans,
    facts,
    grounding,
    repairs: skeleton.attempts - 1 + answers.reduce((sum, answer) => sum + answer.attempts - 1, 0),
    aiMs,
    groundMs,
  };
}
