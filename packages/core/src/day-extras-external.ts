import { z } from 'zod';

import {
  applyExtraPicks,
  dayCorridor,
  EXTRA_CATEGORY,
  EXTRA_RADIUS_M,
  type ExtraFilter,
  extraFilterText,
  type ExtraCandidate,
  type ExtraPick,
  placeAnywhere,
  passesExtraFilter,
  placeOnCorridor,
  SPOT_DRIVE_M,
} from './day-extras.ts';
import type { DaySchedule } from './engine/schedule.ts';
import { instantToZoned } from './engine/time.ts';
import { dayLodging, formatMinutes } from './plan-info.ts';
import type { RulesEdit } from './plan-rules.ts';
import { plainName } from './place-list.ts';
import { distanceM, type LngLat, simplifyPath } from './polyline.ts';
import { HttpUrl } from './schemas/common.ts';
import type { TripDocument } from './schemas/trip-document.ts';

/**
 * „Po drodze i w pobliżu” z zewnętrznego AI (ChatGPT, Claude, Gemini w przeglądarce — z wyszukiwaniem w sieci):
 * aplikacja daje wytyczne z danymi dnia (`externalExtrasBrief`: plan z godzinami i współrzędnymi, trasa przejazdów,
 * zasięg, czego nie powtarzać, format odpowiedzi), a odpowiedź w ustalonym formacie JSON (`ExternalExtras`) wczytuje
 * do listy dnia (`importExternalExtras`): odległość, objazd i punkt planu, przy którym leży, liczy kod, jak dla OSM.
 * Nic nie idzie do serwera poza zapisem dnia; plik z wytycznymi zawiera tylko wiek uczestników, bez nazwisk.
 */

type Doc = TripDocument;

export const EXTERNAL_EXTRAS_FORMAT = 'expeditionplan.day-extras/1';
/** Dalej od trasy i miejsc dnia nic nie wchodzi (zewnętrzne AI czasem myli miejsca o tej samej nazwie). */
export const EXTERNAL_MAX_OFF_M = 25_000;
/** Najwięcej pozycji w jednej odpowiedzi. */
export const EXTERNAL_MAX_ITEMS = 80;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : undefined));

/** Jedna atrakcja w odpowiedzi zewnętrznego AI. Liczby mogą przyjść jako tekst; nieznane `fit` = krótki postój. */
export const ExternalExtra = z.object({
  title: z.string().trim().min(1).max(120),
  type: optionalText(60),
  why: optionalText(600),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  stayMin: z.coerce.number().min(0).max(480).catch(20),
  fit: z.enum(['pass', 'stop', 'visit']).catch('stop'),
  interest: z.coerce.number().int().min(1).max(3).catch(2),
  nearRef: optionalText(80),
  swapRef: optionalText(80),
  weather: z.enum(['outdoor', 'indoor', 'any']).nullish().catch(undefined),
  wikipedia: HttpUrl.nullish().catch(undefined),
  website: HttpUrl.nullish().catch(undefined),
});

export const ExternalExtras = z.object({
  format: z.string().optional(),
  /** Data dnia z wytycznych — inna niż dnia, do którego wczytujemy, to pomyłka. */
  date: z.string().optional(),
  items: z.array(ExternalExtra).max(EXTERNAL_MAX_ITEMS),
});
export type ExternalExtrasInput = z.infer<typeof ExternalExtras>;

const fixed = (value: number) => value.toFixed(5);
const point = ([lng, lat]: LngLat) => `${fixed(lat)},${fixed(lng)}`;

/** Linia do wytycznych: uproszczona, by nie zalać tekstu tysiącami punktów. */
function briefLine(line: readonly LngLat[], toleranceM: number, max: number): LngLat[] {
  let out = simplifyPath(line, toleranceM);
  for (let tolerance = toleranceM * 2; out.length > max; tolerance *= 2) out = simplifyPath(line, tolerance);
  return out;
}

const km = (meters: number) => `${(meters / 1000).toLocaleString('pl-PL', { maximumFractionDigits: 1 })} km`;

