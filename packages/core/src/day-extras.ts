import { projectOnSegment } from './gpx.ts';
import { dayMap, formatMinutes, isTransit, LODGING_STOP, type MapPin } from './plan-info.ts';
import { moveAfter, type PlanEdit } from './plan-edits.ts';
import { plainName } from './place-list.ts';
import { distanceM, type LngLat, simplifyPath } from './polyline.ts';
import { setRouteStop } from './route-stops.ts';
import type { RulesEdit } from './plan-rules.ts';
import type { DayExtra, TripDocument } from './schemas/trip-document.ts';
import type { OsmFeature } from './track-pois.ts';
import type { z } from 'zod';

/**
 * „Po drodze i w pobliżu” dnia: atrakcje, które da się dorzucić bez straty czasu albo za kilkadziesiąt minut,
 * gdy coś wypadnie z planu albo zostanie czas. Kod wyznacza korytarz dnia (miejsca punktów, przejścia pieszo,
 * przejazdy autem — bez lotów i komunikacji, z których się nie wysiada po drodze), wybiera kandydatów z OSM
 * i z puli i liczy objazd; AI (`planner/src/day-extras.ts`) wybiera wartych uwagi, opisuje je i ocenia czas
 * na miejscu. Wynik jest w `DocDay.extras`, więc telefon ma go offline.
 */

type Doc = TripDocument;
type Item = Doc['items'][number];
export type DayExtraItem = z.infer<typeof DayExtra>;
export type ExtraAlong = DayExtraItem['along'];
export type ExtraFit = DayExtraItem['fit'];

/** Jak daleko szukać: od miejsca punktu (pieszo), od przejścia i od drogi przejazdu (m). */
export const EXTRA_RADIUS_M: Record<ExtraAlong, number> = { at: 700, foot: 350, car: 2000 };

const FOOT: ReadonlySet<string> = new Set(['walk', 'hike', 'bike']);
const DRIVE: ReadonlySet<string> = new Set(['car', 'rental_car', 'taxi', 'hired_driver']);
/** Prosta między miejscami bez przejazdu: do tylu metrów to spacer, dalej — jazda. */
const STRAIGHT_FOOT_M = 3000;
/** Pieszo 4,5 km/h, drogą ×1,3 od linii prostej; zjazd autem ok. 42 km/h po lokalnych drogach + parkowanie. */
const WALK_M_PER_MIN = 75;
const DETOUR = 1.3;
const LOCAL_DRIVE_M_PER_MIN = 700;
const PARKING_MIN = 5;
/** Tuż przy drodze: zatrzymanie na poboczu. */
const ROADSIDE_M = 150;
const ROADSIDE_MIN = 2;
/** Kandydatów dla AI (wybiera do 20): więcej to dłuższa odpowiedź bez lepszego wyboru. */
export const EXTRA_CANDIDATES_MAX = 60;

type Path = { mode: 'foot' | 'car'; coordinates: LngLat[]; ref?: string };
type Spot = { lat: number; lng: number; ref?: string };
/** Korytarz dnia: miejsca punktów i odcinki trasy z rodzajem (pieszo / autem). */
export type DayCorridor = { spots: Spot[]; paths: Path[] };

const modeOf = (item: Item | undefined): 'foot' | 'car' | null | undefined => {
  const mode = item?.leg?.mode;
  if (mode === undefined) return undefined;
  if (FOOT.has(mode)) return 'foot';
  if (DRIVE.has(mode)) return 'car';
  // Lot, autobus, pociąg, prom: po drodze się nie wysiada.
  return null;
};

/**
 * Korytarz dnia z mapy dnia (`dayMap`, kolejność z silnika): trasa po drogach i ślady GPX z rodzajem
 * przejazdu, proste między miejscami — po długości. Dojazd i powrót (`isTransit`) pomija, chyba że to własny
 * przejazd autem z trasą po drogach: na długiej drodze z domu też robi się przerwy. Prosta takiego dojazdu nie
 * jest drogą, więc odpada.
 */
