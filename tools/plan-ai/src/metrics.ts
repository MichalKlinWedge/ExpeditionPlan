import { scheduleDay, type TripDocument, type WarningKind } from '@expeditionplan/core';
import { distanceKm } from '@expeditionplan/planner';

/**
 * Miary jakości planu z AI (SPECYFIKACJA §4, „Kontrola jakości AI”; kryteria PoC-1).
 */

export type PlanMetrics = {
  places: number;
  grounded: number;
  /** Miejsca konkretne (z `searchName`) — tylko te da się ugruntować; opisowe („restauracja w centrum”) nie. */
  specific: number;
  specificGrounded: number;
  scheduledItems: number;
  /** Punkty, których miejsce ma znane godziny otwarcia, i ile z nich wypada poza nimi. */
  withHours: number;
  closed: number;
  days: number;
  /** Dzień bez twardych ostrzeżeń w scenariuszu optymistycznym. */
  realizableDays: number;
  hardWarnings: number;
  warnings: Partial<Record<WarningKind, number>>;
  /** Punkty startujące > 15 min później, niż mówi godzina z planu (AI źle policzyło czas). */
  drift15: number;
  /** Przejazdy fizycznie niemożliwe: za szybko jak na tryb albo krócej niż w linii prostej. */
  implausibleLegs: string[];
  /** Posiłki o dziwnej porze po wyliczeniu godzin (kolacja o 14:10) — dzień bez kotwic czasu. */
  oddMeals: string[];
};

/** Rozsądne pory posiłków (minuty od północy) rozpoznawane po tytule. */
const MEAL_WINDOWS: [RegExp, number, number][] = [
  [/śniadani|breakfast/i, 6 * 60, 10 * 60 + 30],
  [/obiad|lunch/i, 11 * 60 + 30, 15 * 60 + 30],
  [/kolacj|dinner|wieczerz/i, 17 * 60, 22 * 60],
];

const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

const CAR = new Set(['car', 'rental_car', 'taxi', 'hired_driver', 'bus']);
const MAX_KMH: Record<string, number> = { walk: 6, hike: 6, bike: 25 };

export function evaluate(doc: TripDocument): PlanMetrics {
  const places = new Map(doc.places.map((place) => [place.ref, place]));
  const metrics: PlanMetrics = {
    places: doc.places.length,
    grounded: doc.places.filter((place) => place.lat !== undefined).length,
    specific: doc.places.filter((place) => place.searchName !== undefined).length,
    specificGrounded: doc.places.filter((place) => place.searchName !== undefined && place.lat !== undefined).length,
    scheduledItems: 0,
    withHours: 0,
    closed: 0,
    days: doc.days.length,
    realizableDays: 0,
    hardWarnings: 0,
    warnings: {},
    drift15: 0,
    implausibleLegs: [],
    oddMeals: [],
  };

  for (const day of doc.days) {
    const schedule = scheduleDay(doc, day.ref, { scenario: 'optimistic' });
    metrics.scheduledItems += schedule.items.length;
    const hard = schedule.warnings.filter((warning) => warning.severity === 'hard');
    metrics.hardWarnings += hard.length;
    if (hard.length === 0) metrics.realizableDays++;
    for (const warning of schedule.warnings) metrics.warnings[warning.kind] = (metrics.warnings[warning.kind] ?? 0) + 1;
    metrics.drift15 += schedule.items.filter((item) => item.driftMin > 15).length;
    for (const item of schedule.items.filter((each) => each.kind === 'meal')) {
      const window = MEAL_WINDOWS.find(([pattern]) => pattern.test(item.title));
      const start = minutesOf(item.startLocal);
      if (window !== undefined && (start < window[1] || start > window[2])) metrics.oddMeals.push(`${day.ref} ${item.startLocal} ${item.title}`);
    }

    const items = doc.items.filter((item) => schedule.items.some((each) => each.ref === item.ref));
    for (const item of items) {
      if (item.placeRef !== undefined && places.get(item.placeRef)?.openingHours !== undefined) metrics.withHours++;
    }
    metrics.closed += schedule.warnings.filter((warning) => warning.kind === 'closed').length;

    // Przejazd vs położenie miejsc przed nim i po nim (gdy oba są ugruntowane).
    const ordered = schedule.items.map((each) => doc.items.find((item) => item.ref === each.ref)!);
    ordered.forEach((item, i) => {
      const leg = item.leg;
      if (item.kind !== 'transport' || leg === undefined || leg.durationMin === undefined || leg.durationMin === 0) return;
      const hours = leg.durationMin / 60;
      const limit = CAR.has(leg.mode) ? 110 : MAX_KMH[leg.mode];
      if (limit !== undefined && leg.distanceKm !== undefined && leg.distanceKm / hours > limit * 1.15) {
        metrics.implausibleLegs.push(`${item.ref}: ${leg.distanceKm} km w ${leg.durationMin} min (${leg.mode})`);
        return;
      }
      const from = placeOf(ordered.slice(0, i).reverse(), places, leg.fromPlaceRef);
      const to = placeOf(ordered.slice(i + 1), places, leg.toPlaceRef);
      if (from === undefined || to === undefined || limit === undefined) return;
      const straight = distanceKm(from, to);
      if (straight / hours > limit * 1.15 || (leg.distanceKm !== undefined && leg.distanceKm < straight * 0.9)) {
        metrics.implausibleLegs.push(`${item.ref}: ${Math.round(straight)} km w linii prostej, plan: ${leg.distanceKm ?? '?'} km w ${leg.durationMin} min (${leg.mode})`);
      }
    });
  }
  return metrics;
}

