import { type AiClient, type AiUsage, askStructured } from '@expeditionplan/ai';
import { LogisticsCandidates, type TripBrief, type TripDocument } from '@expeditionplan/core';
import { z } from 'zod';

import { SYSTEM } from './prompts.ts';

/**
 * Etap 4 — logistyka (SPECYFIKACJA §4): kandydaci do porównania — noclegi per baza, auto,
 * transfery, karnety — z widełkami ceny (szacunek), warunkami, plusami, minusami i rekomendacją.
 * Kod dokłada linki wyszukiwania (bez rezerwacji, W1), sprawdza limit km auta wobec tras planu
 * i zapisuje wybrane grupy w kształcie planów wzorcowych: grupa porównania (`scope: booking`)
 * z tabelą, wariant i rezerwacja-kandydat na każdą opcję.
 */

type Doc = TripDocument;
type Group = LogisticsCandidates['groups'][number];
type Candidate = Group['candidates'][number];

const schemaOf = (schema: z.ZodType) => JSON.stringify(z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }));
const CAR_MODES = new Set(['car', 'rental_car', 'taxi', 'hired_driver']);
/** Kupowane raz na wyjazd — drugiej grupy porównania nie potrzeba, gdy plan już je ma. */
const ONCE_PER_TRIP = new Set<string>(['car_rental', 'esim', 'insurance']);

/** Skład grupy do wyszukiwarek: dorośli od 18 lat, dzieci z wiekiem (bez wieku = dorosły). */
export function party(doc: Doc): { adults: number; children: number[] } {
  const children = doc.travelers.flatMap((each) => (each.age !== undefined && each.age < 18 ? [each.age] : []));
  return { adults: Math.max(1, doc.travelers.length - children.length), children };
}

/** Kilometry jazdy wynajętym autem z planu (trasy z mapy albo szacunki). */
export function rentalKm(doc: Doc): number {
  return Math.round(doc.items.filter((item) => item.leg?.mode === 'rental_car' && item.leg.distanceKm !== undefined).reduce((sum, item) => sum + item.leg!.distanceKm! * (item.leg!.roundTrip ? 2 : 1), 0));
}

export function logisticsContext(doc: Doc, brief: TripBrief | null) {
  const places = new Map(doc.places.map((place) => [place.ref, place.name]));
  return {
    title: doc.trip.title,
    dates: { start: doc.trip.startDate, end: doc.trip.endDate },
    currency: doc.trip.baseCurrency,
    budget: brief?.budget,
    party: party(doc),
    /** Gdzie śpimy po każdym dniu — z tego wynikają noclegi. */
    nights: doc.days.slice(0, -1).map((day) => ({ date: day.date, base: day.baseRef === undefined ? null : places.get(day.baseRef) ?? null })),
    driving: { modes: [...new Set(doc.items.flatMap((item) => (item.leg && CAR_MODES.has(item.leg.mode) ? [item.leg.mode] : [])))], rentalKm: rentalKm(doc) },
    flights: doc.items.filter((item) => item.leg?.mode === 'flight').map((item) => `${doc.days.find((day) => day.ref === item.dayRef)?.date ?? ''} ${item.title}`),
    /** Już kupione albo wybrane — tego nie proponuj ponownie. */
    settled: doc.bookings.filter((each) => ['to_book', 'booked', 'paid', 'not_required'].includes(each.status)).map((each) => ({ kind: each.kind, title: each.title, status: each.status })),
    existingCandidates: doc.variantGroups.filter((group) => group.scope === 'booking').map((group) => group.title),
  };
}