export function dayCorridor(doc: Doc, refs: readonly string[], baseRef?: string): DayCorridor {
  const map = dayMap(doc, refs, baseRef === undefined ? {} : { baseRef });
  const items = new Map(doc.items.map((item) => [item.ref, item]));
  const paths: Path[] = [];
  const legEnds = Object.entries(map.straightLegs ?? {});
  for (const line of map.lines) {
    if (line.transit) {
      const own = line.routed && !line.track ? modeOf(items.get(line.refs?.[0] ?? '')) : null;
      if (own === 'car') paths.push({ mode: 'car', coordinates: line.coordinates, ...(line.refs?.[0] ? { ref: line.refs[0] } : {}) });
      continue;
    }
    if (line.routed) {
      const ref = line.refs?.[0];
      const mode = line.track ? 'foot' : modeOf(items.get(ref ?? ''));
      if (mode === null) continue;
      paths.push({ mode: mode ?? 'car', coordinates: line.coordinates, ...(ref ? { ref } : {}) });
      continue;
    }
    // Prosta: odcinek po odcinku — przejazd bez trasy ma swój rodzaj, reszta po długości.
    for (let i = 1; i < line.coordinates.length; i++) {
      const a = line.coordinates[i - 1]!;
      const b = line.coordinates[i]!;
      const leg = legEnds.find(([, ends]) => ends[0]![0] === a[0] && ends[0]![1] === a[1] && ends[1]![0] === b[0] && ends[1]![1] === b[1]);
      const own = leg === undefined ? undefined : modeOf(items.get(leg[0]));
      if (own === null) continue;
      const mode = own ?? (distanceM(a, b) <= STRAIGHT_FOOT_M ? 'foot' : 'car');
      paths.push({ mode, coordinates: [a, b], ...(leg ? { ref: leg[0] } : {}) });
    }
  }
  const spots = map.pins
    .filter((pin) => !pin.transit)
    .map((pin) => {
      const ref = pin.stops.find((stop) => stop.ref !== LODGING_STOP && items.has(stop.ref) && !isTransit(doc, items.get(stop.ref)!))?.ref;
      return { lat: pin.lat, lng: pin.lng, ...(ref ? { ref } : {}) };
    });
  return { spots, paths };
}

/** Od tylu metrów przejazd jest „długi”: zapytanie zbiera też miasta przy trasie i atrakcje w nich (przerwa w drodze). */
export const LONG_DRIVE_M = 40_000;
/** Najwięcej punktów jednej linii w zapytaniu: dłuższą trasę upraszczamy mocniej (600 km autostrady to tysiące punktów). */
const QUERY_POINTS_MAX = 250;

const lengthM = (line: readonly LngLat[]) => line.reduce((sum, point, index) => (index === 0 ? 0 : sum + distanceM(line[index - 1]!, point)), 0);

/** Uproszczenie z rosnącą tolerancją, aż linia ma najwyżej `QUERY_POINTS_MAX` punktów. */
function capPoints(line: LngLat[], toleranceM: number): LngLat[] {
  let out = simplifyPath(line, toleranceM);
  for (let tolerance = toleranceM * 2; out.length > QUERY_POINTS_MAX; tolerance *= 2) out = simplifyPath(line, tolerance);
  return out;
}

/**
 * Linie do zapytania Overpass (`around`): miejsca i przejścia pieszo w promieniu „przy miejscu”, przejazdy — „przy drodze”;
 * długie przejazdy (`long`, od `LONG_DRIVE_M`) osobno: tańszy pas przy drodze i szukanie miast po drodze.
 */
export function corridorQueryLines(corridor: DayCorridor): { near: LngLat[][]; car: LngLat[][]; long: LngLat[][] } {
  // Miejsca łańcuchem po kolei, póki są blisko siebie (dalej to osobne linie — inaczej pas biegłby na przełaj).
  const near: LngLat[][] = [];
  let chain: LngLat[] = [];
  for (const spot of corridor.spots) {
    const point: LngLat = [spot.lng, spot.lat];
    const last = chain.at(-1);
    if (last !== undefined && distanceM(last, point) > 5000) {
      near.push(chain);
      chain = [];
    }
    chain.push(point);
  }
  if (chain.length > 0) near.push(chain);
  const joined = (mode: 'foot' | 'car') => {
    const lines: LngLat[][] = [];
    for (const path of corridor.paths.filter((each) => each.mode === mode)) {
      const last = lines.at(-1);
      const end = last?.at(-1);
      if (last !== undefined && end !== undefined && distanceM(end, path.coordinates[0]!) < 50) last.push(...path.coordinates.slice(1));
      else lines.push([...path.coordinates]);
    }
    return lines;
  };
  // Pojedynczy punkt: `around` dostaje go dwa razy (linia zerowej długości).
  const pad = (line: LngLat[]) => (line.length === 1 ? [line[0]!, line[0]!] : line);
  const car = joined('car');
  const long = (line: LngLat[]) => lengthM(line) >= LONG_DRIVE_M;
  return {
    near: [...near, ...joined('foot').map((line) => capPoints(line, 30))].map(pad),
    car: car.filter((line) => !long(line)).map((line) => pad(capPoints(line, 150))),
    long: car.filter(long).map((line) => capPoints(line, 150)),
  };
}

