import { type Eatery, type EateryKind, eaterySummary, mealSearchCenter, mealSlot, metersBetween, type OpenAtMeal, openAtMeal, type SearchCenter, type TripDocument } from '@expeditionplan/core';
import { z } from 'zod';

import type { EateryDiet, EaterySearch } from './restaurants.ts';

/**
 * „Knajpy w pobliżu” posiłku z planu — wspólne dla akcji webu i `POST /api/eateries` (telefon):
 * środek wyszukiwania (podany albo z planu, `mealSearchCenter`), jedno zapytanie do Geoapify
 * (`search`), godziny otwarcia w porze posiłku i opis do listy. Otwarte najpierw, potem najbliższe.
 */

export type EateryResult = Eatery & { distanceM: number; open: OpenAtMeal; summary: string };
export type EateryAnswer = { error: string } | { center: SearchCenter; results: EateryResult[] };

export type MealEateriesOptions = {
  kinds: EateryKind[];
  radiusM: number;
  diet?: EateryDiet;
  /** Środek spoza planu (wpisana okolica, pozycja telefonu); bez — miejsce posiłku albo dnia. */
  center?: SearchCenter;
};

const KINDS = new Set<EateryKind>(['restaurant', 'fast_food', 'cafe', 'pub', 'hut']);
const DIETS = new Set<EateryDiet>(['vegetarian', 'vegan', 'gluten_free', 'halal']);
const OPEN_FIRST = { open: 0, partly: 1, unknown: 2, closed: 3 } as const;

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

export async function eateriesForMeal(doc: TripDocument, itemRef: string, options: MealEateriesOptions, search: (query: EaterySearch) => Promise<Eatery[]>): Promise<EateryAnswer> {
  if (!doc.items.some((item) => item.ref === itemRef)) return { error: 'Tego posiłku już nie ma — odśwież plan.' };
  const center = options.center ?? mealSearchCenter(doc, itemRef);
  if (center === null) return { error: 'Posiłek nie ma miejsca, a punkty dnia nie mają współrzędnych — podaj okolicę (np. ulicę albo zabytek) albo szukaj wokół siebie.' };
  const kinds = options.kinds.filter((kind) => KINDS.has(kind));
  let found: Eatery[];
  try {
    found = await search({ lat: center.lat, lng: center.lng, radiusM: clampRadius(options.radiusM), kinds, ...(options.diet && DIETS.has(options.diet) ? { diet: options.diet } : {}) });
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  const slot = mealSlot(doc, itemRef);
  const results = found
    .map((eatery) => {
      const open = openAtMeal(eatery.openingHours, slot);
      return { ...eatery, distanceM: metersBetween(center, eatery), open, summary: eaterySummary(eatery, center, open) };
    })
    .sort((a, b) => OPEN_FIRST[a.open.state] - OPEN_FIRST[b.open.state] || a.distanceM - b.distanceM);
  return { center, results };
}
