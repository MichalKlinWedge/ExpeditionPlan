import { minutesOutside, openingOn, parseOpeningHours, formatInterval } from './engine/opening-hours.ts';
import { activeVariants, scheduleDay } from './engine/schedule.ts';
import { minutesOfDay } from './engine/time.ts';
import { distanceKm } from './offline-areas.ts';
import { dayItems } from './plan-edits.ts';
import type { TripDocument } from './schemas/trip-document.ts';
import { keyBetween } from './sort-key.ts';

/**
 * Jedzenie na mieście: knajpy w pobliżu posiłku z planu (Geoapify Places, dane OSM — wyniki wolno
 * przechowywać, docs/USLUGI.md). Szukamy wokół miejsca posiłku, a bez niego wokół najbliższego
 * punktu dnia ze współrzędnymi albo bazy dnia. Jedna wybrana knajpa = miejsce posiłku; kilka =
 * grupa wariantów „gdzie jemy” — każda knajpa to kopia posiłku w swoim wariancie, a wybiera się
 * ją na telefonie (chipy nad dniem, offline) albo w planie.
 */

type Doc = TripDocument;
type Item = Doc['items'][number];
type Place = Doc['places'][number];
type Variant = Doc['variants'][number];
type Group = Doc['variantGroups'][number];

export type EateryKind = 'restaurant' | 'fast_food' | 'cafe' | 'pub' | 'hut';

/** Knajpa z wyszukiwania (Geoapify Places → `planner/src/restaurants.ts`). */
export type Eatery = {
  name: string;
  lat: number;
  lng: number;
  kind: EateryKind;
  address?: string;
  /** Kuchnia z OSM („pizza;italian”). */
  cuisine?: string;
  openingHours?: string;
  website?: string;
  phone?: string;
  osm?: { type: string; id: number };
  /** `diet:vegetarian` / `diet:vegan` z OSM: „yes” albo „only”. */
  vegetarian?: boolean;
  vegan?: boolean;
};

export const EATERY_KINDS: Record<EateryKind, string> = { restaurant: 'restauracja', fast_food: 'szybkie jedzenie', cafe: 'kawiarnia', pub: 'pub / bar', hut: 'schronisko' };

const CUISINE: Record<string, string> = {
  regional: 'regionalna', local: 'lokalna', italian: 'włoska', pizza: 'pizza', burger: 'burgery', kebab: 'kebab', chinese: 'chińska', japanese: 'japońska',
  sushi: 'sushi', thai: 'tajska', indian: 'indyjska', vietnamese: 'wietnamska', mexican: 'meksykańska', french: 'francuska', spanish: 'hiszpańska',
  tapas: 'tapas', greek: 'grecka', turkish: 'turecka', georgian: 'gruzińska', moroccan: 'marokańska', croatian: 'chorwacka', polish: 'polska',
  balkan: 'bałkańska', mediterranean: 'śródziemnomorska', seafood: 'owoce morza', fish: 'ryby', steak_house: 'steki', grill: 'grill',
  barbecue: 'grill', vegetarian: 'wegetariańska', vegan: 'wegańska', sandwich: 'kanapki', coffee_shop: 'kawa', cake: 'ciasta', ice_cream: 'lody',
  chicken: 'kurczak', asian: 'azjatycka', arab: 'arabska', lebanese: 'libańska', african: 'afrykańska', pasta: 'makarony', noodle: 'makarony', international: 'międzynarodowa', breakfast: 'śniadania', crepe: 'naleśniki', bakery: 'piekarnia',
};

/** „pizza;italian” → „pizza, włoska”. */
export const cuisineLabel = (cuisine: string | undefined) =>
  cuisine === undefined
    ? undefined
    : cuisine
        .split(/[;,]/)
        .map((each) => each.trim().toLowerCase())
        .filter((each) => each !== '')
        .map((each) => CUISINE[each] ?? each.replaceAll('_', ' '))
        .join(', ') || undefined;

const located = (place: Place | undefined): place is Place & { lat: number; lng: number } => place?.lat !== undefined && place.lng !== undefined;