/** Wytyczne dla zewnętrznego AI (Markdown) — dzień z godzinami silnika i wariantami oglądanymi w planie. */
export function externalExtrasBrief(doc: Doc, dayRef: string, schedule: DaySchedule, filter?: ExtraFilter): string {
  const day = doc.days.find((each) => each.ref === dayRef);
  if (day === undefined) return '';
  const items = new Map(doc.items.map((item) => [item.ref, item]));
  const places = new Map(doc.places.map((place) => [place.ref, place]));
  const lodging = dayLodging(doc, dayRef);
  const corridor = dayCorridor(
    doc,
    schedule.items.map((each) => each.ref),
    lodging?.placeRef,
  );
  const drives = corridor.paths.some((path) => path.mode === 'car');
  const placeText = (ref: string | undefined) => {
    const place = ref === undefined ? undefined : places.get(ref);
    if (place === undefined) return '';
    return place.lat === undefined || place.lng === undefined ? place.name : `${place.name} (${fixed(place.lat)}, ${fixed(place.lng)})`;
  };
  const planRows = schedule.items.map((each) => {
    const item = items.get(each.ref);
    const leg = item?.leg;
    const where = leg ? [placeText(leg.fromPlaceRef), placeText(leg.toPlaceRef)].filter(Boolean).join(' → ') : placeText(item?.placeRef);
    const how = leg ? `przejazd: ${leg.mode}` : each.kind;
    return `| \`${each.ref}\` | ${each.startLocal}–${each.endLocal} | ${each.title.replaceAll('|', '/')} | ${how} | ${where.replaceAll('|', '/')} |`;
  });
  const routes = corridor.paths.map((path) => {
    const title = path.ref ? (items.get(path.ref)?.title ?? path.ref) : 'odcinek między punktami';
    const line = path.mode === 'car' ? briefLine(path.coordinates, 800, 60) : briefLine(path.coordinates, 150, 40);
    return `- ${path.mode === 'car' ? 'autem' : 'pieszo'}${path.ref ? ` \`${path.ref}\`` : ''} „${title}” (${km(line.reduce((sum, at, index) => (index === 0 ? 0 : sum + distanceM(line[index - 1]!, at)), 0))}): ${line.map(point).join('; ')}`;
  });
  const listed = day.extras?.items ?? [];
  const sunset = schedule.facts.sun?.sunset;
  const ages = doc.travelers.map((each) => each.age).filter((age): age is number => typeof age === 'number');
  const example = {
    format: EXTERNAL_EXTRAS_FORMAT,
    date: day.date,
    items: [
      {
        title: 'Zamek w Przykładowie',
        type: 'zamek',
        why: 'Ruiny gotyckiego zamku na skale nad doliną; z dziedzińca widok na całą okolicę.',
        lat: 50.12345,
        lng: 19.54321,
        stayMin: 45,
        fit: 'stop',
        interest: 3,
        nearRef: schedule.items[0]?.ref ?? null,
        swapRef: null,
        weather: 'outdoor',
        wikipedia: 'https://pl.wikipedia.org/wiki/…',
        website: null,
      },
    ],
  };
  return [
    `# Atrakcje po drodze i w pobliżu — ${day.date}${day.title ? ` (${day.title})` : ''}`,
    '',
    'Pomagasz zaplanować dzień wyjazdu. Znajdź **wszystkie warte uwagi miejsca naprawdę blisko punktów dnia i przy samej trasie przejazdów** — tak, żeby niczego ciekawego nie przegapić, gdy zostanie czas albo coś wypadnie z planu. Korzystaj z wyszukiwania w sieci i map (OpenStreetMap, Wikipedia, Google Maps, przewodniki).',
    '',
    '## Zasady',
    `1. Zasięg: do ${km(EXTRA_RADIUS_M.at)} pieszo od miejsc punktów i od tras pieszych, do ${km(EXTRA_RADIUS_M.car)} od drogi przejazdów autem${drives ? `, a że dzień jest autem — do ${km(SPOT_DRIVE_M)} od miejsc punktów (krótki podjazd)` : ''}. Dalej (do ${km(EXTERNAL_MAX_OFF_M)}) tylko miejsca wyjątkowe, warte objazdu.`,
    '2. Najważniejsze jest to, co tuż obok: zamki, ruiny, punkty widokowe, wodospady, jaskinie, muzea, klasztory, ciekawe kościoły i zabytki, rezerwaty, miejsca znane z przewodników. Pomiń drobiazgi (zwykłe pomniki, przydrożne kapliczki, parki osiedlowe), chyba że są wyjątkowe.',
    '3. Nie powtarzaj punktów planu (tabela niżej) ani miejsc z listy „Już na liście”.',
    '4. Współrzędne muszą być prawdziwe i sprawdzone (stopnie dziesiętne, 5 miejsc po przecinku) — to po nich aplikacja liczy odległość i objazd. Gdy nie znasz dokładnego położenia, pomiń miejsce.',
    '5. Zwykle 10–40 pozycji, od najciekawszych.',
    '6. `title`: nazwa po polsku, gdy jest znana, inaczej oryginalna. `type`: rodzaj po polsku 1–2 słowami. `why`: 1–2 zdania po polsku, co to jest i dlaczego warto; godziny otwarcia i ceny tylko sprawdzone.',
    '7. `stayMin`: realny czas na miejscu w minutach (obejrzeć z zewnątrz 5–15, krótki spacer 20–40, muzeum lub zamek ze zwiedzaniem 60–120), bez dojazdu.',
    '8. `fit`: `pass` — widać po drodze bez zatrzymywania (tuż przy trasie), `stop` — krótki postój do ok. 20 min, `visit` — zwiedzanie.',
    '8a. `interest` — atrakcyjność: 3 — wyjątkowe, znane z przewodników, warto nadłożyć drogi; 2 — warte uwagi, gdy jest się obok; 1 — drobne, lokalne. Oceniaj surowo: 3 to najwyżej kilka miejsc w dniu. Aplikacja pozwala filtrować po atrakcyjności i rodzaju (`type`).',
    '9. `nearRef`: `ref` punktu planu, przy którym leży (z tabeli), albo null. `swapRef`: `ref` punktu, który może zastąpić, gdy tamten wypadnie (podobny charakter, blisko), albo null. `weather`: `indoor` — dobre na deszcz, `outdoor`, `any`.',
    '10. `wikipedia`, `website`: pełne adresy https albo null.',
    ...(filter && (filter.categories.length > 0 || filter.minInterest > 1)
      ? [
          `10a. **Filtr użytkownika — tylko ${extraFilterText(filter)}.** Inne rodzaje i niższa atrakcyjność nie wejdą do listy, więc ich nie podawaj. \`type\` nazywaj jasno po polsku, tak by było widać rodzaj (np. „plaża”, „wodospad”, „muzeum”, „kościół”, „ruiny zamku”, „punkt widokowy”, „mural”). Rodzaje w aplikacji: ${Object.values(EXTRA_CATEGORY).join(', ')}.`,
        ]
      : []),
    '11. **Odpowiedz wyłącznie jednym blokiem JSON w formacie niżej** — bez tekstu przed i po.',
    '',
    '## Dzień',
    `- Data: ${day.date}`,
    ...(ages.length > 0 ? [`- Uczestnicy (wiek): ${ages.join(', ')}`] : doc.travelers.length > 0 ? [`- Uczestników: ${doc.travelers.length}`] : []),
    ...(schedule.slackMin !== null ? [`- Zapas czasu w planie dnia: ${formatMinutes(schedule.slackMin)}`] : []),
    ...(sunset != null ? [`- Zachód słońca: ${instantToZoned(sunset, schedule.tz).time}`] : []),
    ...(lodging?.placeRef ? [`- Nocleg: ${placeText(lodging.placeRef)}`] : []),
    '',
    '### Plan (kolejność i godziny)',
    '| ref | godziny | punkt | rodzaj | miejsce (szer., dł.) |',
    '| --- | --- | --- | --- | --- |',
    ...planRows,
    '',
    ...(routes.length > 0 ? ['### Trasy dnia (punkty szer.,dł. po kolei)', ...routes, ''] : []),
    ...(listed.length > 0 ? ['### Już na liście (nie powtarzaj)', ...listed.map((each) => `- ${each.title}${each.status === 'dismissed' ? ' (odrzucone)' : ''}`), ''] : []),
    '## Format odpowiedzi',
    '```json',
    JSON.stringify(example, null, 2),
    '```',
    '',
    'JSON Schema jednej pozycji `items[]`:',
    '```json',
    JSON.stringify(z.toJSONSchema(ExternalExtra, { io: 'input', unrepresentable: 'any' })),
    '```',
  ].join('\n');
}

