import { type AiClient, type AiUsage, askStructured } from '@expeditionplan/ai';
import {
  corridorQueryLines,
  type DayCorridor,
  type ExtraCandidate,
  type ExtraPick,
  instantToZoned,
  type LngLat,
  type OsmFeature,
  scheduleDay,
  type ScheduleOptions,
  type TripDocument,
} from '@expeditionplan/core';
import { z } from 'zod';

import { SYSTEM } from './prompts.ts';
import { parseTrackOverpass } from './track-osm.ts';
import { bboxAround, OVERPASS_UA, OVERPASS_URL } from './transit-osm.ts';

/**
 * „Po drodze i w pobliżu” dnia: jedno zapytanie Overpass na kliknięcie (te same warunki serwera FOSSGIS co
 * ślad GPX i linie komunikacji: identyfikujący User-Agent, e-mail operatora na stronie, podpis
 * „© OpenStreetMap” przy liście), potem AI wybiera z kandydatów policzonych przez kod (`core/day-extras.ts`).
 * AI nie dopisuje miejsc spoza listy i nie podaje odległości — te są z kodu.
 */

type Doc = TripDocument;

/** Atrakcje z nazwą i znane (Wikidata) — kilka filtrów na każdą linię korytarza. */
const FILTERS = [
  'nwr[~"^(tourism|historic|natural)$"~"^(attraction|viewpoint|museum|gallery|zoo|aquarium|castle|fort|ruins|archaeological_site|city_gate|palace|monastery|manor|tower|waterfall|cave_entrance|arch|gorge|hot_spring|geyser|volcano)$"][name]',
  'nwr[wikidata][~"^(historic|natural|man_made|leisure)$"~"."][name]',
  'nwr[wikidata][amenity=place_of_worship][name]',
  'nwr[wikidata][building~"^(cathedral|church|mosque|temple|chapel)$"][name]',
];

const SERVER_TIMEOUT_S = 60;
/** Najwięcej elementów w odpowiedzi — w dużym mieście atrakcji są setki, a AI dostaje 40. */
const MAX_ELEMENTS = 600;

const coords = (line: readonly LngLat[]) => line.map(([lng, lat]) => `${lat.toFixed(5)},${lng.toFixed(5)}`).join(',');

/** Zapytanie: atrakcje w pasie wokół miejsc i przejść (700 m) i wokół dróg przejazdów (2 km), w prostokącie dnia. */
export function dayExtrasQuery(lines: { near: LngLat[][]; car: LngLat[][] }): string {
  const all = [...lines.near, ...lines.car].flat();
  const box = bboxAround(all, 3);
  const bbox = [box.south, box.west, box.north, box.east].map((value) => value.toFixed(5)).join(',');
  const parts = [
    ...lines.near.flatMap((line) => FILTERS.map((filter) => `${filter}(around:700,${coords(line)});`)),
    ...lines.car.flatMap((line) => FILTERS.map((filter) => `${filter}(around:2000,${coords(line)});`)),
  ];
  return [`[out:json][timeout:${SERVER_TIMEOUT_S}][maxsize:67108864][bbox:${bbox}];`, `(${parts.join(' ')});`, `out center tags qt ${MAX_ELEMENTS};`].join('\n');
}

/** Atrakcje OSM w korytarzu dnia. Błąd serwera (przeciążenie, 429) to wyjątek z polskim opisem. */
export async function fetchDayAttractions(corridor: DayCorridor, options: { url?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {}): Promise<OsmFeature[]> {
  const lines = corridorQueryLines(corridor);
  if (lines.near.length + lines.car.length === 0) return [];
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(options.url ?? OVERPASS_URL, {
    method: 'POST',
    headers: { 'User-Agent': OVERPASS_UA, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ data: dayExtrasQuery(lines) }).toString(),
    signal: AbortSignal.timeout(options.timeoutMs ?? (SERVER_TIMEOUT_S + 10) * 1000),
  });
  if ([429, 502, 503, 504].includes(response.status)) throw new Error('Serwer OpenStreetMap (Overpass) jest teraz zajęty. Spróbuj za minutę.');
  if (!response.ok) throw new Error(`Serwer OpenStreetMap (Overpass) odpowiedział błędem ${response.status}.`);
  return parseTrackOverpass(await response.json());
}

/** Odpowiedź AI: wybór z listy kandydatów. */
export const DayExtrasAnswer = z.object({
  picks: z
    .array(
      z.object({
        id: z.string().min(1),
        title: z.string().min(1),
        type: z.string().nullish(),
        why: z.string(),
        stayMin: z.number().int().min(0).max(480),
        fit: z.enum(['pass', 'stop', 'visit']),
        swapRef: z.string().nullish(),
        weather: z.enum(['outdoor', 'indoor', 'any']).nullish(),
      }),
    )
    .max(15),
});

const clip = (text: string | undefined, max: number) => (text === undefined ? undefined : text.length > max ? `${text.slice(0, max)}…` : text);

