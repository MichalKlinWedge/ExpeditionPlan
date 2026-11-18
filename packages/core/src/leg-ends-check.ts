import { dayLodging } from './plan-info.ts';
import { decodePolyline, distanceM } from './polyline.ts';
import { routeLine } from './route-library.ts';
import type { TripDocument } from './schemas/trip-document.ts';
import { sameName, setTrackEnds } from './track-ends.ts';

/**
 * „Sprawdź skąd i dokąd” (narzędzie planu na webie): przejazdy dni planu bez miejsca startu albo celu
 * i propozycje, skąd je wziąć. Kolejność źródeł: ślad lub trasa punktu z „Tras” (końce linii, nazwa
 * „Trasa z A do B” — `setTrackEnds`), linia przejazdu na mapie, nazwy w tytule punktu („z A do B”, „A → B”,
 * „do B”) pasujące do miejsc wyjazdu, a na końcu sąsiedzi w dniu: tam, gdzie kończy się poprzedni
 * punkt (na początku dnia nocleg z poprzedniej nocy), i tam, gdzie zaczyna się następny (na końcu
 * dnia nocleg tej nocy). Nic się nie zapisuje bez wyboru człowieka (`applyLegEnds`).
 */

type Doc = TripDocument;
type Item = Doc['items'][number];
type Place = Doc['places'][number];

export type LegEnd = 'from' | 'to';
export type LegEndSource = 'track' | 'line' | 'title' | 'previous' | 'next' | 'lodging';

export const LEG_END_SOURCE: Record<LegEndSource, string> = {
  track: 'z trasy punktu',
  line: 'z linii przejazdu na mapie',
  title: 'z nazwy punktu',
  previous: 'tu kończy się poprzedni punkt',
  next: 'tu zaczyna się następny punkt',
  lodging: 'nocleg',
};

export type LegEndProposal = {
  /** Stały klucz wyboru: punkt, koniec i miejsce (nowe po nazwie, bo jego ref powstaje przy każdym liczeniu od nowa). */
  key: string;
  itemRef: string;
  end: LegEnd;
  place: Place;
  /** Nowe miejsce (nazwa końca trasy bez pasującego miejsca) albo istniejące, które dostaje współrzędne ze śladu. */
  created: boolean;
  pinned: boolean;
  source: LegEndSource;
  /** Np. tytuł poprzedniego punktu albo nazwa trasy. */
  detail?: string;
};

export type LegEndsCheck = {
  /** Przejazdy dni planu z brakami, w kolejności dni i planu. */
  gaps: { itemRef: string; title: string; dayRef: string; missing: LegEnd[] }[];
  proposals: LegEndProposal[];
  /** Przejazdy bez rodzaju (`leg`): nie mają gdzie zapisać skąd i dokąd. */
  withoutLeg: { itemRef: string; title: string; dayRef: string }[];
  /** Ile przejazdów sprawdzono. */
  checked: number;
};

const normal = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Cel przejazdu: `toPlaceRef`, a bez niego miejsce punktu (tak liczy cały plan). */
const toRef = (item: Item) => item.leg?.toPlaceRef ?? item.placeRef;

/** Odmiana: „Mestii” i „Mestia”, „Szybenika” i „Szybenik”. */
function inflected(a: string, b: string): boolean {
  let common = 0;
  while (common < a.length && common < b.length && a[common] === b[common]) common += 1;
  return common >= 4 && common >= Math.max(a.length, b.length) - 2;
}