/** Miejsce punktu na mapie: przejazd — cel, reszta — `placeRef`. */
function placeOf(doc: Doc, item: Item): Place | undefined {
  const ref = item.kind === 'transport' ? (item.leg?.toPlaceRef ?? item.placeRef) : item.placeRef;
  return ref === undefined ? undefined : doc.places.find((place) => place.ref === ref);
}

export type SearchCenter = { lat: number; lng: number; /** Skąd środek: nazwa miejsca. */ near: string };

/**
 * Gdzie szukać knajp dla posiłku: jego miejsce ze współrzędnymi, potem najbliższy wcześniejszy punkt
 * dnia (tam będziecie), potem najbliższy późniejszy, potem baza dnia. `null` = trzeba podać okolicę.
 */
export function mealSearchCenter(doc: Doc, itemRef: string): SearchCenter | null {
  const item = doc.items.find((each) => each.ref === itemRef);
  if (item === undefined) return null;
  const at = (place: Place | undefined) => (located(place) ? { lat: place.lat, lng: place.lng, near: place.name } : null);
  const own = at(placeOf(doc, item));
  if (own !== null) return own;
  if (item.dayRef === undefined) return null;
  const day = dayItems(doc, item.dayRef);
  const index = day.findIndex((each) => each.ref === itemRef);
  // Inne posiłki (np. kopie w wariantach) nie są punktem odniesienia.
  const before = day.slice(0, index).reverse().filter((each) => each.kind !== 'meal');
  const after = day.slice(index + 1).filter((each) => each.kind !== 'meal');
  for (const each of [...before, ...after]) {
    const found = at(placeOf(doc, each));
    if (found !== null) return found;
  }
  const base = doc.days.find((each) => each.ref === item.dayRef)?.baseRef;
  return at(base === undefined ? undefined : doc.places.find((place) => place.ref === base));
}

/** Kiedy jest posiłek: data, początek i koniec w minutach od północy (z harmonogramu dnia, inaczej z godziny planu). */
export function mealSlot(doc: Doc, itemRef: string): { date: string; start: number; end: number } | null {
  const item = doc.items.find((each) => each.ref === itemRef);
  const day = item?.dayRef === undefined ? undefined : doc.days.find((each) => each.ref === item.dayRef);
  if (item === undefined || day === undefined) return null;
  const duration = item.durationMin ?? 60;
  try {
    const scheduled = scheduleDay(doc, day.ref).items.find((each) => each.ref === itemRef);
    if (scheduled !== undefined) {
      const start = minutesOfDay(scheduled.startLocal);
      // Posiłek bez czasu trwania liczy się w planie jako chwila — do godzin otwarcia przyjmujemy godzinę.
      return { date: day.date, start, end: start + (scheduled.durationMin || duration) };
    }
  } catch {
    // Dzień, którego silnik nie policzy — zostaje godzina z planu.
  }
  if (item.time === undefined || !('start' in item.time)) return null;
  const start = minutesOfDay(item.time.start);
  return { date: day.date, start, end: start + duration };
}

export type OpenAtMeal = { state: 'open' | 'closed' | 'partly' | 'unknown'; hours?: string };

/** Czy knajpa jest otwarta w porze posiłku — z `opening_hours` OSM (bez godzin = nie wiadomo). */
export function openAtMeal(openingHours: string | undefined, slot: { date: string; start: number; end: number } | null): OpenAtMeal {
  const parsed = parseOpeningHours(openingHours);
  if (parsed === null || slot === null) return { state: 'unknown' };
  const opening = openingOn(parsed, slot.date);
  const hours = opening.intervals.map(formatInterval).join(', ');
  if (opening.intervals.length === 0) return { state: 'closed', hours: 'zamknięte' };
  const outside = minutesOutside(opening, slot.start, slot.end);
  return { state: outside === 0 ? 'open' : outside >= slot.end - slot.start ? 'closed' : 'partly', hours };
}

export const metersBetween = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => Math.round(distanceKm(a, b) * 1000);

export const formatDistance = (meters: number) => (meters < 1000 ? `${Math.round(meters / 10) * 10} m` : `${(meters / 1000).toFixed(1).replace('.', ',')} km`);