/** Gdzie szukać: cały dzień, tylko przy trasie przejazdów (z miastami po drodze) albo w podanym mieście. */
export type ExtraScope = 'day' | 'route' | 'city';
export const EXTRA_SCOPE: Record<ExtraScope, string> = { day: 'cały dzień', route: 'trasa przejazdu', city: 'w mieście' };
/** Prośba użytkownika przy szukaniu: zakres i własne słowa dla AI („zamki i punkty widokowe”, „przerwa na obiad”). */
export type ExtraRequest = { scope: ExtraScope; city?: string; hint?: string };

/** Miasto z OSM (`place`) przy trasie dnia albo podane do szukania. */
export type ExtraTown = { name: string; lat: number; lng: number; place: string; offM: number };
/** Atrakcja do tylu metrów od środka miasta liczy się jako „w mieście” (także poza pasem przy drodze). */
export const TOWN_AREA_M = 3000;

/** Miasta z odpowiedzi Overpass (elementy z `place`): nazwa po polsku, gdy jest, i odległość od trasy dnia. */
export function corridorTowns(corridor: DayCorridor, features: readonly OsmFeature[]): ExtraTown[] {
  const towns: ExtraTown[] = [];
  for (const feature of features) {
    const place = feature.tags.place;
    const name = feature.tags['name:pl']?.trim() || feature.tags.name?.trim();
    if (!place || !name || towns.some((each) => each.name === name)) continue;
    towns.push({ name, lat: feature.lat, lng: feature.lng, place, offM: Math.round(placeAnywhere(corridor, feature)?.offM ?? 0) });
  }
  return towns;
}

/** Rodzaje atrakcji z tagów OSM: nazwa po polsku i waga (ciekawsze wyżej). */
const TYPES: Record<string, Record<string, [string, number]>> = {
  tourism: { attraction: ['atrakcja', 1], viewpoint: ['punkt widokowy', 2], museum: ['muzeum', 2], gallery: ['galeria', 1], zoo: ['zoo', 1], aquarium: ['akwarium', 1], theme_park: ['park rozrywki', 1] },
  historic: {
    castle: ['zamek', 2], fort: ['fort', 2], ruins: ['ruiny', 2], archaeological_site: ['stanowisko archeologiczne', 2], city_gate: ['brama miejska', 1], palace: ['pałac', 2],
    monastery: ['klasztor', 2], manor: ['dwór', 1], tower: ['wieża', 1], monument: ['pomnik', 0], memorial: ['miejsce pamięci', 0], church: ['kościół', 1], building: ['zabytkowy budynek', 0],
  },
  natural: {
    waterfall: ['wodospad', 2], cave_entrance: ['jaskinia', 2], arch: ['łuk skalny', 2], gorge: ['wąwóz', 2], hot_spring: ['gorące źródło', 2], geyser: ['gejzer', 2], volcano: ['wulkan', 2],
    peak: ['szczyt', 1], beach: ['plaża', 1], rock: ['skała', 1], spring: ['źródło', 0],
  },
  man_made: { lighthouse: ['latarnia morska', 2], tower: ['wieża', 1], bridge: ['most', 1], windmill: ['wiatrak', 1], watermill: ['młyn wodny', 1] },
  leisure: { park: ['park', 0], garden: ['ogród', 1], nature_reserve: ['rezerwat', 1] },
  building: { cathedral: ['katedra', 2], church: ['kościół', 1], mosque: ['meczet', 1], temple: ['świątynia', 1], chapel: ['kaplica', 0] },
};
const WORSHIP: Record<string, string> = { christian: 'kościół', muslim: 'meczet', jewish: 'synagoga', buddhist: 'świątynia', hindu: 'świątynia' };

/** Rodzaj atrakcji z tagów; `null` — to nie atrakcja (albo bez nazwy). */
export function attractionType(tags: Record<string, string>): { type: string; weight: number } | null {
  if (!tags.name?.trim()) return null;
  if (tags.historic === 'castle' && tags.castle_type === 'kasbah') return { type: 'kasba', weight: 2 };
  for (const key of ['historic', 'tourism', 'natural', 'man_made', 'building', 'leisure']) {
    const found = TYPES[key]?.[tags[key] ?? ''];
    if (found) return { type: found[0], weight: found[1] };
  }
  if (tags.amenity === 'place_of_worship') return { type: WORSHIP[tags.religion ?? ''] ?? 'świątynia', weight: 1 };
  return tags.wikidata || tags.wikipedia ? { type: 'atrakcja', weight: 0 } : null;
}

