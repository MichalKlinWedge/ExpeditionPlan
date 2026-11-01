import {
  checkReferences,
  StagePlan,
  type TripBrief,
  TripDocument,
  type TripDocumentInput,
  TripDocumentShape,
} from '@expeditionplan/core';
import { z } from 'zod';

/**
 * Brief + wyniki etapu 2 → `TripDocument`. Wyjazd i uczestników składa kod (z briefu, z wiekami
 * — od nich zależą ceny), a AI dostarcza dni, punkty, miejsca, warianty i ograniczenia.
 */

export function tripContext(brief: TripBrief, primaryTz: string): Pick<TripDocumentInput, 'schemaVersion' | 'trip' | 'travelers'> {
  if (brief.dates.kind !== 'fixed') throw new Error('PoC-1 obsługuje tylko briefy ze stałymi datami.');
  return {
    schemaVersion: 1,
    trip: {
      title: brief.title,
      goal: brief.goal,
      startDate: brief.dates.start,
      endDate: brief.dates.end,
      primaryTz,
      homeTz: brief.homeTz,
      baseCurrency: brief.budget.currency,
    },
    travelers: brief.travelers.map((traveler, index) => ({
      ref: `t${index + 1}`,
      name: traveler.name,
      ...(traveler.age === undefined ? {} : { age: traveler.age }),
      ...(traveler.household === undefined ? {} : { household: traveler.household }),
      ...(traveler.isDriver === undefined ? {} : { isDriver: traveler.isDriver }),
    })),
  };
}

export type Chunk = { index: number; dates: string[]; dayRefs: string[]; refPrefix: string };

/**
 * Schemat odpowiedzi etapu 2 dla jednej części wyjazdu: kształt `StagePlan` plus spójność
 * odwołań w złożonym dokumencie, właściwe dni i przedrostek `ref` (części składamy w jeden plan).
 * Błędy wracają do modelu w jedynej próbie naprawy.
 */
export function stagePlanSchema(context: ReturnType<typeof tripContext>, chunk: Chunk): z.ZodType<StagePlan> {
  return z.preprocess((value) => withPlainDayRefs(withoutBookingRefs(value), chunk), StagePlan).superRefine((plan, ctx) => {
    const shape = TripDocumentShape.safeParse({ ...context, ...plan });
    if (shape.success) {
      for (const problem of checkReferences(shape.data)) ctx.addIssue({ code: 'custom', path: problem.path, message: problem.message });
    }
    const expected = new Map(chunk.dayRefs.map((ref, i) => [ref, chunk.dates[i]]));
    plan.days.forEach((day, i) => {
      if (expected.get(day.ref) !== day.date) {
        ctx.addIssue({ code: 'custom', path: ['days', i], message: `Dozwolone dni: ${[...expected].map(([r, d]) => `${r}=${d}`).join(', ')}.` });
      }
    });
    const collections = ['places', 'items', 'variantGroups', 'variants'] as const;
    for (const collection of collections) {
      plan[collection].forEach((entry, i) => {
        if (!entry.ref.startsWith(chunk.refPrefix)) {
          ctx.addIssue({ code: 'custom', path: [collection, i, 'ref'], message: `ref musi zaczynać się od „${chunk.refPrefix}”.` });
        }
      });
    }
  }) as unknown as z.ZodType<StagePlan>;
}

/**
 * Etap 2 nie ma rezerwacji (to etap 4), więc odwołania do nich zawsze wiszą w powietrzu —
 * usuwamy je, zamiast marnować jedyną próbę naprawy.
 */
function withoutBookingRefs(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value;
  const plan = value as { days?: Record<string, unknown>[]; items?: (Record<string, unknown> & { leg?: Record<string, unknown> })[] };
  return {
    ...plan,
    days: plan.days?.map(({ lodgingRef: _lodging, ...day }) => day),
    items: plan.items?.map(({ bookingRef: _booking, ...item }) =>
      item.leg === undefined ? item : { ...item, leg: Object.fromEntries(Object.entries(item.leg).filter(([key]) => key !== 'ticketBookingRef')) },
    ),
  };
}

/**
 * Model dokleja przedrostek części także do dni („c3-d5”), choć dni mają stałe `ref` z polecenia.
 * Zdejmujemy go z dni i z `dayRef` punktów — to pomyłka formalna, nie merytoryczna.
 */
function withPlainDayRefs(value: unknown, chunk: Chunk): unknown {
  if (chunk.refPrefix === '' || typeof value !== 'object' || value === null) return value;
  const plain = (ref: unknown) =>
    typeof ref === 'string' && ref.startsWith(chunk.refPrefix) && chunk.dayRefs.includes(ref.slice(chunk.refPrefix.length))
      ? ref.slice(chunk.refPrefix.length)
      : ref;
  const plan = value as { days?: Record<string, unknown>[]; items?: Record<string, unknown>[]; constraints?: Record<string, unknown>[]; variantGroups?: Record<string, unknown>[] };
  const fix = (entries: Record<string, unknown>[] | undefined, key: string) => entries?.map((entry) => (key in entry ? { ...entry, [key]: plain(entry[key]) } : entry));
  return {
    ...plan,
    days: fix(plan.days, 'ref'),
    items: fix(plan.items, 'dayRef'),
    constraints: fix(plan.constraints, 'dayRef'),
    variantGroups: fix(plan.variantGroups, 'dayRef'),
  };
}

/** Części etapu 2: krótkie wyjazdy w całości, dłuższe po `size` dni (równolegle). */
export function chunksFor(dates: string[], size = 4): Chunk[] {
  const single = dates.length <= size;
  const parts = single ? [dates] : Array.from({ length: Math.ceil(dates.length / size) }, (_, i) => dates.slice(i * size, i * size + size));
  let offset = 0;
  return parts.map((part, index) => {
    const chunk = { index, dates: part, dayRefs: part.map((_, i) => `d${offset + i + 1}`), refPrefix: single ? '' : `c${index + 1}-` };
    offset += part.length;
    return chunk;
  });
}

export function assemble(context: ReturnType<typeof tripContext>, plans: StagePlan[]): TripDocument {
  const merged = {
    places: plans.flatMap((plan) => plan.places),
    days: plans.flatMap((plan) => plan.days),
    items: plans.flatMap((plan) => plan.items),
    variantGroups: plans.flatMap((plan) => plan.variantGroups),
    variants: plans.flatMap((plan) => plan.variants),
    constraints: plans.flatMap((plan) => plan.constraints),
    notes: plans.flatMap((plan) => plan.notes),
  };
  return TripDocument.parse({ ...context, ...merged });
}

/** Lista dni wyjazdu od startu do końca włącznie. */
export function tripDates(start: string, end: string): string[] {
  const dates: string[] = [];
  for (let day = new Date(`${start}T00:00:00Z`); day <= new Date(`${end}T00:00:00Z`); day.setUTCDate(day.getUTCDate() + 1)) {
    dates.push(day.toISOString().slice(0, 10));
  }
  return dates;
}