type Place = TripDocument['places'][number];

function placeOf(items: TripDocument['items'], places: Map<string, Place>, explicit: string | undefined) {
  const ref = explicit ?? items.find((item) => item.kind !== 'transport' && item.placeRef !== undefined)?.placeRef;
  const place = ref === undefined ? undefined : places.get(ref);
  return place?.lat !== undefined && place.lng !== undefined ? { lat: place.lat, lng: place.lng } : undefined;
}

/**
 * Ryzyka, które widzą ręczne plany (PoC-1: „czy AI widzi te same ryzyka”). `inBrief` = brief już
 * o nim mówi, więc wykrycie jest łatwe; liczą się zwłaszcza te spoza briefu.
 */
export const EXPECTED_RISKS: Record<string, { risk: string; pattern: RegExp; inBrief: boolean }[]> = {
  maroko: [
    { risk: 'zmrok i jazda po ciemku', pattern: /zmrok|zmierzch|po ciemku|zachód słońca|przed zachodem/i, inBrief: true },
    { risk: 'godziny biura wypożyczalni', pattern: /biur\w* wypożyczalni|godzin\w* (otwarcia )?biura|odbi[oó]r auta.{0,40}(godzin|kolejk|formalno)/i, inBrief: false },
    { risk: 'limit km auta', pattern: /limit\w* (km|kilometr)|kilometr\w* limit/i, inBrief: false },
    { risk: 'gotówka (bramki, obozy)', pattern: /gotówk/i, inBrief: true },
    { risk: 'kolejki na lotnisku przed wylotem', pattern: /kolejk\w*.{0,60}lotnisk|lotnisk\w*.{0,80}(kolejk|kontrol\w* paszport|odpraw)/i, inBrief: false },
  ],
  gruzja: [
    { risk: 'nocny dojazd po przylocie', pattern: /po ciemku|nocą|w nocy|zmrok|późn\w* wieczor/i, inBrief: true },
    { risk: 'drogi górskie (Mestia, Uszguli)', pattern: /serpentyn|górsk\w* drog|droga do (mestii|uszguli)|szutr|4x4|terenow/i, inBrief: false },
    { risk: 'pogoda w górach', pattern: /pogod|mgł|burz|deszcz/i, inBrief: true },
    { risk: 'poniedziałkowe zamknięcia', pattern: /poniedział\w*.{0,40}zamkn/i, inBrief: true },
  ],
  barcelona: [
    { risk: 'święto 6.12 i zamknięte sklepy', pattern: /święt|zamknięt\w* sklep/i, inBrief: true },
    { risk: 'mecz o stałej godzinie', pattern: /mecz/i, inBrief: true },
    { risk: 'kieszonkowcy', pattern: /kieszonkow|kradzie/i, inBrief: false },
    { risk: 'wczesny wylot — wyjście 07:15', pattern: /07:15|7:15|wcze\w* wyj/i, inBrief: true },
  ],
  chatka: [
    { risk: 'chatka bez rezerwacji — kto pierwszy', pattern: /kto pierwszy|bez rezerwacji|brak miejsc|zajęt/i, inBrief: true },
    { risk: 'zmiana czasu w nocy', pattern: /zmian\w* czasu|czas zimow/i, inBrief: false },
    { risk: 'zmrok, czołówki', pattern: /zmrok|zmierzch|czołów|latark|po ciemku/i, inBrief: false },
    { risk: 'termin decyzji o Planie B', pattern: /plan b|decyzj/i, inBrief: true },
  ],
  dinara: [
    { risk: 'woda i upał na grani', pattern: /upał|wod[ayę] |zapas wody|odwodn/i, inBrief: false },
    { risk: 'sprzęt ferratowy', pattern: /lonż|uprzęż|kask/i, inBrief: true },
    { risk: 'powrót po zmroku (Čikola)', pattern: /zmrok|zmierzch|czołów|po ciemku/i, inBrief: true },
    { risk: 'przejście graniczne / zasięg (Bośnia)', pattern: /bośni|granic|esim|roaming/i, inBrief: true },
  ],
};

export function detectRisks(slug: string, text: string) {
  return (EXPECTED_RISKS[slug] ?? []).map((expected) => ({ ...expected, found: expected.pattern.test(text) }));
}
