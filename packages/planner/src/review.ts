import { type AiClient, type AiUsage, askStructured } from '@expeditionplan/ai';
import {
  dayItems,
  distanceKm,
  instantToZoned,
  itemsForDay,
  type PlanItem,
  PlanReview,
  type ReviewCategory,
  scheduleDay,
  type StoredReview,
  type TripDocument,
} from '@expeditionplan/core';
import { z } from 'zod';

import { SYSTEM } from './prompts.ts';

/**
 * Przegląd planu z AI: model dostaje plan razem z faktami policzonymi przez kod (godziny i
 * ostrzeżenia silnika, odległości między kolejnymi punktami, miejsca bez współrzędnych, punkty bez
 * opisu) i odpowiada listą NIEZALEŻNYCH propozycji, każda z własną łatką (operacje z etapu 3).
 * Człowiek ogląda je na porównaniu z planem i stosuje albo odrzuca każdą osobno.
 */

type Doc = TripDocument;
type Item = PlanItem;

const schemaOf = (schema: z.ZodType) => JSON.stringify(z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }));

/** Kategorie, które człowiek może zaznaczyć jako „na to zwróć uwagę”. */
export const REVIEW_FOCUS: ReviewCategory[] = ['schedule', 'routes', 'map', 'descriptions', 'meals', 'variants'];

const timeLabel = (item: Item) => {
  const time = item.time;
  if (time === undefined) return undefined;
  if (time.precision === 'by') return `do ${time.end}`;
  if (time.precision === 'exact' || time.precision === 'approx' || time.precision === 'range') return `${time.precision === 'exact' ? '' : 'ok. '}${time.start}`;
  if (time.precision === 'part_of_day') return time.partOfDay;
  if (time.precision === 'relative') return `+${time.offsetMin} min`;
  return 'cały dzień';
};

const round = (km: number) => (km < 10 ? Math.round(km * 10) / 10 : Math.round(km));

/** Fakty dnia z silnika: godziny punktów, koniec, zapas, zachód, ostrzeżenia. Błąd silnika = brak faktów, nie brak przeglądu. */
function engineFacts(doc: Doc, dayRef: string) {
  try {
    const schedule = scheduleDay(doc, dayRef);
    const titles = new Map(doc.items.map((item) => [item.ref, item.title]));
    return {
      times: new Map(schedule.items.map((each) => [each.ref, `${each.startLocal}–${each.endLocal}`])),
      end: schedule.items.at(-1)?.endLocal,
      slackMin: schedule.slackMin ?? undefined,
      sunset: schedule.facts.sun?.sunset != null ? instantToZoned(schedule.facts.sun.sunset, schedule.tz).time : undefined,
      warnings: schedule.warnings.map((warning) => `${warning.severity === 'hard' ? '!' : '~'} ${warning.itemRef ? `[${warning.itemRef} „${titles.get(warning.itemRef) ?? ''}”] ` : ''}${warning.message}`),
    };
  } catch {
    return { times: new Map<string, string>(), warnings: [] as string[] };
  }
}

/**
 * Plan dla modelu z faktami z kodu. Odległość `kmFromPrevious` to linia prosta od poprzedniego
 * punktu z miejscem na mapie — model sam ocenia, czy brakuje przejazdu albo kolejność zygzakuje.
 */
