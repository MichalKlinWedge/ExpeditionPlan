import { minutesOutside, openingOn, parseOpeningHours, formatInterval } from './engine/opening-hours.ts';
import { activeVariants, scheduleDay } from './engine/schedule.ts';
import { minutesOfDay } from './engine/time.ts';
import { distanceKm } from './offline-areas.ts';
import { plainName } from './place-list.ts';
import type { DayMap } from './plan-info.ts';
import { dayItems } from './plan-edits.ts';
import { z } from 'zod';

import type { TripDocument, VenueRating } from './schemas/trip-document.ts';
import { keyBetween } from './sort-key.ts';

/**
 * Jedzenie na mieście: knajpy w pobliżu posiłku z planu (Geoapify Places, dane OSM — wyniki wolno
 * przechowywać, docs/USLUGI.md). Szukamy wokół miejsca posiłku, a bez niego wokół najbliższego
 * punktu dnia ze współrzędnymi albo bazy dnia. Jedna przypięta knajpa = miejsce posiłku; kilka =
 * grupa wariantów „gdzie jemy” — każda knajpa to kopia posiłku w swoim wariancie, a wybiera się
 * ją na telefonie (chipy nad dniem, offline) albo w planie. Knajpa, która już jest w planie jako
 * miejsce, nie tworzy duplikatu: to samo miejsce dostaje znacznik `venue` i brakujące dane.
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
  /** Sieć (`brand` w OSM). */
  chain?: boolean;
  /** Polecenie z przewodnika (Wikivoyage, `planner/src/wikivoyage-eat.ts`). */
  tip?: EateryTip;
};

export type EateryPriceTier = 'budget' | 'mid' | 'splurge';

export const EATERY_PRICE_TIER: Record<EateryPriceTier, string> = { budget: 'tanio', mid: 'średnio', splurge: 'drogo' };

/**
 * Lokal opisany w sekcji „Eat” / „Drink” artykułu Wikivoyage (CC BY-SA): przedział cen z nagłówka sekcji,
 * cena i krótki opis do pokazania w wynikach z atrybucją. Do planu trafia tylko link do artykułu.
 */
export type EateryTip = {
  source: 'wikivoyage';
  /** Tytuł artykułu („Barcelona/Ciutat Vella”). */
  article: string;
  url: string;
  tier?: EateryPriceTier;
  price?: string;
  text?: string;
  /** Rok ostatniej zmiany wpisu (`lastedit`). */
  year?: number;
};

/** Oceny „warto / nie warto” tego lokalu z naszych wyjazdów (`place_memories`, ta sama nazwa i blisko). */
export type EateryMemory = { worth: number; notWorth: number; notes: string[] };

/** Knajpa w wynikach wyszukiwania: odległość od środka, a przy posiłku między punktami także od trasy. */
export type EateryResult = Eatery & { distanceM: number; routeM?: number; open: OpenAtMeal; summary: string; memory?: EateryMemory };

export type EateryAnswer =
  | { error: string }
  | {
      center: SearchCenter;
      /** Posiłek między dwoma punktami: szukamy wzdłuż drogi z `from` do `to`. */
      route?: { from: string; to: string };
      results: EateryResult[];
      /** Artykuły Wikivoyage, z których są polecenia (atrybucja). */
      tipSources: { title: string; url: string }[];
    };

export const EATERY_KINDS: Record<EateryKind, string> = { restaurant: 'restauracja', fast_food: 'szybkie jedzenie', cafe: 'kawiarnia', pub: 'pub / bar', hut: 'schronisko' };