export function logisticsPrompt(doc: Doc, brief: TripBrief | null): string {
  return [
    'Etap 4 — logistyka: kandydaci do porównania dla rzeczy, które trzeba zarezerwować (noclegi, auto, transfer, karnety, eSIM, ubezpieczenie).',
    '',
    'Zasady:',
    '1. Grupa = jedna decyzja (np. „Nocleg w Marakeszu 26–27.12”, „Auto z lotniska Agadir”), 2–4 kandydatów, dokładnie jeden `recommended: true`.',
    '2. NIE wymyślaj nazw hoteli ani konkretnych ofert — nie znasz dostępności ani dzisiejszych cen. Kandydat to rodzaj oferty w obszarze („riad w medynie, pokój rodzinny ze śniadaniem” / „hotel w Gueliz z parkingiem”, „auto klasy mini z automatem u dużej sieci na lotnisku” / „lokalna wypożyczalnia”). Duże sieci wypożyczalni wolno nazwać.',
    '3. Ceny: realistyczne widełki dla tego sezonu i składu grupy (`party`), w walucie lokalnej albo EUR, jako szacunek; `priceBasis` mówi, za co (noc, dzień, grupa).',
    '4. `conditions`: co sprawdzić przed rezerwacją (darmowe odwołanie, kaucja, płatność kartą, limit km, godziny biura i zwrotu, parking, dojazd autem do medyny). Przy aucie wpisz `kmLimit`, jeśli taki jest typowy — kod porówna go z `driving.rentalKm`.',
    '5. `columns` i `values`: 2–5 kolumn tabeli porównania, wartości w tej samej kolejności co kolumny.',
    '6. `searchQuery`: krótka fraza do wyszukiwarki ofert (miejsce + rodzaj), np. „riad Marrakech medina family room”.',
    '7. Nie proponuj tego, co jest w `settled` albo `existingCandidates`. Noclegi wg `nights` (kolejne noce w tej samej bazie = jedna grupa).',
    '8. `advice`: 1–4 krótkie uwagi (np. co rezerwować najpierw). Wszystko po polsku.',
    '',
    'JSON Schema:',
    schemaOf(LogisticsCandidates),
    '',
    'Wyjazd:',
    JSON.stringify(logisticsContext(doc, brief), null, 1),
  ].join('\n');
}

/** Linki wyszukiwania ofert (W1: tylko szukamy, nie rezerwujemy). */
export function searchLinks(group: Group, candidate: Candidate, who: { adults: number; children: number[] }): { label: string; url: string }[] {
  const q = encodeURIComponent(candidate.searchQuery);
  if (group.kind === 'lodging') {
    const params = new URLSearchParams({ ss: candidate.searchQuery, group_adults: String(who.adults), group_children: String(who.children.length), no_rooms: '1' });
    if (group.start) params.set('checkin', group.start);
    if (group.end) params.set('checkout', group.end);
    const ages = who.children.map((age) => `age=${age}`).join('&');
    return [
      { label: 'Szukaj w Booking.com', url: `https://www.booking.com/searchresults.pl.html?${params.toString()}${ages ? `&${ages}` : ''}` },
      { label: 'Pokaż na mapie Google', url: `https://www.google.com/maps/search/?api=1&query=${q}` },
    ];
  }
  return [{ label: 'Szukaj ofert', url: `https://www.google.com/search?q=${q}` }];
}

export type LogisticsDraft = { info: LogisticsCandidates; checks: string[] };

/** Kontrole kodu: limit km auta wobec tras planu. */
export function logisticsChecks(doc: Doc, info: LogisticsCandidates): string[] {
  const km = rentalKm(doc);
  const days = Math.max(1, doc.days.length);
  return info.groups.flatMap((group) =>
    group.kind !== 'car_rental'
      ? []
      : group.candidates.flatMap((candidate) => {
          if (candidate.kmLimit === undefined || km === 0) return [];
          // Limit dzienny (do 500 km) liczony razy dni najmu; większy to limit na cały najem.
          const total = candidate.kmLimit <= 500 ? candidate.kmLimit * days : candidate.kmLimit;
          return km > total ? [`„${candidate.label}”: limit ${total} km, a plan ma ok. ${km} km jazdy wynajętym autem.`] : [];
        }),
  );
}

export async function logisticsCandidates(
  doc: Doc,
  brief: TripBrief | null,
  deps: { client: AiClient; timeoutMs?: number; onUsage?: (usage: AiUsage) => void },
): Promise<LogisticsDraft> {
  const answer = await askStructured(deps.client, LogisticsCandidates, logisticsPrompt(doc, brief), {
    system: SYSTEM,
    maxTokens: 16_000,
    timeoutMs: deps.timeoutMs ?? 120_000,
    label: `${doc.trip.title} etap 4`,
    ...(deps.onUsage ? { onUsage: deps.onUsage } : {}),
  });
  // Rzeczy kupowane raz na wyjazd, które plan już ma (kupione, wybrane albo w porównaniu) — model
  // potrafi je zaproponować mimo `settled`/`existingCandidates`, więc kod je odsiewa.
  const covered = new Set(doc.bookings.filter((each) => each.status !== 'idea' && each.status !== 'cancelled').map((each) => each.kind));
  const fresh = answer.data.groups.filter((group) => !(ONCE_PER_TRIP.has(group.kind) && covered.has(group.kind)));
  // Dokładnie jeden polecany w grupie — model bywa niekonsekwentny, kod to porządkuje.
  const groups = fresh.map((group) => {
    const first = Math.max(0, group.candidates.findIndex((candidate) => candidate.recommended));
    return { ...group, candidates: group.candidates.map((candidate, i) => ({ ...candidate, recommended: i === first })) };
  });
  const info = { ...answer.data, groups };
  return { info, checks: logisticsChecks(doc, info) };
}