export function reviewContext(doc: Doc, locked: ReadonlySet<string>) {
  const places = new Map(doc.places.map((place) => [place.ref, place]));
  const placeName = (ref: string | undefined) => (ref === undefined ? undefined : places.get(ref)?.name);
  const coordsOf = (item: Item) => {
    const place = item.placeRef === undefined ? undefined : places.get(item.placeRef);
    return place?.lat !== undefined && place.lng !== undefined ? { lat: place.lat, lng: place.lng } : undefined;
  };
  const days = doc.days.map((day) => {
    const facts = engineFacts(doc, day.ref);
    // Odległości liczone po punktach dnia w scenariuszu domyślnym (bez wyboru wariantu).
    const counted = new Set(itemsForDay(doc, day.ref).map((item) => item.ref));
    let previous: { lat: number; lng: number } | undefined;
    // Przejazd od poprzedniego punktu na mapie — wtedy odległość jest już obsłużona.
    let travelled = false;
    const items = dayItems(doc, day.ref).map((item) => {
      const here = coordsOf(item);
      const km = here && previous && counted.has(item.ref) && item.kind !== 'transport' ? round(distanceKm(previous, here)) : undefined;
      const transportBefore = travelled;
      if (counted.has(item.ref) && item.kind === 'transport') travelled = true;
      if (here && counted.has(item.ref) && item.kind !== 'transport') {
        previous = here;
        travelled = false;
      }
      const place = item.placeRef === undefined ? undefined : places.get(item.placeRef);
      return {
        ref: item.ref,
        title: item.title,
        kind: item.kind,
        ...(item.parentRef ? { parentRef: item.parentRef } : {}),
        time: timeLabel(item),
        ...(facts.times.has(item.ref) ? { engine: facts.times.get(item.ref) } : {}),
        durationMin: item.durationMin,
        ...(place ? { place: place.name, placeRef: place.ref, ...(place.lat === undefined ? { notOnMap: true } : {}) } : {}),
        ...(km !== undefined ? { kmFromPrevious: km, ...(transportBefore ? { transportBefore: true } : {}) } : {}),
        ...(item.leg
          ? {
              leg: {
                mode: item.leg.mode,
                durationMin: item.leg.durationMin,
                distanceKm: item.leg.distanceKm,
                from: placeName(item.leg.fromPlaceRef),
                to: placeName(item.leg.toPlaceRef),
                ...(item.leg.routed ? { routed: true } : {}),
              },
            }
          : {}),
        ...(item.weather ? { weather: item.weather } : {}),
        description: item.description ? (item.description.length > 160 ? `${item.description.slice(0, 160)}…` : item.description) : undefined,
        ...(locked.has(item.ref) ? { locked: true } : {}),
        ...(item.variantRefs.length > 0 ? { variantOnly: doc.variants.filter((variant) => item.variantRefs.includes(variant.ref)).map((variant) => variant.label) } : {}),
      };
    });
    const variants = doc.variantGroups
      .filter((group) => group.dayRef === day.ref && group.scope !== 'booking')
      .map((group) => ({ title: group.title, options: doc.variants.filter((variant) => variant.groupRef === group.ref).map((variant) => variant.label) }));
    return {
      ref: day.ref,
      date: day.date,
      title: day.title,
      ...(day.baseRef ? { base: placeName(day.baseRef) } : {}),
      ...(facts.end ? { ends: facts.end } : {}),
      ...(day.dayEnd ? { plannedDayEnd: day.dayEnd } : {}),
      ...(facts.slackMin !== undefined ? { slackMin: facts.slackMin } : {}),
      ...(facts.sunset ? { sunset: facts.sunset } : {}),
      ...(facts.warnings.length > 0 ? { warnings: facts.warnings } : {}),
      ...(variants.length > 0 ? { variants } : {}),
      items,
    };
  });
  const used = new Set(doc.items.flatMap((item) => [item.placeRef, item.leg?.fromPlaceRef, item.leg?.toPlaceRef].filter((ref) => ref !== undefined)));
  return {
    title: doc.trip.title,
    travelers: doc.travelers.map((each) => ({ name: each.name, age: each.age })),
    days,
    pool: doc.items.filter((item) => item.dayRef === undefined).map((item) => ({ ref: item.ref, title: item.title, kind: item.kind, area: item.area })),
    placesNotOnMap: doc.places
      .filter((place) => place.lat === undefined && used.has(place.ref))
      .map((place) => ({ ref: place.ref, name: place.name, ...(place.searchName ? { searchName: place.searchName } : {}) })),
  };
}

const FOCUS_RULE: Record<string, string> = {
  schedule: 'harmonogram — ostrzeżenia silnika (! twarde, ~ miękkie), zamknięte o tej porze, koniec po planowanym końcu dnia albo po zachodzie, ujemny zapas, za długie albo za krótkie czasy',
  routes: 'trasy i przejazdy — brak przejazdu między odległymi punktami (`kmFromPrevious` > ok. 2 km bez `transportBefore`; z `transportBefore` przejazd już jest — nie dodawaj drugiego), przejazd bez środka/czasu/dystansu albo skąd/dokąd (`set_leg`), kolejność punktów, która zygzakuje',
  map: 'mapa — miejsca poza mapą (`placesNotOnMap`, `notOnMap`) i pinezki podejrzanie daleko od reszty dnia: `set_place` z nazwą z OpenStreetMap',
  descriptions: 'opisy — punkty bez opisu albo z opisem nic niemówiącym: 1–3 zdania, co to jest i na co zwrócić uwagę na miejscu',
  meals: 'posiłki — dzień bez obiadu albo kolacji, posiłek w złym miejscu lub o złej porze',
  variants: 'plan B — dni prawie całe na zewnątrz (`weather: outdoor`) bez wariantu na deszcz',
};