const CUISINE: Record<string, string> = {
  regional: 'regionalna', local: 'lokalna', italian: 'włoska', pizza: 'pizza', burger: 'burgery', kebab: 'kebab', chinese: 'chińska', japanese: 'japońska',
  sushi: 'sushi', thai: 'tajska', indian: 'indyjska', vietnamese: 'wietnamska', mexican: 'meksykańska', french: 'francuska', spanish: 'hiszpańska',
  tapas: 'tapas', greek: 'grecka', turkish: 'turecka', georgian: 'gruzińska', moroccan: 'marokańska', croatian: 'chorwacka', polish: 'polska',
  balkan: 'bałkańska', mediterranean: 'śródziemnomorska', seafood: 'owoce morza', fish: 'ryby', steak_house: 'steki', grill: 'grill',
  barbecue: 'grill', vegetarian: 'wegetariańska', vegan: 'wegańska', sandwich: 'kanapki', coffee_shop: 'kawa', cake: 'ciasta', ice_cream: 'lody',
  chicken: 'kurczak', asian: 'azjatycka', arab: 'arabska', lebanese: 'libańska', african: 'afrykańska', pasta: 'makarony', noodle: 'makarony', international: 'międzynarodowa', breakfast: 'śniadania', crepe: 'naleśniki', bakery: 'piekarnia',
  noodles: 'makarony', italian_pizza: 'pizza', catalan: 'katalońska', basque: 'baskijska', portuguese: 'portugalska', peruvian: 'peruwiańska',
  argentinian: 'argentyńska', venezuelan: 'wenezuelska', brazilian: 'brazylijska', korean: 'koreańska', american: 'amerykańska', british: 'brytyjska',
  german: 'niemiecka', austrian: 'austriacka', czech: 'czeska', hungarian: 'węgierska', russian: 'rosyjska', ukrainian: 'ukraińska', middle_eastern: 'bliskowschodnia',
  falafel: 'falafel', hot_dog: 'hot dogi', donut: 'pączki', tea: 'herbata', bubble_tea: 'bubble tea', salad: 'sałatki', soup: 'zupy', dessert: 'desery', wine: 'wino', beer: 'piwo',
};

const cuisineName = (key: string) => CUISINE[key] ?? key.replaceAll('_', ' ');

/** „pizza;italian” → „pizza, włoska”. */
export const cuisineLabel = (cuisine: string | undefined) =>
  cuisine === undefined
    ? undefined
    : cuisine
        .split(/[;,]/)
        .map((each) => each.trim().toLowerCase())
        .filter((each) => each !== '')
        .map(cuisineName)
        .filter((each, index, all) => all.indexOf(each) === index)
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

/** Posiłek bez własnego miejsca między dwoma punktami dnia ze współrzędnymi: knajpy liczymy od drogi między nimi. */
export type MealRoute = { from: SearchCenter; to: SearchCenter };

/** Dłuższy odcinek to zwykle przejazd — wtedy szukamy przy poprzednim punkcie, jak dotąd. */
export const MEAL_ROUTE_MAX_M = 6000;

export function mealRoute(doc: Doc, itemRef: string): MealRoute | null {
  const item = doc.items.find((each) => each.ref === itemRef);
  if (item === undefined || item.dayRef === undefined || located(placeOf(doc, item))) return null;
  const day = dayItems(doc, item.dayRef);
  const index = day.findIndex((each) => each.ref === itemRef);
  const at = (each: Item): SearchCenter | null => {
    const place = placeOf(doc, each);
    return located(place) ? { lat: place.lat, lng: place.lng, near: place.name } : null;
  };
  const from = day.slice(0, index).reverse().filter((each) => each.kind !== 'meal').map(at).find((each) => each !== null);
  const to = day.slice(index + 1).filter((each) => each.kind !== 'meal').map(at).find((each) => each !== null);
  // Ten sam punkt przed i po posiłku (wyjście i powrót) to nie droga: szukamy wokół niego.
  if (!from || !to || metersBetween(from, to) < 100 || metersBetween(from, to) > MEAL_ROUTE_MAX_M) return null;
  return { from, to };
}

/** Odległość punktu od odcinka trasy (płaskie przybliżenie, wystarczy na kilka km). */
export function distanceToRouteM(route: MealRoute, point: { lat: number; lng: number }): number {
  const k = Math.cos((((route.from.lat + route.to.lat) / 2) * Math.PI) / 180);
  const m = (6_371_000 * Math.PI) / 180;
  const xy = (q: { lat: number; lng: number }) => [(q.lng - route.from.lng) * k * m, (q.lat - route.from.lat) * m] as const;
  const [bx, by] = xy(route.to);
  const [px, py] = xy(point);
  const length2 = bx * bx + by * by;
  const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / length2));
  return Math.round(Math.hypot(px - t * bx, py - t * by));
}