/** JSON z odpowiedzi: sam obiekt, w bloku ```json albo z tekstem dookoła. */
export function parseExternalExtras(text: string): { data: ExternalExtrasInput } | { error: string } {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1];
  const source = fenced ?? text;
  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');
  if (start === -1) return { error: 'W tekście nie ma obiektu JSON — wklej odpowiedź AI w formacie z wytycznych.' };
  let raw: unknown;
  try {
    if (end <= start) throw new Error('obcięty');
    raw = JSON.parse(source.slice(start, end + 1));
  } catch {
    return { error: 'JSON jest uszkodzony (np. obcięta odpowiedź) — poproś AI o całą odpowiedź jeszcze raz.' };
  }
  // Sama tablica albo obiekt bez `items` — weź tablicę pozycji, gdy da się ją rozpoznać.
  const shaped = Array.isArray(raw) ? { items: raw } : raw;
  const parsed = ExternalExtras.safeParse(shaped);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { error: `Odpowiedź nie pasuje do formatu: ${issue ? `${issue.path.join('.') || 'całość'} — ${issue.message}` : 'nieznany błąd'}.` };
  }
  return { data: parsed.data };
}

export type ExternalSkip = { title: string; reason: string };

/**
 * Wczytanie odpowiedzi do listy dnia (dopisuje, jak szukanie zawężone): pozycje bez miejsca w zasięgu dnia,
 * już w planie albo już na liście (też odrzucone) odpadają z powodem; reszta dostaje odległość, objazd i punkt planu
 * z kodu. Klucz `ext:<szer.>,<dł.>` — ta sama atrakcja wczytana drugi raz nie dubluje się.
 */