/** Dzień z faktami silnika (godziny, zapas, zachód) i kandydaci z faktami z kodu — dla modelu. */
export function dayExtrasContext(doc: Doc, dayRef: string, options: ScheduleOptions, candidates: readonly ExtraCandidate[]) {
  const day = doc.days.find((each) => each.ref === dayRef)!;
  const places = new Map(doc.places.map((place) => [place.ref, place.name]));
  let schedule: ReturnType<typeof scheduleDay> | null = null;
  try {
    schedule = scheduleDay(doc, dayRef, options);
  } catch {
    schedule = null;
  }
  const items = new Map(doc.items.map((item) => [item.ref, item]));
  return {
    date: day.date,
    title: day.title,
    travelers: doc.travelers.map((each) => ({ age: each.age })),
    ...(schedule?.slackMin != null ? { slackMin: schedule.slackMin } : {}),
    ...(schedule?.facts.sun?.sunset != null ? { sunset: instantToZoned(schedule.facts.sun.sunset, schedule.tz).time } : {}),
    plan: (schedule?.items ?? []).map((each) => {
      const item = items.get(each.ref);
      return {
        ref: each.ref,
        title: each.title,
        kind: each.kind,
        time: `${each.startLocal}–${each.endLocal}`,
        ...(item?.placeRef ? { place: places.get(item.placeRef) } : {}),
        ...(item?.leg ? { mode: item.leg.mode } : {}),
        ...(item?.weather ? { weather: item.weather } : {}),
        ...(item?.description ? { description: clip(item.description, 120) } : {}),
      };
    }),
    candidates: candidates.map((each) => ({
      id: each.id,
      name: each.name,
      type: each.type,
      along: each.along,
      offM: each.offM,
      detourMin: each.detourMin,
      ...(each.nearRef ? { nearRef: each.nearRef } : {}),
      ...(each.wikipedia ? { wikipedia: decodeURIComponent(each.wikipedia.replace(/^https:\/\//, '')) } : {}),
      ...(each.openingHours ? { openingHours: each.openingHours } : {}),
      ...(each.note ? { note: clip(each.note, 200) } : {}),
    })),
  };
}

export function dayExtrasPrompt(doc: Doc, dayRef: string, options: ScheduleOptions, candidates: readonly ExtraCandidate[]): string {
  return [
    'Dzień planu wyjazdu i lista atrakcji w pobliżu jego punktów i trasy (z OpenStreetMap i z puli pomysłów wyjazdu). Wybierz te, które warto znać na wypadek, gdy zostanie czas albo coś wypadnie z planu.',
    '',
    'Zasady:',
    '1. Wybieraj tylko z listy `candidates`, kluczem `id`. Nie dopisuj innych miejsc.',
    '2. Najwyżej 12, od najciekawszych. Pomiń drobiazgi (zwykłe pomniki, przeciętne kościoły, parki osiedlowe), chyba że są wyjątkowe. Kandydaci „z puli wyjazdu” to pomysły podróżnych — bierz je, gdy pasują.',
    '3. `title`: nazwa po polsku, gdy jest znana, inaczej oryginalna. `type`: rodzaj po polsku jednym-dwoma słowami. `why`: 1–2 zdania po polsku, co to jest i dlaczego warto; bez cen i godzin otwarcia z pamięci.',
    '4. `stayMin`: realny czas na miejscu (obejrzeć z zewnątrz 5–15 min, krótki spacer 20–40 min, muzeum lub zamek ze zwiedzaniem 60–120 min). Dojazdu nie wliczaj: `detourMin` policzył kod.',
    '5. `fit`: `pass` — widać po drodze bez zatrzymywania albo leży tuż przy trasie (wieża, zamek nad drogą, wodospad przy szlaku; tylko przy małym `offM`); `stop` — krótki postój do ok. 20 min na miejscu; `visit` — zwiedzanie.',
    '6. `swapRef`: `ref` punktu planu, który ta atrakcja może zastąpić, gdy tamten wypadnie (zamknięte, pogoda, brak biletów) — podobny charakter i blisko; inaczej null. `weather`: `indoor`, gdy to dobre miejsce na deszcz.',
    '7. Uwzględnij uczestników (wiek) i to, że `along: car` to zjazd z drogi autem, a `at`/`foot` — dojście pieszo.',
    '',
    'JSON Schema odpowiedzi:',
    JSON.stringify(z.toJSONSchema(DayExtrasAnswer, { io: 'input', unrepresentable: 'any' })),
    '',
    'Dzień i kandydaci:',
    JSON.stringify(dayExtrasContext(doc, dayRef, options, candidates), null, 1),
  ].join('\n');
}

/** Wybór AI z kandydatów dnia. */
export async function pickDayExtras(
  doc: Doc,
  dayRef: string,
  options: ScheduleOptions,
  candidates: readonly ExtraCandidate[],
  deps: { client: AiClient; timeoutMs?: number; onUsage?: (usage: AiUsage) => void },
): Promise<ExtraPick[]> {
  if (candidates.length === 0) return [];
  const answer = await askStructured(deps.client, DayExtrasAnswer, dayExtrasPrompt(doc, dayRef, options, candidates), {
    system: SYSTEM,
    maxTokens: 8000,
    timeoutMs: deps.timeoutMs ?? 120_000,
    label: `${doc.trip.title} po drodze`,
    ...(deps.onUsage ? { onUsage: deps.onUsage } : {}),
  });
  return answer.data.picks;
}