/** Opis knajpy do wariantu i listy: „pizza, włoska · 350 m · 12:00–23:00”. */
export function eaterySummary(eatery: Eatery, center: { lat: number; lng: number } | null, open?: OpenAtMeal): string {
  return [
    // OSM zwykle nie mówi, czy schronisko wydaje posiłki.
    cuisineLabel(eatery.cuisine) ?? (eatery.kind === 'hut' ? 'schronisko (posiłki do sprawdzenia)' : EATERY_KINDS[eatery.kind]),
    eatery.vegan ? 'wegańskie' : eatery.vegetarian ? 'wege' : undefined,
    center === null ? undefined : formatDistance(metersBetween(center, eatery)),
    open?.hours,
  ]
    .filter((each) => each !== undefined && each !== '')
    .join(' · ');
}

const validUrl = (url: string | undefined) => {
  if (url === undefined) return undefined;
  const full = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  try {
    return new URL(full).protocol.startsWith('http') ? full : undefined;
  } catch {
    return undefined;
  }
};

/** Knajpa jako miejsce planu (`provider: geoapify`), z linkiem do OSM. */
export function eateryPlace(eatery: Eatery, ref: string): Place {
  const website = validUrl(eatery.website);
  const cuisine = cuisineLabel(eatery.cuisine);
  return {
    ref,
    name: eatery.name,
    category: eatery.kind === 'restaurant' ? 'restaurant' : eatery.kind,
    lat: Math.round(eatery.lat * 1e5) / 1e5,
    lng: Math.round(eatery.lng * 1e5) / 1e5,
    provider: 'geoapify',
    ...(eatery.address ? { address: eatery.address } : {}),
    ...(eatery.openingHours ? { openingHours: eatery.openingHours } : {}),
    ...(website ? { website } : {}),
    links: eatery.osm ? [{ label: 'OpenStreetMap', url: `https://www.openstreetmap.org/${eatery.osm.type}/${eatery.osm.id}` }] : [],
    ...(cuisine || eatery.phone ? { notes: [cuisine ? `Kuchnia: ${cuisine}` : '', eatery.phone ? `Tel. ${eatery.phone}` : ''].filter(Boolean).join('. ') } : {}),
  };
}

/** Grupa „gdzie jemy” posiłku (jeśli już jest): wariant, w którym posiłek występuje. */
export function eatOutGroup(doc: Doc, itemRef: string): Group | undefined {
  const item = doc.items.find((each) => each.ref === itemRef);
  const variant = doc.variants.find((each) => item?.variantRefs.includes(each.ref));
  const group = variant === undefined ? undefined : doc.variantGroups.find((each) => each.ref === variant.groupRef);
  return group?.scope === 'item' && group.conditionKind === 'choice' ? group : undefined;
}

export type EatOutOption = { variantRef: string; itemRef: string; label: string; summary?: string; place?: string; active: boolean };

/** Knajpy do wyboru przy posiłku (z grupy „gdzie jemy”), z zaznaczeniem tej, która jest teraz w planie. */
export function eatOutOptions(doc: Doc, itemRef: string): EatOutOption[] {
  const group = eatOutGroup(doc, itemRef);
  if (group === undefined) return [];
  const active = activeVariants(doc);
  return doc.variants
    .filter((variant) => variant.groupRef === group.ref)
    .map((variant) => {
      const item = doc.items.find((each) => each.variantRefs.includes(variant.ref));
      const place = item?.placeRef === undefined ? undefined : doc.places.find((each) => each.ref === item.placeRef)?.name;
      return { variantRef: variant.ref, itemRef: item?.ref ?? '', label: variant.label, ...(variant.summary ? { summary: variant.summary } : {}), ...(place ? { place } : {}), active: active.has(variant.ref) };
    });
}

/** Elementy do zapisu, w kolejności kluczy obcych: miejsca → grupa → warianty → punkty. */
export type EatOutWrite =
  | { collection: 'places'; element: Place; op: 'insert' }
  | { collection: 'variantGroups'; element: Group; op: 'insert' | 'update' }
  | { collection: 'variants'; element: Variant; op: 'insert' }
  | { collection: 'items'; element: Item; op: 'insert' | 'update' };