export function importExternalExtras(
  doc: Doc,
  dayRef: string,
  refs: readonly string[],
  input: ExternalExtrasInput,
  today: string,
  filter?: ExtraFilter,
): { edit: RulesEdit | null; added: number; skipped: ExternalSkip[]; wrongDate?: string } {
  const day = doc.days.find((each) => each.ref === dayRef);
  if (day === undefined) return { edit: null, added: 0, skipped: [] };
  const corridor = dayCorridor(doc, refs, dayLodging(doc, dayRef)?.placeRef);
  const dayRefs = new Set(doc.items.filter((item) => item.dayRef === dayRef).map((item) => item.ref));
  const listed = day.extras?.items ?? [];
  const planPlaces = doc.places.filter((place) => place.lat !== undefined && place.lng !== undefined);
  const known = new Set(doc.places.map((place) => plainName(place.name)));
  const candidates: ExtraCandidate[] = [];
  const picks: ExtraPick[] = [];
  const skipped: ExternalSkip[] = [];
  for (const each of input.items) {
    const at: LngLat = [each.lng, each.lat];
    const plain = plainName(each.title);
    const id = `ext:${each.lat.toFixed(4)},${each.lng.toFixed(4)}`;
    const same = listed.find((extra) => extra.id === id || (plainName(extra.title) === plain && distanceM([extra.lng, extra.lat], at) < 1500));
    if (same !== undefined) {
      skipped.push({ title: each.title, reason: same.status === 'dismissed' ? 'odrzucone wcześniej' : 'już na liście' });
      continue;
    }
    if (known.has(plain) || planPlaces.some((place) => distanceM([place.lng!, place.lat!], at) < 60)) {
      skipped.push({ title: each.title, reason: 'już w planie' });
      continue;
    }
    if (candidates.some((other) => other.id === id || (plainName(other.name) === plain && distanceM([other.lng, other.lat], at) < 1500))) {
      skipped.push({ title: each.title, reason: 'powtórzone w odpowiedzi' });
      continue;
    }
    if (filter && !passesExtraFilter({ type: each.type, interest: each.interest }, filter)) {
      skipped.push({ title: each.title, reason: `poza filtrem (${extraFilterText(filter)})` });
      continue;
    }
    const where = placeOnCorridor(corridor, each) ?? placeAnywhere(corridor, each);
    if (where === null) {
      skipped.push({ title: each.title, reason: 'dzień nie ma miejsc na mapie' });
      continue;
    }
    if (where.offM > EXTERNAL_MAX_OFF_M) {
      skipped.push({ title: each.title, reason: `za daleko od trasy dnia (${km(where.offM)}) — sprawdź współrzędne` });
      continue;
    }
    const nearRef = each.nearRef && dayRefs.has(each.nearRef) ? each.nearRef : where.nearRef;
    candidates.push({
      id,
      name: each.title,
      type: each.type ?? 'atrakcja',
      lat: Math.round(each.lat * 1e5) / 1e5,
      lng: Math.round(each.lng * 1e5) / 1e5,
      along: where.along,
      offM: where.offM,
      detourMin: where.detourMin,
      ...(nearRef ? { nearRef } : {}),
      ...(each.wikipedia ? { wikipedia: each.wikipedia } : {}),
      ...(each.website ? { website: each.website } : {}),
      weight: 1,
      score: 0,
    });
    picks.push({
      id,
      title: each.title,
      ...(each.type ? { type: each.type } : {}),
      why: each.why ?? '',
      stayMin: Math.round(each.stayMin),
      fit: each.fit,
      interest: each.interest,
      ...(each.swapRef ? { swapRef: each.swapRef } : {}),
      ...(each.weather ? { weather: each.weather } : {}),
    });
  }
  const wrongDate = input.date !== undefined && input.date !== day.date ? input.date : undefined;
  if (picks.length === 0) return { edit: null, added: 0, skipped, ...(wrongDate ? { wrongDate } : {}) };
  const next = applyExtraPicks(doc, dayRef, candidates, picks, today, true)!;
  return {
    edit: { doc: { ...doc, days: doc.days.map((each) => (each.ref === dayRef ? next : each)) }, writes: [{ collection: 'days', element: next, op: 'update' }], changed: [] },
    added: picks.length,
    skipped,
    ...(wrongDate ? { wrongDate } : {}),
  };
}