/** Nazwy końców z tytułu: „Przejazd z Kutaisi do Mestii”, „Kutaisi → Mestia”, „Wyjazd na lotnisko”. */
export function titleEnds(title: string): { from?: string; to?: string } {
  const clean = (text: string | undefined) => text?.replace(/\b\d{1,2}[:.]\d{2}\b/gu, '').replace(/\s+/gu, ' ').replace(/[(,;].*$/u, '').replace(/[.!?]+$/u, '').trim() || undefined;
  const arrow = title.split(/\s*(?:→|->|⇒|–|—)\s*|\s+-\s+/u).filter((part) => part.trim() !== '');
  if (arrow.length >= 2) return { from: clean(arrow[0]), to: clean(arrow.at(-1)) };
  const both = /(?:^|\s)(?:ze?|od|from)\s+(.+?)\s+(?:do|na|to)\s+(.+)$/iu.exec(title);
  if (both) return { from: clean(both[1]), to: clean(both[2]) };
  const to = /(?:^|\s)(?:do|na|to)\s+(.+)$/iu.exec(title);
  if (to) return { to: clean(to[1]) };
  const from = /(?:^|\s)(?:ze?|od|from)\s+(.+)$/iu.exec(title);
  return from ? { from: clean(from[1]) } : {};
}

/** Miejsca, z których korzystają punkty dnia (i baza dnia). */
function dayPlaces(doc: Doc, dayRef: string): Set<string> {
  const used = new Set<string>();
  for (const item of doc.items) {
    if (item.dayRef !== dayRef) continue;
    for (const ref of [item.placeRef, item.leg?.fromPlaceRef, item.leg?.toPlaceRef]) if (ref !== undefined) used.add(ref);
  }
  const base = doc.days.find((day) => day.ref === dayRef)?.baseRef;
  if (base !== undefined) used.add(base);
  return used;
}

/** Miejsce o nazwie z tytułu: dokładna nazwa, odmiana albo zawieranie, wyżej używane tego dnia. Remis różnych miejsc = brak. */
function placeByName(doc: Doc, typed: string, used: Set<string>): Place | undefined {
  const wanted = normal(typed);
  if (wanted.length < 3) return undefined;
  const scored = doc.places.flatMap((place) => {
    const names = [place.name, place.searchName].filter((name): name is string => name !== undefined).map(normal);
    const score = names.some((name) => name === wanted) ? 3 : names.some((name) => inflected(name, wanted)) ? 2 : sameName(place, typed) ? 1 : 0;
    return score === 0 ? [] : [{ place, score: score + (used.has(place.ref) ? 0.5 : 0) }];
  });
  scored.sort((a, b) => b.score - a.score);
  const [best, second] = scored;
  if (best === undefined || (second !== undefined && second.score === best.score)) return undefined;
  return best.place;
}

/** Linia punktu: ślad lub trasa z „Tras”, a bez nich linia przejazdu (`leg.geometry`). */
function itemLine(doc: Doc, item: Item): { name: string | null; coordinates: number[][]; source: 'track' | 'line'; detail?: string } | undefined {
  const ref = item.leg?.trackRef ?? item.activity?.trackRef;
  const track = ref === undefined ? undefined : doc.tracks.find((each) => each.ref === ref);
  if (track !== undefined) {
    const line = routeLine(track);
    const ends = track.route?.from !== undefined && track.route.to !== undefined ? { from: track.route.from, to: track.route.to } : undefined;
    const named = ends !== undefined ? `Trasa z ${ends.from.name} do ${ends.to.name}` : track.name;
    const coordinates = line ?? (ends !== undefined ? [[ends.from.lng, ends.from.lat], [ends.to.lng, ends.to.lat]] : undefined);
    if (coordinates !== undefined) return { name: named, coordinates, source: 'track', detail: track.name };
  }
  const geometry = item.leg?.geometry === undefined ? [] : decodePolyline(item.leg.geometry);
  return geometry.length >= 2 ? { name: null, coordinates: geometry, source: 'line' } : undefined;
}

/** Punkty dnia w kolejności planu, z tego samego wariantu co przejazd. */
function dayOrder(doc: Doc, item: Item): Item[] {
  const fits = (each: Item) => each.variantRefs.length === 0 || item.variantRefs.length === 0 || each.variantRefs.some((ref) => item.variantRefs.includes(ref));
  return doc.items
    .filter((each) => each.dayRef === item.dayRef && each.parentRef === undefined && (each.ref === item.ref || (each.planStatus === 'scheduled' && fits(each))))
    .sort((a, b) => (a.sortKey ?? '').localeCompare(b.sortKey ?? ''));
}

/**
 * Sąsiad z miejscem: poprzedni punkt (gdzie się skończył) albo następny (gdzie się zaczyna). Przejazd bez
 * tego końca przerywa szukanie — dalszy punkt nie mówi, skąd ruszamy.
 */
function neighbour(list: Item[], direction: 'previous' | 'next'): { ref: string; title: string } | undefined {
  for (const each of list) {
    const ref = direction === 'previous' ? toRef(each) : each.kind === 'transport' ? each.leg?.fromPlaceRef : each.placeRef;
    if (ref !== undefined) return { ref, title: each.title };
    if (each.kind === 'transport') return undefined;
  }
  return undefined;
}

const proposalKey = (itemRef: string, end: LegEnd, place: Place, created: boolean) => `${itemRef}|${end}|${created ? `new:${normal(place.name)}` : place.ref}`;

/** `newId` = uuid nowego miejsca (końce śladu bez pasującego miejsca). */
export function checkLegEnds(doc: Doc, newId: () => string): LegEndsCheck {
  const dayIndex = new Map([...doc.days].sort((a, b) => a.date.localeCompare(b.date)).map((day, index) => [day.ref, index]));
  const sortedDays = [...doc.days].sort((a, b) => a.date.localeCompare(b.date));
  const transports = doc.items
    .filter((item) => item.kind === 'transport' && item.dayRef !== undefined && dayIndex.has(item.dayRef) && item.planStatus === 'scheduled')
    .sort((a, b) => dayIndex.get(a.dayRef!)! - dayIndex.get(b.dayRef!)! || (a.sortKey ?? '').localeCompare(b.sortKey ?? ''));

  const gaps: LegEndsCheck['gaps'] = [];
  const withoutLeg: LegEndsCheck['withoutLeg'] = [];
  const proposals: LegEndProposal[] = [];
  const places = new Map(doc.places.map((place) => [place.ref, place]));

  for (const item of transports) {
    const dayRef = item.dayRef!;
    if (item.leg === undefined) {
      withoutLeg.push({ itemRef: item.ref, title: item.title, dayRef });
      continue;
    }
    const missing = (['from', 'to'] as const).filter((end) => (end === 'from' ? item.leg!.fromPlaceRef : toRef(item)) === undefined);
    if (missing.length === 0) continue;
    gaps.push({ itemRef: item.ref, title: item.title, dayRef, missing });

    const chosen: Partial<Record<LegEnd, LegEndProposal>> = {};
    const known = { from: item.leg.fromPlaceRef, to: toRef(item) };
    const other = (end: LegEnd) => (end === 'from' ? (chosen.to?.place.ref ?? known.to) : (chosen.from?.place.ref ?? known.from));
    const offer = (end: LegEnd, place: Place | undefined, source: LegEndSource, extra: { created?: boolean; pinned?: boolean; detail?: string } = {}) => {
      if (place === undefined || chosen[end] !== undefined || !missing.includes(end) || other(end) === place.ref) return;
      const created = extra.created ?? false;
      chosen[end] = { key: proposalKey(item.ref, end, place, created), itemRef: item.ref, end, place, created, pinned: extra.pinned ?? false, source, ...(extra.detail !== undefined ? { detail: extra.detail } : {}) };
    };

    // 1. Ślad albo trasa punktu: końce linii.
    const line = itemLine(doc, item);
    if (line !== undefined) {
      const edit = setTrackEnds(doc, item.ref, { fromId: newId(), toId: newId() }, { name: line.name, coordinates: line.coordinates });
      const after = edit?.doc.items.find((each) => each.ref === item.ref);
      for (const end of missing) {
        const ref = end === 'from' ? after?.leg?.fromPlaceRef : after?.leg?.toPlaceRef;
        const place = ref === undefined ? undefined : edit!.doc.places.find((each) => each.ref === ref);
        if (place === undefined) continue;
        const changed = edit!.places.find((each) => each.place.ref === ref);
        offer(end, place, line.source, { created: changed?.created === true, pinned: changed !== undefined && !changed.created, ...(line.detail !== undefined ? { detail: line.detail } : {}) });
      }
    }

    // 2. Nazwy w tytule.
    const named = titleEnds(item.title);
    const used = dayPlaces(doc, dayRef);
    for (const end of missing) {
      const typed = named[end];
      if (typed !== undefined) offer(end, placeByName(doc, typed, used), 'title', { detail: typed });
    }

    // 3. Sąsiedzi w dniu i noclegi.
    const order = dayOrder(doc, item);
    const index = order.findIndex((each) => each.ref === item.ref);
    if (missing.includes('from') && chosen.from === undefined) {
      const previous = neighbour(order.slice(0, index).reverse(), 'previous');
      if (previous !== undefined) offer('from', places.get(previous.ref), 'previous', { detail: previous.title });
      else if (order.slice(0, index).every((each) => toRef(each) === undefined && each.kind !== 'transport')) {
        const before = sortedDays[dayIndex.get(dayRef)! - 1];
        const night = before === undefined ? null : dayLodging(doc, before.ref);
        if (night?.placeRef !== undefined) offer('from', places.get(night.placeRef), 'lodging', { detail: night.name });
      }
    }
    if (missing.includes('to') && chosen.to === undefined) {
      const after = order.slice(index + 1);
      const next = neighbour(after, 'next');
      if (next !== undefined) offer('to', places.get(next.ref), 'next', { detail: next.title });
      else if (after.every((each) => each.placeRef === undefined && each.kind !== 'transport')) {
        const night = dayLodging(doc, dayRef);
        if (night?.placeRef !== undefined) offer('to', places.get(night.placeRef), 'lodging', { detail: night.name });
      }
    }
    for (const end of missing) if (chosen[end] !== undefined) proposals.push(chosen[end]!);
  }
  return { gaps, proposals, withoutLeg, checked: transports.length };
}

/** Ta sama nazwa i to samo miejsce (do 50 m): dwa przejazdy z jednej trasy nie robią dwóch nowych miejsc. */
const SAME_NEW_M = 50;

export type LegEndsEdit = {
  doc: Doc;
  created: Place[];
  /** Istniejące miejsca z dopisanymi współrzędnymi ze śladu. */
  pinned: Place[];
  changed: Item[];
};

/** Wybrane propozycje do dokumentu: końce przejazdów (cel także jako miejsce punktu, gdy go nie ma) i nowe miejsca. */
export function applyLegEnds(doc: Doc, chosen: readonly LegEndProposal[]): LegEndsEdit {
  const created: Place[] = [];
  const pinned = new Map<string, Place>();
  const refOf = (proposal: LegEndProposal): string => {
    const { place } = proposal;
    if (proposal.created) {
      const twin = created.find(
        (each) => normal(each.name) === normal(place.name) && (each.lat === undefined || place.lat === undefined || distanceM([each.lng!, each.lat], [place.lng!, place.lat]) <= SAME_NEW_M),
      );
      if (twin !== undefined) return twin.ref;
      created.push(place);
    } else if (proposal.pinned && !pinned.has(place.ref)) pinned.set(place.ref, place);
    return place.ref;
  };
  const byItem = new Map<string, Item>();
  for (const proposal of chosen) {
    const item = byItem.get(proposal.itemRef) ?? doc.items.find((each) => each.ref === proposal.itemRef);
    if (item?.leg === undefined) continue;
    const ref = refOf(proposal);
    byItem.set(
      item.ref,
      proposal.end === 'from'
        ? { ...item, leg: { ...item.leg, fromPlaceRef: ref } }
        : { ...item, leg: { ...item.leg, toPlaceRef: ref }, ...(item.placeRef === undefined ? { placeRef: ref } : {}) },
    );
  }
  return {
    doc: {
      ...doc,
      places: [...doc.places.map((place) => pinned.get(place.ref) ?? place), ...created],
      items: doc.items.map((item) => byItem.get(item.ref) ?? item),
    },
    created,
    pinned: [...pinned.values()],
    changed: [...byItem.values()],
  };
}
