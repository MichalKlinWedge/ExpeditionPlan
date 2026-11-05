import type { TripDocument } from '../schemas/trip-document.ts';
import { dstChange, instantToZoned, MINUTE, minutesOfDay, zonedToInstant } from './time.ts';
import { moonIllumination, type SunTimes, sunTimes } from './sun.ts';
import { type DayOpening, formatInterval, minutesOutside, type OpeningContext, openingOn, parseOpeningHours } from './opening-hours.ts';

/**
 * Silnik harmonogramu dnia (SPECYFIKACJA §7). Liczy godziny punktów z kolejności, czasów trwania,
 * buforów, przejść i godzin z planu; sprawdza ograniczenia, ocenia zapas czasu i proponuje cięcia.
 *
 * Godzina z planu działa jak „nie wcześniej niż”: punkt startuje o niej, chyba że poprzednie się
 * przeciągnęły — wtedy później, a różnica (`driftMin`) to sygnał, że plan się nie spina. Tak samo
 * na webie przy planowaniu, na telefonie po „Zostajemy dłużej” i przy sprawdzaniu wyniku AI.
 */

type Doc = TripDocument;
type Item = Doc['items'][number];
type Day = Doc['days'][number];

export type Scenario = 'optimistic' | 'pessimistic';

export type ScheduleOptions = {
  /** Optymistyczny bierze dolne granice czasów trwania, pesymistyczny — górne. */
  scenario?: Scenario;
  /** Wybór wariantu w grupie: groupRef → variantRef. Domyślnie wybrany, potem rekomendowany, potem pierwszy. */
  activeVariants?: Record<string, string>;
  /** „Godzina zero”, gdy dzień jej nie ma albo użytkownik ją właśnie ustalił. */
  anchorTime?: string;
  /** Opóźnienia z „Zostajemy dłużej” (`schedule_events`). */
  delays?: { itemRef: string; minutes: number }[];
  /** Punkty wyłączone z wyliczeń (cięcia, „Pomiń”). */
  skipRefs?: string[];
  /** „Zrobione” z terenu: punkt kończy się w tej chwili (UTC ms), reszta dnia liczy się od niej. */
  done?: { itemRef: string; at: number }[];
  /**
   * „Z puli w pobliżu”: punkt z puli wstawiony w terenie do dnia — po `afterRef`, bez niego na koniec;
   * `at` (chwila wstawienia) = „nie wcześniej niż”, żeby punkt nie wypadł w przeszłości.
   */
  pulled?: { itemRef: string; dayRef: string; afterRef?: string; at?: number }[];
  /** Współrzędne dla słońca, gdy baza dnia ich nie ma. */
  coordinates?: { lat: number; lng: number };
  /** Czy dzień jest świętem w kraju celu (Nager.Date) — dla `PH` w godzinach otwarcia. Brak = nie wiadomo. */
  publicHoliday?: boolean;
};

export type ScheduledItem = {
  ref: string;
  title: string;
  kind: Item['kind'];
  start: number;
  end: number;
  startLocal: string;
  endLocal: string;
  /** Data końca, gdy punkt przechodzi przez północ. */
  endDate: string;
  /** Godzina z planu (w strefie dnia), jeśli była. */
  statedLocal?: string;
  /** O ile minut punkt startuje później, niż mówi plan. */
  driftMin: number;
  durationMin: number;
  /** Postój w trasie przejazdu: godziny to tylko przybliżone położenie w ramach przejazdu, plan pokazuje czas trwania. */
  routeStop?: true;
  /** Podpunkt, którego rodzic liczy się w tym dniu: postój w trasie albo część bloku. */
  child?: true;
  /** Przy przejeździe: ile z jego czasu to postoje w trasie. */
  routeStopsMin?: number;
  /** Odhaczony w terenie („Zrobione”) — koniec to chwila odhaczenia. */
  done?: true;
};

export type WarningKind =
  | 'late'
  | 'outside_part_of_day'
  | 'after_day_end'
  | 'closed'
  | 'constraint'
  | 'driving_after_dark'
  | 'anchor_missing'
  | 'no_coordinates';