/** Koło, które obejmuje drogę z zapasem `radiusM` z każdej strony (najwyżej 5 km). */
export function routeSearchArea(route: MealRoute, radiusM: number): SearchCenter & { radiusM: number } {
  const half = metersBetween(route.from, route.to) / 2;
  return { lat: (route.from.lat + route.to.lat) / 2, lng: (route.from.lng + route.to.lng) / 2, near: `${route.from.near} → ${route.to.near}`, radiusM: Math.min(5000, Math.round(half + radiusM)) };
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

/** „polecane w Wikivoyage (tanio)”. */
export const tipLabel = (tip: EateryTip) => `polecane w Wikivoyage${tip.tier ? ` (${EATERY_PRICE_TIER[tip.tier]})` : ''}`;

/** Opis knajpy do wariantu i listy: „pizza, włoska · 350 m · 12:00–23:00”; przy trasie „120 m od trasy”. */
export function eaterySummary(eatery: Eatery, center: { lat: number; lng: number } | null, open?: OpenAtMeal, routeM?: number): string {
  return [
    // OSM zwykle nie mówi, czy schronisko wydaje posiłki.
    cuisineLabel(eatery.cuisine) ?? (eatery.kind === 'hut' ? 'schronisko (posiłki do sprawdzenia)' : EATERY_KINDS[eatery.kind]),
    eatery.vegan ? 'wegańskie' : eatery.vegetarian ? 'wege' : undefined,
    eatery.tip ? tipLabel(eatery.tip) : undefined,
    routeM !== undefined ? `${formatDistance(routeM)} od trasy` : center === null ? undefined : formatDistance(metersBetween(center, eatery)),
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

const osmUrl = (osm: NonNullable<Eatery['osm']>) => `https://www.openstreetmap.org/${osm.type}/${osm.id}`;

/**
 * Wyszukanie lokalu w Mapach Google (sam link, nic nie pobieramy ani nie zapisujemy — docs/USLUGI.md §3):
 * tam są opinie i średnia ocena, której nie wolno nam przechowywać.
 */
export function googleMapsSearchUrl(eatery: Pick<Eatery, 'name' | 'lat' | 'lng' | 'address'>): string {
  const query = eatery.address ? `${eatery.name}, ${eatery.address}` : `${eatery.name} ${eatery.lat.toFixed(5)},${eatery.lng.toFixed(5)}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/** Kuchnie z OSM po polsku, bez powtórzeń („pasta;noodle” → [„makarony”]); po nich filtruje się listę. */
const cuisineNames = (cuisine: string | undefined) => [
  ...new Set(
    (cuisine ?? '')
      .split(/[;,]/)
      .map((each) => each.trim().toLowerCase())
      .filter((each) => each !== '')
      .map(cuisineName),
  ),
];

/** Polecana: z przewodnika albo z przewagą „warto” w naszych ocenach. */
export const isRecommendedEatery = (result: Pick<EateryResult, 'tip' | 'memory'>) => result.tip !== undefined || (result.memory !== undefined && result.memory.worth > result.memory.notWorth);

/** `cuisines` — wybrane kuchnie (dowolna z nich); pusta lista = każda. */
export type EateryFilter = { hideClosed: boolean; noChains: boolean; cuisines: string[]; onlyRecommended: boolean };

export const DEFAULT_EATERY_FILTER: EateryFilter = { hideClosed: true, noChains: true, cuisines: [], onlyRecommended: false };

/**
 * Ostatnie wybory w „Knajpy w pobliżu”, zapamiętane dla konta (`user_settings.eatery_search`, web i telefon).
 * Wszystko opcjonalne: czego brak, zostaje domyślne. Kuchnie zapisują się po polsku, jak w `cuisineOptions`.
 */
export const EaterySearchPrefs = z.object({
  kinds: z.array(z.enum(['restaurant', 'fast_food', 'cafe', 'pub', 'hut'])).max(5).optional(),
  radiusM: z.number().int().min(200).max(5000).optional(),
  diet: z.enum(['vegetarian', 'vegan', 'gluten_free', 'halal']).nullable().optional(),
  hideClosed: z.boolean().optional(),
  noChains: z.boolean().optional(),
  onlyRecommended: z.boolean().optional(),
  cuisines: z.array(z.string().min(1).max(60)).max(40).optional(),
});
export type EaterySearchPrefs = z.infer<typeof EaterySearchPrefs>;

/** Zapisane wybory z bazy; zepsute albo z innej wersji = brak (domyślne). */
export function readEaterySearchPrefs(raw: unknown): EaterySearchPrefs {
  const parsed = EaterySearchPrefs.safeParse(raw);
  return parsed.success ? parsed.data : {};
}

/** Filtr listy z zapisanych wyborów. */
export const eateryFilterFrom = (prefs: EaterySearchPrefs): EateryFilter => ({
  hideClosed: prefs.hideClosed ?? DEFAULT_EATERY_FILTER.hideClosed,
  noChains: prefs.noChains ?? DEFAULT_EATERY_FILTER.noChains,
  onlyRecommended: prefs.onlyRecommended ?? DEFAULT_EATERY_FILTER.onlyRecommended,
  cuisines: prefs.cuisines ?? [],
});

/**
 * Zapamiętane kuchnie, które są w tych wynikach. Kuchnia, której tu nie ma, nie odsiewa wszystkiego:
 * zostaje zapisana na inne wyszukiwanie, a tu działa „każda” albo pozostałe wybrane.
 */
export const presentCuisines = (filter: EateryFilter, options: readonly { key: string }[]): EateryFilter => ({
  ...filter,
  cuisines: filter.cuisines.filter((cuisine) => options.some((option) => option.key === cuisine)),
});

/** Kuchnie obecne w wynikach (polskie nazwy, `key` = to, co trafia do `EateryFilter.cuisines`), najczęstsze najpierw. */
export function cuisineOptions(results: readonly Pick<EateryResult, 'cuisine'>[]): { key: string; label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const result of results) for (const name of cuisineNames(result.cuisine)) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts].map(([name, count]) => ({ key: name, label: name, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'pl'));
}

/** Wyniki po filtrach: bez zamkniętych w porze posiłku, bez sieciówek, wybrane kuchnie, tylko polecane. */
export function filterEateries<T extends EateryResult>(results: readonly T[], filter: EateryFilter): T[] {
  return results.filter(
    (result) =>
      (!filter.hideClosed || result.open.state !== 'closed') &&
      (!filter.noChains || result.chain !== true) &&
      (filter.cuisines.length === 0 || cuisineNames(result.cuisine).some((name) => filter.cuisines.includes(name))) &&
      (!filter.onlyRecommended || isRecommendedEatery(result)),
  );
}

const OPEN_FIRST = { open: 0, partly: 1, unknown: 2, closed: 3 } as const;
const signal = (result: EateryResult) => (result.memory !== undefined && result.memory.notWorth > result.memory.worth ? 3 : isRecommendedEatery(result) ? 0 : result.chain ? 2 : 1);

/**
 * Mapa wyników wyszukiwania: pinezka z numerem na liście (1, 2, …) dla każdej knajpy. `keys` to stałe klucze
 * wyników (nazwa + współrzędne) w kolejności listy — po nich lista i mapa wskazują sobie nawzajem tę samą knajpę.
 */
export function eateryResultsMap(results: readonly Pick<EateryResult, 'name' | 'lat' | 'lng' | 'summary'>[]): { keys: string[]; map: DayMap } {
  const keys = results.map((result) => `${result.name}|${result.lat}|${result.lng}`);
  const pins: DayMap['pins'] = results.map((result, index) => ({
    placeRef: keys[index]!,
    name: result.name,
    lat: result.lat,
    lng: result.lng,
    stops: [{ ref: keys[index]!, n: index + 1, title: result.summary }],
  }));
  return { keys, map: { pins, lines: [], numbers: Object.fromEntries(keys.map((key, index) => [key, index + 1])) } };
}

/**
 * Kolejność wyników: zamknięte w porze posiłku na koniec; przed nimi polecane, zwykłe, sieciówki i nasze
 * „nie warto”. W każdej grupie otwarte przed tymi bez godzin (polecenia z przewodnika zwykle ich nie mają),
 * a potem najbliżej trasy albo środka.
 */
export function rankEateries<T extends EateryResult>(results: readonly T[]): T[] {
  const closed = (result: EateryResult) => Number(result.open.state === 'closed');
  return [...results].sort((a, b) => closed(a) - closed(b) || signal(a) - signal(b) || OPEN_FIRST[a.open.state] - OPEN_FIRST[b.open.state] || (a.routeM ?? a.distanceM) - (b.routeM ?? b.distanceM));
}

/** Fakty z wyszukiwania zapisane w notatce miejsca: kuchnia, dieta, sieć, polecenie (sama etykieta, tekst przewodnika nie), telefon. */
const eateryNotes = (eatery: Eatery) => {
  const cuisine = cuisineLabel(eatery.cuisine);
  const tip = eatery.tip ? tipLabel(eatery.tip) : '';
  return [
    cuisine ? `Kuchnia: ${cuisine}` : '',
    eatery.vegan ? 'Wegańskie' : eatery.vegetarian ? 'Wege' : '',
    eatery.chain ? 'Sieć' : '',
    tip ? tip.charAt(0).toUpperCase() + tip.slice(1) : '',
    eatery.phone ? `Tel. ${eatery.phone}` : '',
  ]
    .filter(Boolean)
    .join('. ');
};

const EATERY_CATEGORIES = new Set<string>(Object.keys(EATERY_KINDS));

/** Czy miejsce wskazano jako knajpę: ma `venue`, a starsze przypięte po tym, że pochodzą z wyszukiwania knajp. */
export const isEateryPlace = (place: Place) => place.venue !== undefined || (place.provider === 'geoapify' && EATERY_CATEGORIES.has(place.category ?? ''));

/** „restauracja”, „schronisko”; `undefined`, gdy kategoria miejsca nie mówi, co to za lokal. */
export const eateryKindLabel = (place: Place) => (EATERY_CATEGORIES.has(place.category ?? '') ? EATERY_KINDS[place.category as EateryKind] : undefined);

/** Ta sama knajpa co miejsce w planie: ten sam obiekt OSM albo ta sama nazwa najwyżej 150 m dalej (bez współrzędnych: sama nazwa). */
function sameEatery(place: Place, eatery: Eatery): boolean {
  if (eatery.osm !== undefined && place.links.some((link) => link.url === osmUrl(eatery.osm!))) return true;
  if (plainName(place.name) !== plainName(eatery.name)) return false;
  return !located(place) || metersBetween(place, eatery) <= 150;
}

/** Miejsce z planu jako knajpa: nazwa i to, co już w nim jest, zostają, a dochodzi tylko to, czego brakowało. */
function pinnedPlace(place: Place, eatery: Eatery): Place {
  const fresh = eateryPlace(eatery, place.ref);
  const links = fresh.links.filter((each) => !place.links.some((own) => own.url === each.url));
  return {
    ...place,
    ...(located(place) ? {} : { lat: fresh.lat!, lng: fresh.lng! }),
    ...(place.address === undefined && fresh.address !== undefined ? { address: fresh.address } : {}),
    ...(place.openingHours === undefined && fresh.openingHours !== undefined ? { openingHours: fresh.openingHours } : {}),
    ...(place.website === undefined && fresh.website !== undefined ? { website: fresh.website } : {}),
    ...(links.length === 0 ? {} : { links: [...place.links, ...links] }),
    ...(place.notes === undefined && fresh.notes !== undefined ? { notes: fresh.notes } : {}),
    venue: place.venue ?? { prices: [] },
  };
}

/** Knajpa jako miejsce planu (`provider: geoapify`), z linkiem do OSM. */
export function eateryPlace(eatery: Eatery, ref: string): Place {
  const website = validUrl(eatery.website);
  const notes = eateryNotes(eatery);
  return {
    ref,
    name: eatery.name,
    venue: { prices: [] },
    category: eatery.kind === 'restaurant' ? 'restaurant' : eatery.kind,
    lat: Math.round(eatery.lat * 1e5) / 1e5,
    lng: Math.round(eatery.lng * 1e5) / 1e5,
    provider: 'geoapify',
    ...(eatery.address ? { address: eatery.address } : {}),
    ...(eatery.openingHours ? { openingHours: eatery.openingHours } : {}),
    ...(website ? { website } : {}),
    links: [...(eatery.osm ? [{ label: 'OpenStreetMap', url: osmUrl(eatery.osm) }] : []), ...(eatery.tip ? [{ label: `Wikivoyage: ${eatery.tip.article}`, url: eatery.tip.url }] : [])],
    ...(notes ? { notes } : {}),
  };
}

/** Punkt na mapie OpenStreetMap (link „mapa”, jak w wynikach wyszukiwania). */
export const osmPointUrl = (point: { lat: number; lng: number }) => `https://www.openstreetmap.org/?mlat=${point.lat}&mlon=${point.lng}#map=18/${point.lat}/${point.lng}`;

/** Przypięta knajpa tak jak w wynikach wyszukiwania: opis, otwarcie w porze posiłku, adres i linki. */
export type PinnedEateryFacts = { summary?: string; rating?: VenueRating; open: OpenAtMeal; address?: string; links: { label: string; url: string }[] };

/**
 * Dane przypiętej knajpy z jej miejsca w planie. `summary` — opis zapisany w wariancie przy przypięciu
 * (z odległością); bez niego rodzaj lokalu i notatka miejsca. Linki: „Opinie Google” i mapa liczone
 * z nazwy i współrzędnych (nic nie pobieramy), strona lokalu i linki miejsca (Wikivoyage, OSM).
 */
export function pinnedEateryFacts(doc: Doc, itemRef: string, placeRef: string, summary?: string): PinnedEateryFacts | null {
  const place = doc.places.find((each) => each.ref === placeRef);
  if (place === undefined) return null;
  const text = summary ?? ([eateryKindLabel(place), place.notes].filter(Boolean).join(' · ') || undefined);
  const links = [
    ...(located(place)
      ? [
          { label: 'Opinie Google', url: googleMapsSearchUrl({ name: place.name, lat: place.lat, lng: place.lng, ...(place.address ? { address: place.address } : {}) }) },
          { label: 'mapa', url: osmPointUrl(place) },
        ]
      : []),
    ...(place.website ? [{ label: 'strona', url: place.website }] : []),
    ...place.links.map((link) => ({ label: link.label.startsWith('Wikivoyage') ? 'Wikivoyage' : link.label, url: link.url })),
  ];
  const rating = place.venue?.rating;
  return { ...(text ? { summary: text } : {}), ...(rating ? { rating } : {}), open: openAtMeal(place.openingHours, mealSlot(doc, itemRef)), ...(place.address ? { address: place.address } : {}), links };
}

/** Grupa „gdzie jemy” posiłku (jeśli już jest): wariant, w którym posiłek występuje. */
export function eatOutGroup(doc: Doc, itemRef: string): Group | undefined {
  const item = doc.items.find((each) => each.ref === itemRef);
  const variant = doc.variants.find((each) => item?.variantRefs.includes(each.ref));
  const group = variant === undefined ? undefined : doc.variantGroups.find((each) => each.ref === variant.groupRef);
  return group?.scope === 'item' && group.conditionKind === 'choice' ? group : undefined;
}

export type EatOutOption = { variantRef: string; itemRef: string; label: string; summary?: string; placeRef?: string; place?: string; active: boolean };

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
      return { variantRef: variant.ref, itemRef: item?.ref ?? '', label: variant.label, ...(variant.summary ? { summary: variant.summary } : {}), ...(item?.placeRef ? { placeRef: item.placeRef } : {}), ...(place ? { place } : {}), active: active.has(variant.ref) };
    });
}

/** Knajpa przypięta do posiłku; `variantRef` — jest jedną z kilku do wyboru. */
export type MealEatery = { placeRef: string; name: string; summary?: string; variantRef?: string; active: boolean };

/** Knajpy przypięte do posiłku: opcje „gdzie jemy”, a bez nich jego miejsce, jeśli wskazano je jako knajpę. */
export function mealEateries(doc: Doc, itemRef: string): MealEatery[] {
  const options = eatOutOptions(doc, itemRef);
  if (options.length > 0) {
    return options.flatMap((option) =>
      option.placeRef === undefined ? [] : [{ placeRef: option.placeRef, name: option.place ?? option.label, ...(option.summary ? { summary: option.summary } : {}), variantRef: option.variantRef, active: option.active }],
    );
  }
  const placeRef = doc.items.find((each) => each.ref === itemRef)?.placeRef;
  const place = placeRef === undefined ? undefined : doc.places.find((each) => each.ref === placeRef);
  return place !== undefined && isEateryPlace(place) ? [{ placeRef: place.ref, name: place.name, active: true }] : [];
}

/** Czy ta knajpa z wyszukiwania jest już przypięta do posiłku. */
export function isPinnedEatery(doc: Doc, itemRef: string, eatery: Eatery): boolean {
  const pinned = new Set(mealEateries(doc, itemRef).map((each) => each.placeRef));
  return doc.places.some((place) => pinned.has(place.ref) && sameEatery(place, eatery));
}

/** Elementy do zapisu, w kolejności kluczy obcych: miejsca → grupa → warianty → punkty. */
export type EatOutWrite =
  | { collection: 'places'; element: Place; op: 'insert' | 'update' }
  | { collection: 'variantGroups'; element: Group; op: 'insert' | 'update' }
  | { collection: 'variants'; element: Variant; op: 'insert' }
  | { collection: 'items'; element: Item; op: 'insert' | 'update' };

/** `pinned` — miejsca wybranych knajp, także tych, które już były przypięte. */
export type EatOutEdit = { doc: Doc; writes: EatOutWrite[]; pinned: string[] };

/**
 * Przypięcie wybranych knajp do posiłku. Jedna (a posiłek nie ma jeszcze knajpy) → miejsce
 * posiłku. Kilka → grupa „<posiłek> — gdzie jemy?”: posiłek dostaje pierwszą knajpę i jej wariant
 * (polecany), każda kolejna to kopia posiłku w swoim wariancie, zaraz za nim w kolejności dnia.
 * Knajpa przypięta wcześniej nie znika: z następną tworzy taką grupę, a gdy grupa już jest, nowe
 * knajpy do niej dochodzą. Knajpa już przypięta nie dubluje się. `newRef` daje klucze `id-<uuid>`.
 */
export function addEatOutChoices(doc: Doc, itemRef: string, picks: { eatery: Eatery; summary?: string; rating?: VenueRating }[], newRef: () => string): EatOutEdit | null {
  const meal = doc.items.find((each) => each.ref === itemRef);
  if (meal === undefined || meal.dayRef === undefined || picks.length === 0) return null;
  const before = mealEateries(doc, itemRef);
  const known = new Set(before.map((each) => each.placeRef));
  const writes: EatOutWrite[] = [];
  const added: Place[] = [];
  const updated = new Map<string, Place>();
  const chosen: { place: Place; summary: string | undefined }[] = [];
  // Ocena wpisana przy wyniku (przepisana przez użytkownika) zastępuje zapisaną.
  const rated = (place: Place, rating: VenueRating | undefined): Place => (rating === undefined ? place : { ...place, venue: { ...(place.venue ?? { prices: [] }), rating } });
  for (const { eatery, summary, rating } of picks) {
    const existing = [...doc.places, ...added].find((place) => sameEatery(place, eatery));
    if (existing === undefined) {
      const place = rated(eateryPlace(eatery, newRef()), rating);
      added.push(place);
      writes.push({ collection: 'places', element: place, op: 'insert' });
      chosen.push({ place, summary });
    } else if (!chosen.some((each) => each.place.ref === existing.ref)) {
      const place = rated(pinnedPlace(existing, eatery), rating);
      if (JSON.stringify(place) !== JSON.stringify(existing)) {
        updated.set(place.ref, place);
        writes.push({ collection: 'places', element: place, op: 'update' });
      }
      chosen.push({ place, summary });
    }
  }
  const pinned = chosen.map(({ place }) => place.ref);
  const placesAfter = [...doc.places.map((place) => updated.get(place.ref) ?? place), ...added];
  const fresh = chosen.filter(({ place }) => !known.has(place.ref));
  if (fresh.length === 0) return { doc: { ...doc, places: placesAfter }, writes, pinned };
  let group = eatOutGroup(doc, itemRef);

  if (group === undefined && before.length === 0 && fresh.length === 1) {
    const changed: Item = { ...meal, placeRef: fresh[0]!.place.ref };
    if (meal.placeRef !== changed.placeRef) writes.push({ collection: 'items', element: changed, op: 'update' });
    return { doc: { ...doc, places: placesAfter, items: doc.items.map((each) => (each.ref === itemRef ? changed : each)) }, writes, pinned };
  }

  const variants: Variant[] = [];
  const items: Item[] = [];
  const updates: Item[] = [];
  // Knajpa przypięta wcześniej staje się pierwszą opcją: posiłek zostaje przy niej.
  const earlier = group === undefined ? before.flatMap((each) => placesAfter.filter((place) => place.ref === each.placeRef)) : [];
  let pending: { place: Place; summary?: string | undefined }[] = [...earlier.map((place) => ({ place })), ...fresh];
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
      places: placesAfter,
      variantGroups: doc.variantGroups.some((each) => each.ref === groupRef) ? doc.variantGroups : [...doc.variantGroups, group],
      variants: [...doc.variants, ...variants],
      items: [...doc.items.map((each) => changed.get(each.ref) ?? each), ...items],
    },
    writes,
    pinned,
  };
}

