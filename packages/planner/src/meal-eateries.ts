import {
  distanceToRouteM,
  type Eatery,
  type EateryAnswer,
  type EateryKind,
  type EateryMemory,
  eaterySummary,
  mealRoute,
  mealSearchCenter,
  mealSlot,
  memoriesOf,
  memorySummary,
  metersBetween,
  openAtMeal,
  plainName,
  type PlaceMemoryRow,
  rankEateries,
  routeSearchArea,
  type SearchCenter,
  type TripDocument,
} from '@expeditionplan/core';
import { z } from 'zod';

import { type EateryDiet, type EaterySearch, MAX_RESULTS } from './restaurants.ts';
import { type WikivoyageListing, withTips } from './wikivoyage-eat.ts';

/**
 * „Knajpy w pobliżu” posiłku z planu — wspólne dla akcji webu i `POST /api/eateries` (telefon):
 * środek wyszukiwania (podany albo z planu: posiłek między dwoma punktami = droga między nimi,
 * `mealRoute`; inaczej `mealSearchCenter`), do 100 wyników z Geoapify (`search`), polecenia z Wikivoyage
 * (`tips`) i nasze oceny „warto / nie warto” (`memories`), godziny otwarcia w porze posiłku i opis do listy.
 * Kolejność: `rankEateries`; filtry (zamknięte, sieciówki, kuchnia, polecane) robi lista u klienta.
 */

export type MealEateriesDeps = {
  search: (query: EaterySearch) => Promise<Eatery[]>;
  /** Wpisy Wikivoyage wokół obszaru; błąd = wyniki bez poleceń. */
  tips?: (area: { lat: number; lng: number; radiusM: number }) => Promise<WikivoyageListing[]>;
  /** Widoczne dla mnie wiersze `place_memories` o tych kluczach nazw (`plainName` = `place_key`); błąd = bez ocen. */
  memories?: (keys: string[]) => Promise<PlaceMemoryRow[]>;
};

export type MealEateriesOptions = {
  kinds: EateryKind[];
  radiusM: number;
  diet?: EateryDiet;
  /** Środek spoza planu (wpisana okolica, pozycja telefonu); bez — miejsce posiłku albo dnia. */
  center?: SearchCenter;
};

const KINDS = new Set<EateryKind>(['restaurant', 'fast_food', 'cafe', 'pub', 'hut']);
const DIETS = new Set<EateryDiet>(['vegetarian', 'vegan', 'gluten_free', 'halal']);

/**
 * Ciało `POST /api/eateries` (telefon). Pozycja telefonu jest opcjonalna — wysyłana tylko po
 * „Szukaj wokół mnie” i zaokrąglona (SPECYFIKACJA §8); serwer bierze ją wyłącznie jako środek
 * tego jednego zapytania i nigdzie jej nie zapisuje.
 */
export const EateriesRequest = z.object({
  tripId: z.uuid(),
  itemRef: z.string().min(1).max(200),
  kinds: z.array(z.enum(['restaurant', 'fast_food', 'cafe', 'pub', 'hut'])).max(5),
  radiusM: z.number().int().min(200).max(5000),
  diet: z.enum(['vegetarian', 'vegan', 'gluten_free', 'halal']).optional(),
  position: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).optional(),
});
export type EateriesRequest = z.infer<typeof EateriesRequest>;

/** 3 miejsca po przecinku ≈ 100 m — tyle wystarczy do knajp w promieniu, a nie wskazuje dokładnie, gdzie jesteś. */
export const roundPosition = (position: { lat: number; lng: number }) => ({ lat: Math.round(position.lat * 1000) / 1000, lng: Math.round(position.lng * 1000) / 1000 });

/** Pozycja telefonu jako środek wyszukiwania (zaokrąglona jeszcze raz — na wypadek starszej aplikacji). */
export const positionCenter = (position: { lat: number; lng: number }): SearchCenter => ({ ...roundPosition(position), near: 'Twoja okolica' });

export const clampRadius = (radiusM: number) => Math.min(Math.max(Math.round(radiusM) || 1000, 200), 5000);

/** Oceny lokalu z naszych wyjazdów; brak, gdy nikt nic nie wpisał. */
function memoryOf(eatery: Eatery, rows: readonly PlaceMemoryRow[]): EateryMemory | undefined {
  const summary = memorySummary(memoriesOf({ name: eatery.name, at: [eatery.lng, eatery.lat] }, rows));
  const notes = summary.entries.flatMap((entry) => (entry.note ? [`${entry.author}: ${entry.note}`] : []));
  return summary.worth + summary.notWorth + notes.length === 0 ? undefined : { worth: summary.worth, notWorth: summary.notWorth, notes };
}

export async function eateriesForMeal(doc: TripDocument, itemRef: string, options: MealEateriesOptions, deps: MealEateriesDeps): Promise<EateryAnswer> {
  if (!doc.items.some((item) => item.ref === itemRef)) return { error: 'Tego posiłku już nie ma — odśwież plan.' };
  const route = options.center === undefined ? mealRoute(doc, itemRef) : null;
  const radiusM = clampRadius(options.radiusM);
  const area = route !== null ? routeSearchArea(route, radiusM) : (() => {
    const center = options.center ?? mealSearchCenter(doc, itemRef);
    return center === null ? null : { ...center, radiusM };
  })();
  if (area === null) return { error: 'Posiłek nie ma miejsca, a punkty dnia nie mają współrzędnych — podaj okolicę (np. ulicę albo zabytek) albo szukaj wokół siebie.' };
  const center: SearchCenter = { lat: area.lat, lng: area.lng, near: area.near };
  const kinds = options.kinds.filter((kind) => KINDS.has(kind));
  const diet = options.diet && DIETS.has(options.diet) ? options.diet : undefined;
  const onRoute = (point: { lat: number; lng: number }) => route === null || distanceToRouteM(route, point) <= radiusM;
  let found: Eatery[];
  let listings: WikivoyageListing[];
  try {
    [found, listings] = await Promise.all([
      deps.search({ lat: area.lat, lng: area.lng, radiusM: area.radiusM, kinds, ...(diet ? { diet } : {}), limit: MAX_RESULTS }),
      deps.tips === undefined ? Promise.resolve([]) : deps.tips(area).catch(() => []),
    ]);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  const tipped = withTips(
    found.filter(onRoute),
    listings.filter((listing) => listing.lat === undefined || listing.lng === undefined || onRoute({ lat: listing.lat, lng: listing.lng })),
    kinds,
    diet !== undefined,
  );
  const keys = [...new Set(tipped.eateries.map((eatery) => plainName(eatery.name)).filter((key) => key !== ''))];
  const rows = deps.memories === undefined || keys.length === 0 ? [] : await deps.memories(keys).catch(() => []);
  const slot = mealSlot(doc, itemRef);
  const results = tipped.eateries.map((eatery) => {
    const open = openAtMeal(eatery.openingHours, slot);
    const routeM = route === null ? undefined : distanceToRouteM(route, eatery);
    const memory = memoryOf(eatery, rows);
    return { ...eatery, distanceM: metersBetween(center, eatery), ...(routeM === undefined ? {} : { routeM }), open, summary: eaterySummary(eatery, center, open, routeM), ...(memory ? { memory } : {}) };
  });
  return { center, ...(route === null ? {} : { route: { from: route.from.near, to: route.to.near } }), results: rankEateries(results), tipSources: tipped.sources };
}