export type ScheduleWarning = {
  kind: WarningKind;
  itemRef?: string;
  constraintIndex?: number;
  severity: 'hard' | 'soft';
  /** O ile minut przekroczono limit (dodatnie = źle). */
  minutes?: number;
  message: string;
};

export type DayFacts = {
  sun: SunTimes | null;
  /** Oświetlenie tarczy Księżyca o północy kończącej dzień, 0–1. */
  moon: number;
  dst: { fromOffsetMin: number; toOffsetMin: number } | null;
};

export type SlackRating = 'large' | 'small' | 'none' | 'negative';

export type DaySchedule = {
  dayRef: string;
  date: string;
  tz: string;
  scenario: Scenario;
  items: ScheduledItem[];
  warnings: ScheduleWarning[];
  /** Najmniejszy zapas do twardego limitu dnia (minuty); null, gdy dzień nie ma żadnego limitu. */
  slackMin: number | null;
  slack: SlackRating | null;
  facts: DayFacts;
};

const DRIVING = new Set(['car', 'rental_car', 'taxi', 'hired_driver']);

/** Okna pór dnia (minuty od północy): rano 6–12, południe 11–14, popołudnie 12–18, wieczór 17–23, noc 21–6. */
const PART_OF_DAY: Record<string, [number, number]> = {
  morning: [6 * 60, 12 * 60],
  midday: [11 * 60, 14 * 60],
  afternoon: [12 * 60, 18 * 60],
  evening: [17 * 60, 23 * 60],
  night: [21 * 60, 30 * 60],
};

const TOLERANCE_MIN = 15;

/** Początek dnia, gdy plan go nie podaje, a pierwszy punkt nie ma godziny. */
const DEFAULT_DAY_START = '08:00';

export function rateSlack(minutes: number): SlackRating {
  if (minutes < 0) return 'negative';
  if (minutes < 30) return 'none';
  if (minutes < 120) return 'small';
  return 'large';
}

/** Aktywny wariant w każdej grupie: wybór z opcji, potem `chosenRef`, rekomendowany, pierwszy. */
export function activeVariants(doc: Doc, overrides: Record<string, string> = {}): Set<string> {
  const active = new Set<string>();
  for (const group of doc.variantGroups) {
    const variants = doc.variants.filter((variant) => variant.groupRef === group.ref);
    const chosen =
      overrides[group.ref] ??
      group.chosenRef ??
      variants.find((variant) => variant.recommended)?.ref ??
      variants[0]?.ref;
    if (chosen !== undefined) active.add(chosen);
  }
  return active;
}

/**
 * Punkty dnia, które wchodzą do wyliczeń, w kolejności `sortKey`; punkty z puli wstawione w terenie
 * (`pulled`) — za wskazanym punktem, jako zaplanowane (pula w planie zostaje bez zmian).
 */
export function itemsForDay(doc: Doc, dayRef: string, options: ScheduleOptions = {}): Item[] {
  const active = activeVariants(doc, options.activeVariants);
  const excluded = new Set(options.skipRefs ?? []);
  for (const variant of doc.variants) {
    if (active.has(variant.ref)) variant.excludesRefs.forEach((ref) => excluded.add(ref));
  }

  const items = doc.items
    .filter((item) => item.dayRef === dayRef && !excluded.has(item.ref))
    .filter((item) =>
      item.variantRefs.length > 0
        ? item.variantRefs.some((ref) => active.has(ref))
        : item.planStatus === 'scheduled',
    )
    .sort((a, b) => ((a.sortKey ?? '') < (b.sortKey ?? '') ? -1 : 1));
  for (const pull of options.pulled ?? []) {
    const source = doc.items.find((item) => item.ref === pull.itemRef && item.dayRef === undefined);
    if (pull.dayRef !== dayRef || source === undefined || excluded.has(source.ref) || items.some((item) => item.ref === source.ref)) continue;
    const at = pull.afterRef === undefined ? -1 : items.findIndex((item) => item.ref === pull.afterRef);
    // Godzina: chwila wstawienia w strefie dnia (tego samego dnia), inaczej zaraz po poprzednim punkcie.
    const day = doc.days.find((each) => each.ref === dayRef);
    const local = pull.at === undefined || day === undefined ? undefined : instantToZoned(pull.at, day.tz);
    const placed: Item = { ...source, dayRef, planStatus: 'scheduled', time: local !== undefined && local.date === day!.date ? { precision: 'approx', start: local.time } : undefined };
    items.splice(at === -1 ? items.length : at + 1, 0, placed);
  }
  // Postój pamięta przejazd każdego wariantu: rodzicem jest ten, który liczy się w tym dniu.
  const counted = new Set(items.map((item) => item.ref));
  return items.map((item) => {
    if (item.parentRef === undefined || counted.has(item.parentRef)) return item;
    const here = item.routeParentRefs.find((ref) => counted.has(ref));
    return here === undefined ? item : { ...item, parentRef: here };
  });
}