/** Zapis odpięcia knajpy: zmienione albo usunięte punkty, warianty i grupa (w tej kolejności). */
export type EatOutRemoveWrite =
  | { collection: 'items'; element: Item; op: 'update' | 'remove' }
  | { collection: 'variants'; element: Variant; op: 'update' | 'remove' }
  | { collection: 'variantGroups'; element: Group; op: 'update' | 'remove' };

export type EatOutRemoveEdit = { doc: Doc; writes: EatOutRemoveWrite[] };

/**
 * Odpięcie knajpy od posiłku (miejsce zostaje w planie, usuwa się je na stronie Miejsca). Jedyna knajpa
 * → posiłek traci miejsce. Z grupy „gdzie jemy” znika wariant tej knajpy i jego kopia posiłku; posiłek
 * `itemRef` zostaje zawsze (przy odpinaniu jego własnej knajpy przejmuje następną opcję). Gdy zostaje
 * jedna knajpa, grupa znika, a posiłek jest zwykłym punktem z jej miejscem. `null` = nie ma czego odpiąć.
 */
export function removeEatOutChoice(doc: Doc, itemRef: string, placeRef: string): EatOutRemoveEdit | null {
  const meal = doc.items.find((each) => each.ref === itemRef);
  if (meal === undefined) return null;
  const group = eatOutGroup(doc, itemRef);
  if (group === undefined) {
    if (meal.placeRef !== placeRef) return null;
    const { placeRef: _place, ...rest } = meal;
    const changed: Item = rest;
    return { doc: { ...doc, items: doc.items.map((each) => (each.ref === itemRef ? changed : each)) }, writes: [{ collection: 'items', element: changed, op: 'update' }] };
  }
  const options = eatOutOptions(doc, itemRef);
  const removed = options.find((option) => option.placeRef === placeRef);
  if (removed === undefined) return null;
  const rest = options.filter((option) => option !== removed);
  const groupVariantRefs = new Set(doc.variants.filter((each) => each.groupRef === group.ref).map((each) => each.ref));
  const itemWrites: EatOutRemoveWrite[] = [];
  const removedItems = new Set<string>();
  let main: Item;

  if (rest.length <= 1) {
    // Jedna knajpa to już nie wybór: posiłek z jej miejscem, kopie, warianty i grupa znikają.
    const keep = rest[0];
    const { placeRef: _place, ...plain } = meal;
    main = { ...plain, ...(keep?.placeRef ? { placeRef: keep.placeRef } : {}), variantRefs: meal.variantRefs.filter((ref) => !groupVariantRefs.has(ref)) };
    for (const option of options) if (option.itemRef !== itemRef && option.itemRef !== '') removedItems.add(option.itemRef);
    const variantWrites: EatOutRemoveWrite[] = doc.variants.filter((each) => groupVariantRefs.has(each.ref)).map((element) => ({ collection: 'variants', element, op: 'remove' }));
    const items = doc.items.filter((each) => !removedItems.has(each.ref)).map((each) => (each.ref === itemRef ? main : each));
    for (const ref of removedItems) itemWrites.push({ collection: 'items', element: doc.items.find((each) => each.ref === ref)!, op: 'remove' });
    return {
      doc: { ...doc, items, variants: doc.variants.filter((each) => !groupVariantRefs.has(each.ref)), variantGroups: doc.variantGroups.filter((each) => each.ref !== group.ref) },
      writes: [{ collection: 'items', element: main, op: 'update' }, ...itemWrites, ...variantWrites, { collection: 'variantGroups', element: group, op: 'remove' }],
    };
  }

  // Posiłek zostaje: odpinając jego własną knajpę, bierze miejsce i wariant pierwszej z pozostałych (jej kopia znika).
  const donor = removed.itemRef === itemRef ? rest[0]! : undefined;
  if (donor !== undefined) {
    main = { ...meal, ...(donor.placeRef ? { placeRef: donor.placeRef } : {}), variantRefs: [...meal.variantRefs.filter((ref) => ref !== removed.variantRef), donor.variantRef] };
    if (donor.itemRef !== '') removedItems.add(donor.itemRef);
    itemWrites.push({ collection: 'items', element: main, op: 'update' });
  } else {
    main = meal;
    if (removed.itemRef !== '') removedItems.add(removed.itemRef);
  }
  for (const ref of removedItems) itemWrites.push({ collection: 'items', element: doc.items.find((each) => each.ref === ref)!, op: 'remove' });
  const gone = doc.variants.find((each) => each.ref === removed.variantRef)!;
  const variants = doc.variants.filter((each) => each.ref !== gone.ref);
  const writes: EatOutRemoveWrite[] = [...itemWrites];
  // Polecany wariant znika → polecana jest pierwsza z pozostałych knajp.
  let nextVariants = variants;
  if (gone.recommended) {
    const heir = variants.find((each) => each.ref === rest[0]!.variantRef)!;
    const promoted: Variant = { ...heir, recommended: true };
    nextVariants = variants.map((each) => (each.ref === heir.ref ? promoted : each));
    writes.push({ collection: 'variants', element: promoted, op: 'update' });
  }
  writes.push({ collection: 'variants', element: gone, op: 'remove' });
  let groups = doc.variantGroups;
  if (group.chosenRef === gone.ref) {
    const { chosenRef: _chosen, ...unchosen } = group;
    const nextGroup: Group = unchosen;
    groups = doc.variantGroups.map((each) => (each.ref === group.ref ? nextGroup : each));
    writes.push({ collection: 'variantGroups', element: nextGroup, op: 'update' });
  }
  return {
    doc: { ...doc, items: doc.items.filter((each) => !removedItems.has(each.ref)).map((each) => (each.ref === itemRef ? main : each)), variants: nextVariants, variantGroups: groups },
    writes,
  };
}