export function reviewPrompt(doc: Doc, locked: ReadonlySet<string>, focus: readonly ReviewCategory[], note: string): string {
  const areas = (focus.length > 0 ? focus : REVIEW_FOCUS).filter((each) => FOCUS_RULE[each]);
  return [
    'Przegląd planu wyjazdu. Znajdź to, co najbardziej warto poprawić, i zaproponuj konkretne zmiany jako NIEZALEŻNE propozycje — każda z własną łatką (`ops`).',
    '',
    'Obszary do sprawdzenia:',
    ...areas.map((each) => `- ${FOCUS_RULE[each]}`),
    '',
    'Zasady:',
    '1. Każda propozycja musi dać się zastosować sama, bez innych: nie odwołuj się do punktów, które dodaje inna propozycja. Jedna sprawa = jedna propozycja (np. „dzień 3: przejazd z Imlil do Marrakeszu” to `add_item` przejazdu i ewentualnie `set_field` godziny dalszego punktu).',
    '2. Punkty, dni i miejsca wskazuj kluczami z planu (`itemRef`, `dayRef`, `afterItemRef`, `placeRef`). Nie wymyślaj kluczy.',
    '3. Punkty z `locked: true` zmienił człowiek — NIE ruszaj ich.',
    '4. `why` uzasadnia faktami z planu: ostrzeżenie silnika, odległość, brak opisu, godzina zachodu. Nie zgaduj cen, godzin otwarcia ani numerów linii z pamięci.',
    '5. Mapa: nie podajesz współrzędnych. `set_place.searchName` to nazwa, pod którą OpenStreetMap zna to miejsce (lokalna albo angielska, z miejscowością, np. „Kasbah Amridil, Skoura”). Miejsc prywatnych i opisowych („u znajomej”, „dom”, „w bocznych uliczkach”) nie ruszaj — przypina je człowiek.',
    '6. Przejazd dodajesz jako `add_item` z `kind: transport` i `leg` (środek, szacunkowy czas i dystans, `from`/`to` = nazwy miejsc z planu). Czasu z trasy (`routed: true`) nie zmieniaj.',
    '7. Opisy (`set_field` z `field: description`) po polsku, rzeczowo, bez cen i godzin otwarcia; nie zastępuj dobrego opisu gorszym.',
    '8. Plan B → `add_variant` (obecny plan dnia zostaje wariantem A). Nie dubluj wariantu, który dzień już ma (`variants`).',
    '9. Najwyżej 12 propozycji, od najważniejszej. Lepiej mniej i pewnych niż dużo drobiazgów. Jeśli plan w danym obszarze jest dobry — nic tam nie proponuj.',
    '10. `title` krótko i z dniem („Dzień 2: …”), `summary` 2–3 zdania o całym planie. Piszesz po polsku.',
    ...(note.trim() ? ['', `Człowiek prosi szczególnie: ${note.trim()}`] : []),
    '',
    'JSON Schema odpowiedzi:',
    schemaOf(PlanReview),
    '',
    'Plan z faktami z kodu:',
    JSON.stringify(reviewContext(doc, locked), null, 1),
  ].join('\n');
}

/** Przegląd od AI z numerami propozycji (`s1`, `s2`…), gotowy do zapisu w `ai_runs.output`. */
export async function reviewPlan(
  doc: Doc,
  locked: ReadonlySet<string>,
  options: { focus: readonly ReviewCategory[]; note: string },
  deps: { client: AiClient; timeoutMs?: number; onUsage?: (usage: AiUsage) => void },
): Promise<StoredReview> {
  const answer = await askStructured(deps.client, PlanReview, reviewPrompt(doc, locked, options.focus, options.note), {
    system: SYSTEM,
    maxTokens: 16_000,
    timeoutMs: deps.timeoutMs ?? 120_000,
    label: `${doc.trip.title} przegląd`,
    ...(deps.onUsage ? { onUsage: deps.onUsage } : {}),
  });
  return numberedReview(answer.data);
}

export function numberedReview(review: PlanReview): StoredReview {
  return { review: { ...review, suggestions: review.suggestions.map((each, i) => ({ ...each, id: `s${i + 1}` })) }, applied: [], dismissed: [] };
}

/** Propozycje jeszcze nierozstrzygnięte (bez zastosowanych i odrzuconych). */
export const pendingSuggestions = (stored: StoredReview) => stored.review.suggestions.filter((each) => !stored.applied.includes(each.id) && !stored.dismissed.includes(each.id));