function dayCoordinates(doc: Doc, day: Day, items: Item[], options: ScheduleOptions) {
  const places = new Map(doc.places.map((place) => [place.ref, place]));
  const withCoords = (ref: string | undefined) => {
    const place = ref === undefined ? undefined : places.get(ref);
    return place?.lat !== undefined && place.lng !== undefined ? { lat: place.lat, lng: place.lng } : undefined;
  };
  return (
    withCoords(day.baseRef) ??
    options.coordinates ??
    items.map((item) => withCoords(item.placeRef)).find((coords) => coords !== undefined)
  );
}

function durationOf(item: Item, scenario: Scenario): number {
  const leg = item.leg;
  const min = item.durationMin ?? leg?.durationMin;
  // Czas wpisany w punkt to cały czas punktu: bez górnej granicy z trasy i bez mnożenia „tam i z powrotem”.
  const typed = item.durationMin !== undefined || item.durationMaxMin !== undefined;
  const max = item.durationMaxMin ?? (typed ? min : (leg?.durationMaxMin ?? min));
  const base = scenario === 'pessimistic' ? max : min;
  const stops = item.stopsMin ?? 0;
  if (base !== undefined) return base * (leg?.roundTrip && !typed ? 2 : 1) + stops;
  if (item.time?.precision === 'range') return minutesOfDay(item.time.end) - minutesOfDay(item.time.start) + stops;
  return stops;
}

/**
 * Godziny otwarcia miejsca w dniu planu. Składnia OSM idzie przez pełny parser
 * (`opening-hours.ts`); tekst spoza niej („09:00–19:00, zimą do 17:00”) daje pierwszy przedział
 * jako przybliżony — dokument mówi coś więcej, czego nie umiemy policzyć.
 */
function openingFor(raw: string | undefined, date: string, ctx: OpeningContext): DayOpening | null {
  const hours = parseOpeningHours(raw);
  if (hours !== null) return openingOn(hours, date, ctx);
  const match = /(\d{1,2}):(\d{2})\s*[–-]\s*(\d{1,2}):(\d{2})/.exec(raw ?? '');
  if (match === null) return null;
  const open = Number(match[1]) * 60 + Number(match[2]);
  let close = Number(match[3]) * 60 + Number(match[4]);
  if (close <= open) close += 24 * 60;
  return { intervals: [[open, close]], approximate: true };
}