/** Link do artykułu z tagu `wikipedia` („pl:Zamek w Ogrodzieńcu”). */
export function wikipediaUrl(tag: string | undefined): string | undefined {
  const match = tag?.match(/^([a-z-]{2,12}):(.+)$/);
  if (!match) return undefined;
  return `https://${match[1]}.wikipedia.org/wiki/${encodeURIComponent(match[2]!.trim().replaceAll(' ', '_'))}`;
}

const pointOf = (spot: { lat: number; lng: number }): LngLat => [spot.lng, spot.lat];

function offPath(path: readonly LngLat[], at: LngLat): number {
  let best = Infinity;
  for (let i = 1; i < path.length; i++) best = Math.min(best, projectOnSegment(at, path[i - 1]!, path[i]!).offM);
  return path.length === 1 ? distanceM(path[0]!, at) : best;
}

/** Dojście albo zjazd tam i z powrotem (min) przy danej odległości od miejsca lub trasy. */
export function detourMinutes(along: ExtraAlong, offM: number): number {
  if (along !== 'car') return Math.round((2 * offM * DETOUR) / WALK_M_PER_MIN);
  if (offM <= ROADSIDE_M) return ROADSIDE_MIN;
  return Math.round((2 * offM * DETOUR) / LOCAL_DRIVE_M_PER_MIN) + PARKING_MIN;
}

const effort = (option: { along: ExtraAlong; detourMin: number }) => option.detourMin + (option.along === 'car' ? PARKING_MIN : 0);

/**
 * Atrakcja poza pasem korytarza (w mieście po drodze albo w podanym mieście): objazd od najbliższego miejsca, przejścia
 * albo drogi dnia, bez limitu odległości; dalej niż spacer liczy się jako zjazd autem.
 */
function placeAnywhere(corridor: DayCorridor, at: { lat: number; lng: number }): { along: ExtraAlong; offM: number; detourMin: number; nearRef?: string } | null {
  const point = pointOf(at);
  const options: { along: ExtraAlong; offM: number; nearRef?: string }[] = [
    ...corridor.spots.map((spot) => ({ along: 'at' as const, offM: distanceM(pointOf(spot), point), ...(spot.ref ? { nearRef: spot.ref } : {}) })),
    ...corridor.paths.map((path) => ({ along: path.mode, offM: offPath(path.coordinates, point), ...(path.ref ? { nearRef: path.ref } : {}) })),
  ];
  const best = options
    .map((each) => {
      const along: ExtraAlong = each.offM > STRAIGHT_FOOT_M ? 'car' : each.along;
      return { ...each, along, offM: Math.round(each.offM), detourMin: detourMinutes(along, each.offM) };
    })
    .sort((a, b) => effort(a) - effort(b) || a.offM - b.offM)[0];
  return best ?? null;
}

/** Gdzie atrakcja leży względem dnia: najtańszy objazd spośród miejsc, przejść i przejazdów w zasięgu. */
export function placeOnCorridor(corridor: DayCorridor, at: { lat: number; lng: number }): { along: ExtraAlong; offM: number; detourMin: number; nearRef?: string } | null {
  const point = pointOf(at);
  const options: { along: ExtraAlong; offM: number; nearRef?: string }[] = [];
  for (const spot of corridor.spots) options.push({ along: 'at', offM: distanceM(pointOf(spot), point), ...(spot.ref ? { nearRef: spot.ref } : {}) });
  for (const path of corridor.paths) options.push({ along: path.mode, offM: offPath(path.coordinates, point), ...(path.ref ? { nearRef: path.ref } : {}) });
  const nearestSpot = corridor.spots.filter((spot) => spot.ref !== undefined).sort((a, b) => distanceM(pointOf(a), point) - distanceM(pointOf(b), point))[0];
  const best = options
    .filter((each) => each.offM <= EXTRA_RADIUS_M[each.along])
    .map((each) => ({ ...each, offM: Math.round(each.offM), detourMin: detourMinutes(each.along, each.offM) }))
    // Blisko miejsca, gdzie i tak się jest pieszo, nie wsiada się do auta: zjazd liczy się o kilka minut drożej.
    .sort((a, b) => effort(a) - effort(b) || a.offM - b.offM)[0];
  if (best === undefined) return null;
  // Prosta bez przejazdu nie ma punktu planu — wtedy najbliższe miejsce dnia.
  return best.nearRef === undefined && nearestSpot?.ref ? { ...best, nearRef: nearestSpot.ref } : best;
}

