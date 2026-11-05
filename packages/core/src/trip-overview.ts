import { activeVariants, itemsForDay, type ScheduleOptions } from './engine/schedule.ts';
import { dayLodging, LIVE_BOOKING } from './plan-info.ts';
import { isRouteStop } from './route-stops.ts';
import type { TripDocument } from './schemas/trip-document.ts';
import { tripMemories, type TripMemories } from './trip-memories.ts';

/**
 * Ogólny opis wyprawy na publicznym linku: najważniejsze informacje zebrane z planu, bez AI, więc zawsze aktualne.
 * Liczą się wybrane albo polecane warianty. Tekst wpisany ręcznie przechodzi przez ustawienia linku:
 * przy ukrytych cenach wypadają zdania z kwotami, a przy ukrytych imionach cel, podsumowanie i ostrzeżenia wyjazdu.
 */

type Doc = TripDocument;
type Item = Doc['items'][number];

export type OverviewOptions = Pick<ScheduleOptions, 'activeVariants' | 'pulled'> & {
  /** Punkty z opisem z przewodnika i klucz opisu: dwa punkty z tym samym kluczem to ten sam opis. */
  guided?: ReadonlyMap<string, string>;
  hide?: { costs?: boolean; names?: boolean };
  /** Ile osób się waha: publiczny link zna tylko liczbę, nie to, kto. */
  tentative?: number;
};

export type OverviewHighlight = { ref: string; title: string; dayRef: string; dayNo: number };
export type OverviewDay = { ref: string; no: number; date: string; title?: string; summary?: string; points: string[]; lodging?: string };
export type OverviewStay = { name: string; from: string; to: string; nights: number };

export type TripOverview = {
  subtitle?: string;
  goal?: string;
  summary?: string;
  /** Kolejne bazy wyjazdu; pusta, gdy baza jest tylko jedna. */
  route: string[];
  /** Imiona; puste przy ukrytych imionach (liczba osób jest w `people`). */
  names: string[];
  /** Osoby pewne; te, które się wahają, są osobno w `tentative`. */
  people: number;
  tentative: number;
  nights: number;
  stats: TripMemories;
  /** Najdłuższa droga pieszo z nierozstrzygniętych wariantów; brak, gdy nie różni się od `stats`. */
  footMax?: { km: number; ascentM: number };
  highlights: OverviewHighlight[];
  days: OverviewDay[];
  stays: OverviewStay[];
  transport: { ref: string; kind: string; title: string; date?: string }[];
  /** Wybory jeszcze nierozstrzygnięte: pogoda czy zamknięcie to nie decyzja organizatora, a kandydaci na rezerwację to jego kuchnia. */
  choices: { ref: string; title: string; options: string[] }[];
  notes: { title?: string; body: string }[];
};

const CURRENCY_WORDS = ['zł', 'zl', 'pln', 'eur', 'euro', 'usd', 'gbp', 'chf', 'czk', 'mad', 'gel', 'hrk', 'dh', 'dirham\\p{L}*', 'lari', 'dolar\\p{L}*', 'funt\\p{L}*', 'kun\\p{L}*', 'koron\\p{L}*'];