export function scheduleDay(doc: Doc, dayRef: string, options: ScheduleOptions = {}): DaySchedule {
  const day = doc.days.find((candidate) => candidate.ref === dayRef);
  if (day === undefined) throw new Error(`Nie ma dnia „${dayRef}”.`);

  const scenario = options.scenario ?? 'optimistic';
  const tz = day.tz;
  const dayList = itemsForDay(doc, dayRef, options);
  // Postoje w trasie nie są osobnym krokiem dnia: wydłużają przejazd i trafiają do wyniku zaraz po nim.
  const transports = new Set(dayList.filter((item) => item.kind === 'transport').map((item) => item.ref));
  const isStop = (item: Item) => item.parentRef !== undefined && transports.has(item.parentRef);
  // Przejazd spoza liczonego dnia (inny wariant, pominięty w terenie) nie jest rodzicem: punkt idzie po kolei jak każdy inny.
  const inDay = new Set(dayList.map((item) => item.ref));
  const parentOf = (item: Item): string | undefined => {
    const ref = item.parentRef;
    if (ref === undefined || inDay.has(ref)) return ref;
    return doc.items.find((each) => each.ref === ref)?.kind === 'transport' ? undefined : ref;
  };
  const items = dayList.filter((item) => !isStop(item));
  const stopsOf = (item: Item) => dayList.filter((each) => isStop(each) && each.parentRef === item.ref);
  const warnings: ScheduleWarning[] = [];
  const at = (time: string, zone = tz) => zonedToInstant(day.date, time, zone);
  const local = (instant: number) => instantToZoned(instant, tz);

  const coords = dayCoordinates(doc, day, dayList, options);
  const sun = coords === undefined ? null : sunTimes(day.date, coords.lat, coords.lng);
  const midnight = at('00:00');
  const sunMinutes = (instant: number | null | undefined) => (instant == null ? undefined : (instant - midnight) / MINUTE);
  const openingContext: OpeningContext = {
    publicHoliday: options.publicHoliday,
    sun: sun === null ? undefined : { sunrise: sunMinutes(sun.sunrise), sunset: sunMinutes(sun.sunset), dawn: sunMinutes(sun.civilDawn), dusk: sunMinutes(sun.civilDusk) },
  };
  const facts: DayFacts = {
    sun,
    moon: moonIllumination(zonedToInstant(day.date, '23:59', tz)),
    dst: dstChange(day.date, tz),
  };

  const delays = new Map<string, number>();
  for (const delay of options.delays ?? []) delays.set(delay.itemRef, (delays.get(delay.itemRef) ?? 0) + delay.minutes);
  const doneAt = new Map((options.done ?? []).map((each) => [each.itemRef, each.at]));

  const legsFrom = new Map(doc.legs.map((leg) => [`${leg.fromRef}>${leg.toRef}`, leg]));
  const places = new Map(doc.places.map((place) => [place.ref, place]));

  // Kotwica dla czasu względnego: z opcji, z dnia, a gdy jej brak — pierwsza chwila, w której
  // dzień może ruszyć (koniec ostatniego punktu przed „0:00”), z ostrzeżeniem.
  const anchorTime = options.anchorTime ?? day.anchorTime;
  let anchor: number | undefined = anchorTime === undefined ? undefined : at(anchorTime);

  // Początek dnia: z planu, z pierwszej podanej godziny, a gdy nie ma żadnej — 08:00. Inaczej dzień
  // bez godzin (Gruzja: „Uszguli, cały dzień”) zaczynałby się o północy.
  // Punkty przed pierwszą godziną liczymy wstecz od niej („dojazd 3 h”, potem „w Mestii ok. 13:00”).
  const scenario0 = options.scenario ?? 'optimistic';
  const firstIndex = items.findIndex((item) => item.time?.precision === 'exact' || item.time?.precision === 'approx' || item.time?.precision === 'range');
  const firstTimed = firstIndex === -1 ? undefined : items[firstIndex];
  const firstStart =
    firstTimed?.time !== undefined && 'start' in firstTimed.time ? at(firstTimed.time.start, firstTimed.time.tz ?? tz) : undefined;
  const leadMin = items
    .slice(0, Math.max(firstIndex, 0))
    .filter((item) => parentOf(item) === undefined && (item.participantRefs ?? []).length === 0)
    .reduce((sum, item) => sum + durationOf(item, scenario0) + stopsOf(item).reduce((all, stop) => all + durationOf(stop, scenario0), 0) + (item.bufferAfterMin ?? 0), 0);
  const startOfDay =
    day.dayStart !== undefined
      ? at(day.dayStart)
      : firstStart !== undefined
        ? firstStart - leadMin * MINUTE
        : at(DEFAULT_DAY_START);
  let cursor = startOfDay;
  let previous: ScheduledItem | undefined;
  const result: ScheduledItem[] = [];

  // Punkty części grupy (szpica, ekipy) idą osobnymi ścieżkami i nie przesuwają całej grupy;
  // cała grupa „schodzi się” w następnym wspólnym punkcie — po końcu najdłuższej ścieżki.
  const groupSize = doc.travelers.length;
  const lanes = new Map<string, number>();
  const laneOf = (item: Item): string | undefined => {
    // Podpunkt bloku ma własną ścieżkę nawet bez listy uczestników — dzieje się równolegle z innymi.
    const parent = parentOf(item);
    if (parent !== undefined) return `blok:${parent}:${item.ref}`;
    const refs = [...new Set(item.participantRefs ?? [])];
    return refs.length === 0 || (groupSize > 0 && refs.length >= groupSize) ? undefined : refs.sort().join(',');
  };
  const blockStart = new Map<string, number>();

  items.forEach((item, index) => {
    const time = item.time;
    const lane = laneOf(item);
    if (lane === undefined && lanes.size > 0) {
      cursor = Math.max(cursor, ...lanes.values());
      lanes.clear();
    }
    const parent = parentOf(item);
    const parentStart = parent === undefined ? undefined : blockStart.get(parent);
    const laneCursor = parentStart ?? (lane === undefined ? cursor : (lanes.get(lane) ?? cursor));
    let start = laneCursor;
    let stated: number | undefined;

    if (time !== undefined && time.precision !== 'day') {
      if (time.precision === 'relative') {
        // Podpunkt bloku liczy się od początku swojego punktu, choćby przed nim były inne podpunkty.
        const base = parentStart ?? previous?.start;
        if (time.from === 'previous' && base !== undefined) {
          stated = base + time.offsetMin * MINUTE;
        } else {
          if (anchor === undefined) {
            anchor = cursor;
            warnings.push({
              kind: 'anchor_missing',
              itemRef: item.ref,
              severity: 'soft',
              message: `Dzień nie ma „godziny zero” — przyjęto ${local(cursor).time}, po poprzednim punkcie.`,
            });
          }
          stated = anchor + time.offsetMin * MINUTE;
        }
      } else if (time.precision === 'part_of_day') {
        // Pora dnia to okno, nie godzina: punkt nie startuje przed jego początkiem, ale „spóźnienie”
        // liczy się dopiero po jego końcu (niżej, `outside_part_of_day`).
        const [from] = PART_OF_DAY[time.partOfDay]!;
        const windowStart = zonedToInstant(day.date, '00:00', time.tz ?? tz) + from * MINUTE;
        start = Math.max(laneCursor, windowStart);
      } else {
        stated = at(time.start, time.tz ?? tz);
      }
      if (stated !== undefined) start = Math.max(laneCursor, stated);
    }

    const stops = stopsOf(item).map((stop) => ({ stop, minutes: durationOf(stop, scenario) + (delays.get(stop.ref) ?? 0) }));
    const stopsMin = stops.reduce((sum, each) => sum + each.minutes, 0);
    const finished = doneAt.get(item.ref);
    // „Zrobione” przed planowanym startem (odhaczone z wyprzedzeniem) = punkt bez czasu trwania.
    const end = finished === undefined ? start + (durationOf(item, scenario) + (delays.get(item.ref) ?? 0) + stopsMin) * MINUTE : Math.max(start, finished);
    const durationMin = Math.round((end - start) / MINUTE);
    const scheduled: ScheduledItem = {
      ref: item.ref,
      title: item.title,
      kind: item.kind,
      start,
      end,
      startLocal: local(start).time,
      endLocal: local(end).time,
      endDate: local(end).date,
      driftMin: stated === undefined ? 0 : Math.round((start - stated) / MINUTE),
      durationMin,
    };
    if (stated !== undefined) scheduled.statedLocal = local(stated).time;
    if (finished !== undefined) scheduled.done = true;
    if (stops.length > 0) scheduled.routeStopsMin = stopsMin;
    if (parent !== undefined) scheduled.child = true;
    result.push(scheduled);

    // Miejsca postoju na trasie nie znamy: rozkładamy je równo w czasie jazdy, tylko po to, żeby punkt miał chwilę w ramach przejazdu.
    const driveMin = Math.max(0, durationMin - stopsMin);
    let usedMin = 0;
    stops.forEach(({ stop, minutes }, order) => {
      const stopStart = Math.min(end, start + Math.round((driveMin * (order + 1)) / (stops.length + 1) + usedMin) * MINUTE);
      const stopEnd = Math.min(end, stopStart + minutes * MINUTE);
      usedMin += minutes;
      const entry: ScheduledItem = {
        ref: stop.ref,
        title: stop.title,
        kind: stop.kind,
        start: stopStart,
        end: stopEnd,
        startLocal: local(stopStart).time,
        endLocal: local(stopEnd).time,
        endDate: local(stopEnd).date,
        driftMin: 0,
        durationMin: minutes,
        routeStop: true,
        child: true,
      };
      if (doneAt.has(stop.ref)) entry.done = true;
      result.push(entry);
    });

    // Spóźnienie względem planu: przy stałej godzinie zawsze twarde, przy przybliżonej — ponad tolerancję.
    if (scheduled.driftMin > 0 && time !== undefined) {
      const fixed = item.isFixed === true || time.precision === 'exact';
      if (fixed || scheduled.driftMin > TOLERANCE_MIN) {
        warnings.push({
          kind: 'late',
          itemRef: item.ref,
          severity: item.isFixed ? 'hard' : 'soft',
          minutes: scheduled.driftMin,
          message: `„${item.title}” zaczyna się ${scheduled.driftMin} min później, niż mówi plan (${scheduled.statedLocal} → ${scheduled.startLocal}).`,
        });
      }
    }

    if (time?.precision === 'part_of_day') {
      const [, to] = PART_OF_DAY[time.partOfDay]!;
      const startMin = (start - zonedToInstant(day.date, '00:00', time.tz ?? tz)) / MINUTE;
      if (startMin > to) {
        warnings.push({
          kind: 'outside_part_of_day',
          itemRef: item.ref,
          severity: 'soft',
          minutes: Math.round(startMin - to),
          message: `„${item.title}” wypada po porze „${time.partOfDay}”.`,
        });
      }
    }

    const opening = openingFor(item.placeRef === undefined ? undefined : places.get(item.placeRef)?.openingHours, day.date, openingContext);
    // Przejście do stacji nie „wychodzi poza godziny otwarcia” stacji — sprawdzamy tylko pobyt w miejscu.
    if (opening !== null && durationMin > 0 && item.kind !== 'transport') {
      const outside = minutesOutside(opening, (start - midnight) / MINUTE, (end - midnight) / MINUTE);
      if (outside > 0) {
        const hours = opening.intervals.map(formatInterval).join(', ');
        warnings.push({
          kind: 'closed',
          itemRef: item.ref,
          severity: opening.approximate ? 'soft' : 'hard',
          minutes: Math.round(outside),
          message:
            opening.intervals.length === 0
              ? `„${item.title}” — miejsce jest tego dnia zamknięte.`
              : `„${item.title}” wychodzi poza godziny otwarcia (${hours}).`,
        });
      }
    }

    if (item.kind === 'transport' && item.leg !== undefined && DRIVING.has(item.leg.mode) && sun?.civilDusk) {
      if (end > sun.civilDusk) {
        warnings.push({
          kind: 'driving_after_dark',
          itemRef: item.ref,
          severity: 'soft',
          minutes: Math.round((end - sun.civilDusk) / MINUTE),
          message: `Jazda „${item.title}” kończy się po zmroku (${local(sun.civilDusk).time}).`,
        });
      }
    }

    // Kursor: koniec punktu + bufor + przejście niejawne do następnego punktu.
    const next = items.slice(index + 1).find((each) => parentOf(each) === undefined);
    const leg = next === undefined ? undefined : legsFrom.get(`${item.ref}>${next.ref}`);
    const legMin =
      leg === undefined ? 0 : (scenario === 'pessimistic' ? (leg.durationMaxMin ?? leg.durationMin) : leg.durationMin) ?? 0;
    const after = end + ((item.bufferAfterMin ?? 0) + legMin) * MINUTE;
    blockStart.set(item.ref, start);
    if (lane === undefined) cursor = after;
    else if (parent === undefined) lanes.set(lane, after);
    // Podpunkt bloku nie przesuwa dnia — blok trwa tyle, ile mówi plan. Wyjątek to posiłek przy punkcie:
    // jedzą wszyscy, więc następny punkt czeka, aż skończą.
    else if (item.kind === 'meal') cursor = Math.max(cursor, after);
    previous = scheduled;
  });

  const limits = checkConstraints(doc, day, result, sun, warnings, local, at);
  if (day.dayEnd !== undefined && result.length > 0) {
    const dayEnd = at(day.dayEnd);
    const last = result.filter((each) => !each.routeStop).at(-1)!;
    limits.push(Math.round((dayEnd - last.end) / MINUTE));
    if (last.end > dayEnd) {
      warnings.push({
        kind: 'after_day_end',
        severity: 'soft',
        minutes: Math.round((last.end - dayEnd) / MINUTE),
        message: `Dzień kończy się o ${last.endLocal}, po zaplanowanym końcu ${day.dayEnd}.`,
      });
    }
  }
  // Zapas przed każdym punktem ze stałą godziną (lot, mecz, start pakietu).
  for (const item of items) {
    const entry = item.isFixed ? result.find((each) => each.ref === item.ref) : undefined;
    if (entry !== undefined) limits.push(-entry.driftMin);
  }

  const slackMin = limits.length === 0 ? null : Math.min(...limits);
  return {
    dayRef,
    date: day.date,
    tz,
    scenario,
    items: result,
    warnings,
    slackMin,
    slack: slackMin === null ? null : rateSlack(slackMin),
    facts,
  };
}