export type EatOutEdit = { doc: Doc; writes: EatOutWrite[] };

/**
 * Zapis wybranych knajp przy posiłku. Jedna (a posiłek nie ma jeszcze wyboru) → nowe miejsce
 * posiłku. Kilka → grupa „<posiłek> — gdzie jemy?”: posiłek dostaje pierwszą knajpę i jej wariant
 * (polecany), każda kolejna to kopia posiłku w swoim wariancie, zaraz za nim w kolejności dnia.
 * Gdy grupa już jest, nowe knajpy dochodzą do niej. `newRef` daje klucze `id-<uuid>`.
 */
export function addEatOutChoices(doc: Doc, itemRef: string, picks: { eatery: Eatery; summary?: string }[], newRef: () => string): EatOutEdit | null {
  const meal = doc.items.find((each) => each.ref === itemRef);
  if (meal === undefined || meal.dayRef === undefined || picks.length === 0) return null;
  const places = picks.map(({ eatery }) => eateryPlace(eatery, newRef()));
  const writes: EatOutWrite[] = places.map((place) => ({ collection: 'places', element: place, op: 'insert' }));
  let group = eatOutGroup(doc, itemRef);

  if (group === undefined && picks.length === 1) {
    const updated: Item = { ...meal, placeRef: places[0]!.ref };
    writes.push({ collection: 'items', element: updated, op: 'update' });
    return { doc: { ...doc, places: [...doc.places, ...places], items: doc.items.map((each) => (each.ref === itemRef ? updated : each)) }, writes };
  }

  const variants: Variant[] = [];
  const items: Item[] = [];
  const updates: Item[] = [];
  let pending = places.map((place, index) => ({ place, summary: picks[index]!.summary }));
  if (group === undefined) {
    group = { ref: newRef(), scope: 'item', dayRef: meal.dayRef, title: `${meal.title} — gdzie jemy?`, conditionKind: 'choice' };
    writes.push({ collection: 'variantGroups', element: group, op: 'insert' });
    const first = pending[0]!;
    const variant: Variant = { ref: newRef(), groupRef: group.ref, label: first.place.name, ...(first.summary ? { summary: first.summary } : {}), recommended: true, pros: [], cons: [], excludesRefs: [] };
    variants.push(variant);
    updates.push({ ...meal, placeRef: first.place.ref, variantRefs: [variant.ref] });
    pending = pending.slice(1);
  }
  // Kopie za ostatnią opcją tej grupy, przed następnym punktem dnia.
  const groupRef = group.ref;
  const optionRefs = new Set([...doc.variants.filter((each) => each.groupRef === groupRef).map((each) => each.ref), ...variants.map((each) => each.ref)]);
  const day = dayItems(doc, meal.dayRef);
  const last = [...day].reverse().find((each) => each.ref === itemRef || each.variantRefs.some((ref) => optionRefs.has(ref)))!;
  const next = day[day.indexOf(last) + 1];
  let key = last.sortKey;
  for (const { place, summary } of pending) {
    const variant: Variant = { ref: newRef(), groupRef, label: place.name, ...(summary ? { summary } : {}), pros: [], cons: [], excludesRefs: [] };
    variants.push(variant);
    key = keyBetween(key, next?.sortKey);
    const { ref: _ref, ...rest } = meal;
    items.push({ ...rest, ref: newRef(), sortKey: key, placeRef: place.ref, variantRefs: [variant.ref], replacesRefs: [] });
  }
  for (const variant of variants) writes.push({ collection: 'variants', element: variant, op: 'insert' });
  for (const item of updates) writes.push({ collection: 'items', element: item, op: 'update' });
  for (const item of items) writes.push({ collection: 'items', element: item, op: 'insert' });

  const changed = new Map(updates.map((each) => [each.ref, each]));
  return {
    doc: {
      ...doc,
      places: [...doc.places, ...places],
      variantGroups: doc.variantGroups.some((each) => each.ref === groupRef) ? doc.variantGroups : [...doc.variantGroups, group],
      variants: [...doc.variants, ...variants],
      items: [...doc.items.map((each) => changed.get(each.ref) ?? each), ...items],
    },
    writes,
  };
}