/** Kandydat dla AI: fakty policzone przez kod. */
export type ExtraCandidate = {
  id: string;
  name: string;
  type: string;
  lat: number;
  lng: number;
  along: ExtraAlong;
  offM: number;
  detourMin: number;
  nearRef?: string;
  poolRef?: string;
  wikipedia?: string;
  website?: string;
  openingHours?: string;
  /** Tagi z OSM w skrócie (opis, wstęp), dla AI. */
  note?: string;
  /** Miasto po drodze albo podane, w którym leży. */
  town?: string;
  score: number;
};

/** Zakres kandydatów: miasta po drodze (atrakcje w nich także poza pasem), tylko przy przejazdach, tylko w mieście. */
export type CandidateOptions = { towns?: readonly ExtraTown[]; scope?: ExtraScope };

const round5 = (value: number) => Math.round(value * 1e5) / 1e5;
const httpUrl = (value: string | undefined) => (value && /^https?:\/\//i.test(value) ? value : undefined);

/**
 * Kandydaci dnia: atrakcje z OSM (z nazwą, w zasięgu korytarza) i punkty puli ze współrzędnymi — bez miejsc,
 * które plan już ma, bez odrzuconych i bez powtórek nazwy. Najpierw pula, potem znane (Wikidata, Wikipedia)
 * i ciekawsze rodzaje, a przy równych — mniejszy objazd.
 */
export function extraCandidates(doc: Doc, corridor: DayCorridor, features: readonly OsmFeature[], skipIds: ReadonlySet<string> = new Set(), options: CandidateOptions = {}): ExtraCandidate[] {
  const known = new Set(doc.places.map((place) => plainName(place.name)));
  const places = new Map(doc.places.map((place) => [place.ref, place]));
  const spots = corridor.spots.map(pointOf);
  const towns = options.towns ?? [];
  const scope = options.scope ?? 'day';
  const townOf = (at: { lat: number; lng: number }) =>
    towns
      .map((town) => ({ town, m: distanceM(pointOf(town), pointOf(at)) }))
      .filter((each) => each.m <= TOWN_AREA_M)
      .sort((a, b) => a.m - b.m)[0]?.town;
  // W pasie korytarza albo w mieście po drodze (wtedy objazd od najbliższej drogi, choćby dalej niż pas).
  const locate = (at: { lat: number; lng: number }) => {
    const town = townOf(at);
    if (scope === 'city') return town === undefined ? null : { where: placeAnywhere(corridor, at), town };
    const where = placeOnCorridor(corridor, at) ?? (town === undefined ? null : placeAnywhere(corridor, at));
    if (where === null || (scope === 'route' && where.along !== 'car')) return null;
    return { where, town };
  };
  const found: ExtraCandidate[] = [];
  for (const item of doc.items) {
    if (item.dayRef !== undefined || item.planStatus === 'rejected') continue;
    const place = places.get(item.placeRef ?? '');
    if (place?.lat === undefined || place.lng === undefined || skipIds.has(`pool:${item.ref}`)) continue;
    const located = locate({ lat: place.lat, lng: place.lng });
    if (located?.where == null) continue;
    found.push({
      id: `pool:${item.ref}`,
      name: item.title,
      type: 'z puli wyjazdu',
      lat: place.lat,
      lng: place.lng,
      ...located.where,
      poolRef: item.ref,
      ...(item.description ? { note: item.description.slice(0, 200) } : {}),
      ...(located.town ? { town: located.town.name } : {}),
      score: 10,
    });
  }
  const pooled = found.map((each) => plainName(each.name));
  for (const feature of features) {
    // Same miasta (`place`) to nie atrakcje: służą tylko do szukania w nich.
    if (feature.tags.place) continue;
    const kind = attractionType(feature.tags);
    if (kind === null || skipIds.has(feature.id)) continue;
    const name = feature.tags['name:pl']?.trim() || feature.tags.name!.trim();
    const plain = plainName(name);
    if (known.has(plain) || known.has(plainName(feature.tags.name!)) || pooled.includes(plain)) continue;
    // Samo miejsce punktu (pod inną nazwą w OSM).
    if (spots.some((spot) => distanceM(spot, [feature.lng, feature.lat]) < 60)) continue;
    const located = locate(feature);
    if (located?.where == null) continue;
    const where = located.where;
    const wikipedia = wikipediaUrl(feature.tags.wikipedia);
    const website = httpUrl(feature.tags.website ?? feature.tags['contact:website']);
    const note = [feature.tags.description, feature.tags.fee === 'yes' ? 'wstęp płatny' : feature.tags.fee === 'no' ? 'wstęp wolny' : undefined, feature.tags.heritage ? 'zabytek' : undefined].filter(Boolean).join('; ');
    const score = (feature.tags.wikidata ? 3 : 0) + (wikipedia ? 2 : 0) + kind.weight + (feature.tags.heritage ? 1 : 0) - where.detourMin / 20;
    found.push({
      id: feature.id,
      name,
      type: kind.type,
      lat: round5(feature.lat),
      lng: round5(feature.lng),
      ...where,
      ...(wikipedia ? { wikipedia } : {}),
      ...(website ? { website } : {}),
      ...(feature.tags.opening_hours ? { openingHours: feature.tags.opening_hours } : {}),
      ...(note ? { note } : {}),
      ...(located.town ? { town: located.town.name } : {}),
      score,
    });
  }
  // Ta sama nazwa kilka razy (węzeł i obrys, kilka wejść): zostaje lepsza.
  const sorted = found.sort((a, b) => b.score - a.score || a.detourMin - b.detourMin);
  const kept: ExtraCandidate[] = [];
  for (const each of sorted) if (!kept.some((other) => plainName(other.name) === plainName(each.name) && distanceM(pointOf(other), pointOf(each)) < 1500)) kept.push(each);
  return kept.slice(0, EXTRA_CANDIDATES_MAX);
}

/** Wybór AI: klucz kandydata i to, czego kod nie wie (co to, ile na miejscu, czy widać po drodze, co może zastąpić). */
export type ExtraPick = {
  id: string;
  title: string;
  type?: string | null;
  why: string;
  stayMin: number;
  fit: ExtraFit;
  swapRef?: string | null;
  weather?: 'outdoor' | 'indoor' | 'any' | null;
};

/** „Widać po drodze” tylko naprawdę przy trasie: pieszo do 100 m, przy drodze do 500 m (zamek nad drogą). */
const PASS_M: Record<ExtraAlong, number> = { at: 100, foot: 100, car: 500 };

/**
 * Nowa lista dnia z wyboru AI: odrzucone i wstawione zostają (żeby nie wracały), poprzednie otwarte
 * zastępuje nowy wybór — chyba że `merge` (szukanie zawężone: trasa, miasto, własna prośba), wtedy nowe
 * dochodzą na początek listy. Klucze spoza kandydatów i zamienniki spoza dnia odpadają.
 */
export function applyExtraPicks(doc: Doc, dayRef: string, candidates: readonly ExtraCandidate[], picks: readonly ExtraPick[], today: string, merge = false): Doc['days'][number] | null {
  const day = doc.days.find((each) => each.ref === dayRef);
  if (day === undefined) return null;
  const byId = new Map(candidates.map((each) => [each.id, each]));
  const dayRefs = new Set(doc.items.filter((item) => item.dayRef === dayRef).map((item) => item.ref));
  const kept = (day.extras?.items ?? []).filter((each) => merge || each.status !== undefined);
  const keptIds = new Set(kept.map((each) => each.id));
  const fresh: DayExtraItem[] = [];
  for (const pick of picks) {
    const candidate = byId.get(pick.id);
    if (candidate === undefined || keptIds.has(pick.id) || fresh.some((each) => each.id === pick.id)) continue;
    const pass = pick.fit === 'pass' && candidate.offM <= PASS_M[candidate.along];
    const fit: ExtraFit = pick.fit === 'pass' && !pass ? 'stop' : pick.fit;
    fresh.push({
      id: candidate.id,
      title: pick.title.trim() || candidate.name,
      type: pick.type?.trim() || candidate.type,
      ...(pick.why.trim() ? { why: pick.why.trim() } : {}),
      lat: candidate.lat,
      lng: candidate.lng,
      ...(candidate.nearRef && dayRefs.has(candidate.nearRef) ? { nearRef: candidate.nearRef } : {}),
      along: candidate.along,
      offM: candidate.offM,
      detourMin: candidate.detourMin,
      stayMin: Math.max(0, Math.min(480, Math.round(pick.stayMin))),
      fit,
      ...(pick.swapRef && dayRefs.has(pick.swapRef) ? { swapRef: pick.swapRef } : {}),
      ...(pick.weather ? { weather: pick.weather } : {}),
      ...(candidate.poolRef ? { poolRef: candidate.poolRef } : {}),
      ...(candidate.town ? { town: candidate.town } : {}),
      ...(candidate.wikipedia ? { wikipedia: candidate.wikipedia } : {}),
      ...(candidate.website ? { website: candidate.website } : {}),
    });
  }
  return { ...day, extras: { fetchedAt: today, items: [...fresh, ...kept] } };
}

/** Dodatkowy czas dnia (min): po drodze — zero, inaczej objazd i pobyt. */
export const extraMinutes = (extra: Pick<DayExtraItem, 'fit' | 'detourMin' | 'stayMin'>) => (extra.fit === 'pass' ? 0 : extra.detourMin + extra.stayMin);

/** „bez dodatkowego czasu” albo „+40 min (zjazd 15 min, na miejscu 25 min)”. */
export function extraTimeText(extra: Pick<DayExtraItem, 'fit' | 'detourMin' | 'stayMin' | 'along'>): string {
  if (extra.fit === 'pass') return 'bez dodatkowego czasu';
  const parts = [extra.detourMin > 0 ? `${extra.along === 'car' ? 'zjazd' : 'dojście'} ${formatMinutes(extra.detourMin)}` : undefined, extra.stayMin > 0 ? `na miejscu ${formatMinutes(extra.stayMin)}` : undefined].filter(Boolean);
  return `+${formatMinutes(extraMinutes(extra))}${parts.length > 0 ? ` (${parts.join(', ')})` : ''}`;
}

/** „350 m od trasy”, „1,2 km od miejsca”. */
export function extraDistanceText(extra: Pick<DayExtraItem, 'along' | 'offM'>): string {
  const distance = extra.offM < 1000 ? `${Math.max(10, Math.round(extra.offM / 10) * 10)} m` : `${(extra.offM / 1000).toFixed(1).replace('.', ',')} km`;
  return `${distance} od ${extra.along === 'at' ? 'miejsca' : extra.along === 'car' ? 'drogi' : 'trasy'}`;
}

/** Wstawiony dodatek, którego punktu już nie ma w dniu, wraca na listę. */
const stillAdded = (doc: Doc, dayRef: string, extra: DayExtraItem) => extra.status === 'added' && doc.items.some((item) => item.ref === extra.addedRef && item.dayRef === dayRef);

/** Lista dnia do pokazania: otwarte (od najmniejszego dodatkowego czasu) i odrzucone osobno. */
export function dayExtras(doc: Doc, dayRef: string): { open: DayExtraItem[]; dismissed: DayExtraItem[]; fetchedAt?: string } {
  const day = doc.days.find((each) => each.ref === dayRef);
  const items = day?.extras?.items ?? [];
  const open = items.filter((each) => each.status !== 'dismissed' && !stillAdded(doc, dayRef, each)).sort((a, b) => extraMinutes(a) - extraMinutes(b));
  return { open, dismissed: items.filter((each) => each.status === 'dismissed'), ...(day?.extras ? { fetchedAt: day.extras.fetchedAt } : {}) };
}

/** Przy punktach planu: ile dodatków jest obok i ile może go zastąpić. */
export function itemExtras(doc: Doc, dayRef: string): Map<string, { near: DayExtraItem[]; swaps: DayExtraItem[] }> {
  const marks = new Map<string, { near: DayExtraItem[]; swaps: DayExtraItem[] }>();
  const of = (ref: string) => marks.get(ref) ?? marks.set(ref, { near: [], swaps: [] }).get(ref)!;
  for (const extra of dayExtras(doc, dayRef).open) {
    if (extra.nearRef) of(extra.nearRef).near.push(extra);
    if (extra.swapRef) of(extra.swapRef).swaps.push(extra);
  }
  return marks;
}

function withExtra(doc: Doc, dayRef: string, id: string, change: (extra: DayExtraItem) => DayExtraItem): Doc['days'][number] | null {
  const day = doc.days.find((each) => each.ref === dayRef);
  if (day?.extras === undefined || !day.extras.items.some((each) => each.id === id)) return null;
  return { ...day, extras: { ...day.extras, items: day.extras.items.map((each) => (each.id === id ? change(each) : each)) } };
}

/** Odrzucenie albo przywrócenie dodatku (zapis dnia, jak inne ustawienia dnia). */
export function setExtraDismissed(doc: Doc, dayRef: string, id: string, dismissed: boolean): RulesEdit | null {
  const day = withExtra(doc, dayRef, id, ({ status: _status, addedRef: _added, ...rest }) => (dismissed ? { ...rest, status: 'dismissed' } : rest));
  if (day === null) return null;
  return { doc: { ...doc, days: doc.days.map((each) => (each.ref === dayRef ? day : each)) }, writes: [{ collection: 'days', element: day, op: 'update' }], changed: [] };
}

/**
 * Wstawia dodatek do planu zaraz po punkcie, przy którym leży (bez niego — na koniec dnia): punkt z puli
 * przechodzi do dnia, atrakcja z OSM staje się nowym miejscem i punktem z czasem na miejscu. Przy drodze
 * przejazdu autem zostaje postojem w trasie, więc jej czas wydłuża przejazd. Dodatek dostaje znacznik `added`.
 */
export function addExtraToPlan(doc: Doc, dayRef: string, id: string, ids: { itemId: string; placeId: string }): PlanEdit | null {
  const extra = doc.days.find((each) => each.ref === dayRef)?.extras?.items.find((each) => each.id === id);
  if (extra === undefined) return null;
  const near = extra.nearRef === undefined ? undefined : doc.items.find((item) => item.ref === extra.nearRef && item.dayRef === dayRef);
  const afterRef = near === undefined ? (doc.items.filter((item) => item.dayRef === dayRef && item.parentRef === undefined).sort((a, b) => (a.sortKey ?? '').localeCompare(b.sortKey ?? '')).at(-1)?.ref ?? null) : (near.parentRef ?? near.ref);
  let base = doc;
  let ref: string;
  const places: NonNullable<PlanEdit['places']> = [];
  if (extra.poolRef !== undefined && doc.items.some((item) => item.ref === extra.poolRef && item.dayRef === undefined)) {
    ref = extra.poolRef;
  } else {
    const place: Doc['places'][number] = {
      ref: `id-${ids.placeId}`,
      name: extra.title,
      lat: extra.lat,
      lng: extra.lng,
      provider: 'osm',
      links: extra.website ? [{ label: 'strona', url: extra.website }] : [],
      ...(extra.type ? { category: extra.type } : {}),
    };
    ref = `id-${ids.itemId}`;
    const item: Item = {
      ref,
      kind: 'visit',
      planStatus: 'candidate',
      title: extra.title,
      placeRef: place.ref,
      durationMin: extra.fit === 'pass' ? 0 : extra.stayMin,
      ...(extra.why ? { description: extra.why } : {}),
      ...(extra.weather ? { weather: extra.weather } : {}),
      priority: 'optional',
      replacesRefs: [],
      routeParentRefs: [],
      variantRefs: [],
      links: extra.wikipedia ? [{ label: 'Wikipedia', url: extra.wikipedia }] : [],
      notes: [],
    };
    places.push({ place, created: true });
    base = { ...doc, places: [...doc.places, place], items: [...doc.items, item] };
  }
  const moved = moveAfter(base, ref, dayRef, afterRef);
  if (moved === null) return null;
  let edit: PlanEdit = moved;
  // Przy drodze przejazdu autem: postój w trasie tego przejazdu.
  if (extra.along === 'car' && near?.kind === 'transport') {
    const stop = setRouteStop(edit.doc, ref, true);
    if (stop !== null) edit = { doc: stop.doc, changed: [...edit.changed.filter((each) => each.ref !== ref), ...stop.changed] };
  }
  const day = withExtra(edit.doc, dayRef, id, (each) => ({ ...each, status: 'added', addedRef: ref }))!;
  const nextDoc = { ...edit.doc, days: edit.doc.days.map((each) => (each.ref === dayRef ? day : each)) };
  const created = places.length > 0 ? edit.changed.find((each) => each.ref === ref) : undefined;
  return {
    doc: nextDoc,
    changed: edit.changed.filter((each) => each !== created),
    ...(created ? { created } : {}),
    ...(places.length > 0 ? { places } : {}),
    others: [{ collection: 'days', element: day }],
  };
}

/** Pinezki otwartych dodatków dnia na mapę (bez numerów, `extra.ref` = `extra:<id>`). */
export function extraPins(doc: Doc, dayRef: string): MapPin[] {
  return dayExtras(doc, dayRef).open.map((extra) => ({ placeRef: `extra:${extra.id}`, name: extra.title, lat: extra.lat, lng: extra.lng, stops: [], extra: { ref: `extra:${extra.id}`, title: extra.title } }));
}