/** Ograniczenia dnia (`constraints`). Zwraca zapasy do twardych limitów w minutach. */
function checkConstraints(
  doc: Doc,
  day: Day,
  items: ScheduledItem[],
  sun: SunTimes | null,
  warnings: ScheduleWarning[],
  local: (instant: number) => { date: string; time: string },
  at: (time: string, zone?: string) => number,
): number[] {
  const limits: number[] = [];
  const byRef = new Map(items.map((item) => [item.ref, item]));

  doc.constraints.forEach((constraint, index) => {
    const target = constraint.itemRef === undefined ? undefined : byRef.get(constraint.itemRef);
    // Bez dnia, punktu i rezerwacji = cały wyjazd („bez jazdy po zmroku” z briefu) — każdy dzień.
    const tripWide = constraint.dayRef === undefined && constraint.itemRef === undefined && constraint.bookingRef === undefined;
    const onDay = tripWide || constraint.dayRef === day.ref || target !== undefined;
    if (!onDay) return;
    if (constraint.itemRef !== undefined && target === undefined) return; // punkt wycięty albo w innym wariancie

    const report = (excess: number, message: string) => {
      if (constraint.severity === 'hard') limits.push(-excess);
      if (excess > 0) {
        warnings.push({ kind: 'constraint', constraintIndex: index, itemRef: constraint.itemRef, severity: constraint.severity, minutes: excess, message });
      }
    };
    const reason = constraint.reason ? ` (${constraint.reason})` : '';
    const subject = target ?? items[items.length - 1];
    if (subject === undefined) return;

    switch (constraint.kind) {
      case 'arrive_before':
      case 'depart_before':
      case 'latest_start': {
        // Bez punktu nie wiadomo, czyj to limit („wymeldowanie 11:00” wskazuje tylko rezerwację).
        if (constraint.time === undefined || target === undefined) return;
        const limit = at(constraint.time, constraint.tz ?? day.tz);
        report(Math.round((subject.start - limit) / MINUTE), `„${subject.title}” o ${subject.startLocal}, a limit to ${constraint.time}${reason}.`);
        return;
      }
      case 'finish_before_sunset': {
        if (sun?.sunset == null) {
          warnings.push({ kind: 'no_coordinates', constraintIndex: index, severity: 'soft', message: 'Brak współrzędnych dnia — nie da się sprawdzić zachodu słońca.' });
          return;
        }
        const limit = sun.sunset - (constraint.minutes ?? 0) * MINUTE;
        report(Math.round((subject.end - limit) / MINUTE), `„${subject.title}” kończy się o ${subject.endLocal}, po zachodzie (${local(sun.sunset).time})${reason}.`);
        return;
      }
      case 'no_driving_after_dark': {
        if (sun?.civilDusk == null) {
          warnings.push({ kind: 'no_coordinates', constraintIndex: index, severity: 'soft', message: 'Brak współrzędnych dnia — nie da się sprawdzić zmroku.' });
          return;
        }
        const driving = items.filter((item) => {
          const leg = doc.items.find((candidate) => candidate.ref === item.ref)?.leg;
          return leg !== undefined && DRIVING.has(leg.mode);
        });
        const latest = driving.reduce<ScheduledItem | undefined>((last, item) => (last === undefined || item.end > last.end ? item : last), undefined);
        if (latest === undefined) return;
        report(Math.round((latest.end - sun.civilDusk) / MINUTE), `Jazda „${latest.title}” kończy się o ${latest.endLocal}, po zmroku (${local(sun.civilDusk).time})${reason}.`);
        return;
      }
      case 'min_time_at': {
        if (constraint.minutes === undefined || target === undefined) return;
        report(constraint.minutes - target.durationMin, `„${target.title}” trwa ${target.durationMin} min, a powinno co najmniej ${constraint.minutes}${reason}.`);
        return;
      }
      default:
        // must_be_open → godziny otwarcia przy punkcie; office_open_at i other wymagają danych spoza planu.
        return;
    }
  });
  return limits;
}