export type LogisticsCreated =
  | { collection: 'variantGroups'; element: Doc['variantGroups'][number] }
  | { collection: 'variants'; element: Doc['variants'][number] }
  | { collection: 'bookings'; element: Doc['bookings'][number] };

/** Wybrane grupy → grupa porównania + wariant i rezerwacja-kandydat na opcję (kolejność zapisu: grupa, warianty, rezerwacje). */
export function mergeLogistics(doc: Doc, info: LogisticsCandidates, groupIndexes: number[], newId: () => string): { doc: Doc; created: LogisticsCreated[] } {
  const ref = () => `id-${newId()}`;
  const who = party(doc);
  const groups: LogisticsCreated[] = [];
  const variants: LogisticsCreated[] = [];
  const bookings: LogisticsCreated[] = [];
  for (const index of groupIndexes) {
    const group = info.groups[index];
    if (group === undefined) continue;
    const groupRef = ref();
    const rows: { variantRef: string; values: string[] }[] = [];
    for (const candidate of group.candidates) {
      const variantRef = ref();
      rows.push({ variantRef, values: group.columns.map((_, i) => candidate.values[i] ?? '—') });
      variants.push({
        collection: 'variants',
        element: { ref: variantRef, groupRef, label: candidate.label, ...(candidate.summary ? { summary: candidate.summary } : {}), recommended: candidate.recommended, pros: candidate.pros, cons: candidate.cons, excludesRefs: [] },
      });
      const when = (date: string | undefined) => (date === undefined ? undefined : { date, precision: 'exact' as const, tz: doc.trip.primaryTz });
      bookings.push({
        collection: 'bookings',
        element: {
          ref: ref(),
          kind: group.kind,
          status: 'candidate',
          variantGroupRef: groupRef,
          variantRef,
          recommended: candidate.recommended,
          title: candidate.label,
          ...(when(group.start) ? { start: when(group.start)! } : {}),
          ...(when(group.end) ? { end: when(group.end)! } : {}),
          price: { currency: candidate.currency, basis: candidate.priceBasis, minMinor: Math.min(candidate.priceMinMinor, candidate.priceMaxMinor), maxMinor: Math.max(candidate.priceMinMinor, candidate.priceMaxMinor), from: false, approx: true, note: 'szacunek AI — sprawdź w ofercie' },
          ...(candidate.refundable !== undefined ? { refundable: candidate.refundable } : {}),
          ...(group.kind === 'car_rental' && candidate.kmLimit ? { car: { kmLimit: candidate.kmLimit } } : {}),
          includes: candidate.includes,
          addons: [],
          pros: candidate.pros,
          cons: candidate.cons,
          links: searchLinks(group, candidate, who),
          notes: candidate.conditions.map((condition) => `Sprawdź: ${condition}`),
        },
      });
    }
    groups.push({
      collection: 'variantGroups',
      element: { ref: groupRef, scope: 'booking', title: group.title, conditionKind: 'availability', ...(group.mustHave ? { conditionText: group.mustHave } : {}), comparison: { columns: group.columns, rows } },
    });
  }
  const created = [...groups, ...variants, ...bookings];
  const of = (collection: LogisticsCreated['collection']) => created.filter((entry) => entry.collection === collection).map((entry) => entry.element);
  return {
    doc: {
      ...doc,
      variantGroups: [...doc.variantGroups, ...(of('variantGroups') as Doc['variantGroups'])],
      variants: [...doc.variants, ...(of('variants') as Doc['variants'])],
      bookings: [...doc.bookings, ...(of('bookings') as Doc['bookings'])],
    },
    created,
  };
}