/** Skróty, po których kropka nie kończy zdania: „Całość: ok. 11 400 zł” to jedno zdanie. */
const SENTENCE_END = /(?<=[.!?…])(?<!(?:^|[\s(])(?:ok|np|tj|ul|al|św|godz|min|tys|zob|im|m|n\.p\.m)\.)\s+|\n+/iu;

/**
 * Tekst bez zdań z kwotą („Loty dla 5 osób: 3 775 zł.”). Ceny w polach planu odfiltrowuje baza, a to jest tekst
 * wpisany ręcznie. Działa na kwotach zapisanych cyframi z walutą: „drogo” albo „3 tysiące” zostaje.
 */
export function withoutAmounts(text: string, currencies: readonly string[] = []): string {
  const words = [...CURRENCY_WORDS, ...currencies.map((each) => each.toLowerCase())].join('|');
  const amount = new RegExp(`\\d[\\d\\s.,]*(?:tys\\.?\\s*)?(?:${words})(?!\\p{L})|[€$£]\\s?\\d`, 'iu');
  if (!amount.test(text)) return text;
  return text
    .split(SENTENCE_END)
    .filter((sentence) => sentence.trim() !== '' && !amount.test(sentence))
    .join(' ');
}

const TRANSPORT = new Set(['flight', 'train', 'bus', 'ferry', 'car_rental', 'transfer', 'driver_hire']);
const HIGHLIGHTS = 12;
const HIGHLIGHTS_PER_DAY = 2;

/** To, po co się jedzie: zwiedzanie, atrakcja albo trekking, bez dojazdów, posiłków i spraw do załatwienia. */
const isSight = (item: Item) => item.kind === 'visit' || item.kind === 'activity' || (item.kind === 'transport' && item.leg?.mode === 'hike');

const nextDate = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/**
 * Kilometry pieszo przy najdłuższych wariantach: w każdej nierozstrzygniętej grupie po kolei wariant z największą
 * liczbą kilometrów, a przy równych z większym przewyższeniem. Grupa już rozstrzygnięta albo ustawiona z zewnątrz zostaje przy swoim.
 */
function longestFoot(doc: Doc, schedule: Pick<ScheduleOptions, 'activeVariants' | 'pulled'>): TripMemories {
  const stats = (activeVariants: Record<string, string>) => tripMemories(doc, { done: [], skipRefs: [], ...schedule, activeVariants });
  const picked: Record<string, string> = { ...schedule.activeVariants };
  for (const group of doc.variantGroups) {
    if (group.chosenRef !== undefined || picked[group.ref] !== undefined) continue;
    let best: { ref: string; km: number; ascentM: number } | undefined;
    for (const variant of doc.variants.filter((each) => each.groupRef === group.ref)) {
      const { footKm, ascentM } = stats({ ...picked, [group.ref]: variant.ref });
      if (best === undefined || footKm > best.km || (footKm === best.km && ascentM > best.ascentM)) best = { ref: variant.ref, km: footKm, ascentM };
    }
    if (best !== undefined) picked[group.ref] = best.ref;
  }
  return stats(picked);
}

export function tripOverview(doc: Doc, options: OverviewOptions = {}): TripOverview {
  const schedule = { ...(options.activeVariants ? { activeVariants: options.activeVariants } : {}), ...(options.pulled ? { pulled: options.pulled } : {}) };
  const hideCosts = options.hide?.costs ?? true;
  const hideNames = options.hide?.names ?? false;
  const currencies = [doc.trip.baseCurrency, ...doc.trip.fx.map((each) => each.currency)];
  const clean = (text: string | undefined) => {
    const kept = text === undefined ? '' : (hideCosts ? withoutAmounts(text, currencies) : text).trim();
    return kept === '' ? undefined : kept;
  };

  const guided = options.guided ?? new Map<string, string>();
  const active = activeVariants(doc, options.activeVariants);
  const placeName = (ref: string | undefined) => doc.places.find((place) => place.ref === ref)?.name;
  const dates = [...doc.days].sort((a, b) => a.date.localeCompare(b.date));

  const days: OverviewDay[] = [];
  const stays: OverviewStay[] = [];
  const route: string[] = [];
  const sights: (OverviewHighlight & { score: number; dayRank: number; order: number })[] = [];
  const seen = new Set<string>();
  let nights = 0;
  dates.forEach((day, index) => {
    const no = index + 1;
    const sightsOfDay = itemsForDay(doc, day.ref, schedule)
      .filter((item) => item.parentRef === undefined || isRouteStop(doc, item))
      .filter(isSight);
    let dayRank = 0;
    for (const item of sightsOfDay) {
      const guide = guided.get(item.ref);
      if (guide === undefined || seen.has(guide)) continue;
      seen.add(guide);
      sights.push({ ref: item.ref, title: item.title, dayRef: day.ref, dayNo: no, score: item.priority === 'must' ? 1 : item.priority === 'optional' ? -1 : 0, dayRank: dayRank++, order: sights.length });
    }

    const lodging = dayLodging(doc, day.ref);
    if (lodging !== null) {
      nights += 1;
      const last = stays.at(-1);
      if (last !== undefined && last.name === lodging.name && last.to === day.date) {
        last.to = nextDate(day.date);
        last.nights += 1;
      } else {
        stays.push({ name: lodging.name, from: day.date, to: nextDate(day.date), nights: 1 });
      }
    }
    const base = placeName(day.baseRef) ?? lodging?.name;
    if (base !== undefined && route.at(-1) !== base) route.push(base);

    const summary = clean(day.summary);
    days.push({
      ref: day.ref,
      no,
      date: day.date,
      ...(day.title ? { title: day.title } : {}),
      ...(summary !== undefined ? { summary } : {}),
      points: [...new Set(sightsOfDay.map((item) => item.title))],
      ...(lodging !== null ? { lodging: lodging.name } : {}),
    });
  });

  // Najważniejsze mają opis, najwyżej dwa na dzień. Przy równych ocenach po kolei z każdego dnia, żeby pierwsze dni nie zajęły całej listy.
  const perDay = new Map<string, number>();
  const highlights = [...sights]
    .sort((a, b) => b.score - a.score || a.dayRank - b.dayRank || a.order - b.order)
    .filter((sight) => {
      const taken = perDay.get(sight.dayRef) ?? 0;
      if (taken >= HIGHLIGHTS_PER_DAY) return false;
      perDay.set(sight.dayRef, taken + 1);
      return true;
    })
    .slice(0, HIGHLIGHTS)
    .sort((a, b) => a.order - b.order)
    .map(({ ref, title, dayRef, dayNo }) => ({ ref, title, dayRef, dayNo }));

  const tentative = Math.min(options.tentative ?? 0, doc.travelers.length);
  const goal = hideNames ? undefined : clean(doc.trip.goal);
  const summary = hideNames ? undefined : clean(doc.trip.summary);
  const stats = tripMemories(doc, { done: [], skipRefs: [], ...schedule });
  const longest = longestFoot(doc, schedule);

  return {
    ...(doc.trip.subtitle ? { subtitle: doc.trip.subtitle } : {}),
    ...(goal !== undefined ? { goal } : {}),
    ...(summary !== undefined ? { summary } : {}),
    route: route.length > 1 ? route : [],
    names: hideNames ? [] : doc.travelers.map((traveler) => traveler.name),
    people: doc.travelers.length - tentative,
    tentative,
    nights,
    stats,
    ...(longest.footKm > stats.footKm || longest.ascentM > stats.ascentM ? { footMax: { km: longest.footKm, ascentM: longest.ascentM } } : {}),
    highlights,
    days,
    stays,
    transport: doc.bookings
      .filter((booking) => TRANSPORT.has(booking.kind) && LIVE_BOOKING.has(booking.status))
      .filter((booking) => booking.variantGroupRef === undefined || (booking.variantRef !== undefined && active.has(booking.variantRef)))
      .sort((a, b) => (a.start?.date ?? '').localeCompare(b.start?.date ?? ''))
      .map((booking) => ({ ref: booking.ref, kind: booking.kind, title: booking.title, ...(booking.start ? { date: booking.start.date } : {}) })),
    choices: doc.variantGroups.flatMap((group) => {
      const variants = doc.variants.filter((variant) => variant.groupRef === group.ref);
      return group.conditionKind === 'choice' && group.scope !== 'booking' && group.chosenRef === undefined && variants.length > 1 ? [{ ref: group.ref, title: group.title, options: variants.map((variant) => variant.label) }] : [];
    }),
    notes: doc.notes.flatMap((note) => {
      const body = !hideNames && note.scope === 'trip' && (note.kind === 'warning' || note.kind === 'safety') ? clean(note.body) : undefined;
      return body === undefined ? [] : [{ ...(note.title ? { title: note.title } : {}), body }];
    }),
  };
}