export type CutProposal = { itemRef: string; title: string; freesMin: number; resolves: boolean };

/**
 * Co wyciąć, gdy dzień się nie spina (scenariusz pesymistyczny): najpierw `optional`, potem
 * `should`, w kolejności `cutRank`; nigdy `must` ani punktów ze stałą godziną. Kolejne cięcia
 * aż do usunięcia twardych naruszeń.
 */
export function proposeCuts(doc: Doc, dayRef: string, options: ScheduleOptions = {}): CutProposal[] {
  const base: ScheduleOptions = { ...options, scenario: 'pessimistic' };
  const broken = (schedule: DaySchedule) =>
    (schedule.slackMin !== null && schedule.slackMin < 0) || schedule.warnings.some((warning) => warning.severity === 'hard');

  let current = scheduleDay(doc, dayRef, base);
  if (!broken(current)) return [];

  const rank = (item: Item) => [item.priority === 'optional' ? 0 : 1, item.cutRank ?? Number.MAX_SAFE_INTEGER];
  const candidates = itemsForDay(doc, dayRef, base)
    .filter((item) => item.priority !== 'must' && !item.isFixed && item.kind !== 'transport' && item.kind !== 'lodging')
    .filter((item) => item.priority !== undefined || item.cutRank !== undefined)
    .sort((a, b) => {
      const [pa, ra] = rank(a);
      const [pb, rb] = rank(b);
      return pa! - pb! || ra! - rb!;
    });

  const skipped = [...(options.skipRefs ?? [])];
  const proposals: CutProposal[] = [];
  for (const item of candidates) {
    skipped.push(item.ref);
    const next = scheduleDay(doc, dayRef, { ...base, skipRefs: skipped });
    const freesMin = (next.slackMin ?? 0) - (current.slackMin ?? 0);
    proposals.push({ itemRef: item.ref, title: item.title, freesMin, resolves: !broken(next) });
    current = next;
    if (!broken(next)) break;
  }
  return proposals;
}

/** Suma kilometrów autem z wypożyczalni vs limit w umowie (Maroko: 710 vs 680 km). */
export function checkCarKmLimit(doc: Doc): { totalKm: number; limitKm: number; overKm: number; bookingRef: string } | null {
  const car =
    doc.bookings.find((booking) => booking.kind === 'car_rental' && ['booked', 'paid'].includes(booking.status) && booking.car?.kmLimit) ??
    doc.bookings.find((booking) => booking.kind === 'car_rental' && booking.recommended && booking.car?.kmLimit);
  if (car?.car?.kmLimit === undefined) return null;

  let totalKm = 0;
  for (const day of doc.days) {
    const legs = doc.items.filter((item) => item.dayRef === day.ref && item.leg?.mode === 'rental_car' && item.leg.distanceKm !== undefined);
    const fromItems = legs.reduce((sum, item) => sum + item.leg!.distanceKm! * (item.leg!.roundTrip ? 2 : 1), 0);
    // Suma dnia z planu („246 km · 2 h 52 min”) jest pełniejsza niż odcinki, których plan nie rozpisał.
    totalKm += day.statedDriving?.distanceKm ?? fromItems;
  }
  return { totalKm, limitKm: car.car.kmLimit, overKm: Math.max(0, totalKm - car.car.kmLimit), bookingRef: car.ref };
}
