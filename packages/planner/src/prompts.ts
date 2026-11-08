import { type PlannerPlaceMemory, plannerMemoryLine, StagePlan, type SkeletonVariant, type TripBrief, TripSkeleton } from '@expeditionplan/core';
import { z } from 'zod';

import type { Chunk } from './assemble.ts';
import type { DayFact } from './facts.ts';

/** Polecenia etapów 1 i 2 (SPECYFIKACJA §4). Kształt odpowiedzi = JSON Schema z tych samych schematów Zod. */

export const SYSTEM = [
  'Jesteś doświadczonym planistą podróży. Planujesz realnie: liczysz czas przejazdów, kolejki, posiłki,',
  'zmrok i zmęczenie dzieci; mówisz wprost, czego nie da się zmieścić. Piszesz po polsku.',
  'Odpowiadasz wyłącznie jednym obiektem JSON zgodnym z podanym JSON Schema, bez komentarza.',
].join(' ');

const schemaOf = (schema: z.ZodType) => JSON.stringify(z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }));

/**
 * Pamięć miejsc z wcześniejszych wyjazdów (`plannerMemory` w core): „[unikaj]” = ocenione „nie warto” albo już
 * odwiedzone; takie miejsce wraca tylko z wyraźnym uzasadnieniem. Bez pamięci — nic.
 */
export function memorySection(memory: readonly PlannerPlaceMemory[] = []): string[] {
  if (memory.length === 0) return [];
  return [
    'Pamięć miejsc z naszych wcześniejszych wyjazdów (oceny uczestników „warto / nie warto”, notatki na przyszłość, lata wizyt):',
    ...memory.map((each) => `- ${plannerMemoryLine(each)}`),
    'Miejsc oznaczonych „[unikaj]” (przeważa „nie warto” albo już tam byliśmy) nie proponuj ponownie. Wyjątek tylko z wyraźnym uzasadnieniem (jedyna baza albo przejazd w okolicy, życzenie z briefu, coś nowego do zrobienia na miejscu) — napisz je wtedy wprost w notatce przy punkcie albo w `rationale`. Notatki uwzględnij w planie (godziny, tłumy, parking, ceny). Miejsca ocenione „warto” możesz polecić, gdy pasują do briefu.',
    '',
  ];
}

export function stage1Prompt(brief: TripBrief, memory: readonly PlannerPlaceMemory[] = []): string {
  return [
    'Etap 1 — szkielet wyjazdu. Zaproponuj 2–3 RÓŻNE warianty układu wyjazdu (bazy, kolejność, noclegi, przejazdy).',
    '',
    'Zasady:',
    '1. Elementy z `fixed` (kupione loty, rezerwacje, mecz) są nienaruszalne — planuj wokół nich.',
    '2. Każdy wariant ma wpis w `days` dla KAŻDEGO dnia od pierwszego do ostatniego (także dzień przylotu i wylotu), `base` = gdzie śpimy po tym dniu (w dniu wylotu: skąd wyjeżdżamy na lotnisko).',
    '3. Czas i km jazdy w dniu realnie (drogi górskie, medyny, korki), zgodnie z limitami z `constraints` (np. `maxDrivingMinPerDay`, `noDrivingAfterDark`).',
    '4. `metrics`, `pros`, `cons`, `cannotFit` — uczciwie. Dokładnie jeden wariant `recommended: true`, uzasadnienie w `rationale`.',
    '5. `risks`: konkretne ryzyka wyjazdu (zmrok i jazda po ciemku, godziny biur, limity km, święta i zamknięte sklepy, kolejki na lotnisku, pogoda, miejsca bez rezerwacji…).',
    '6. `bases`: każda baza użyta w `days` z `searchName` — nazwą, pod którą miejscowość jest w OpenStreetMap (lokalna albo angielska, np. „Marrakech”, „Mestia”).',
    '',
    ...memorySection(memory),
    'JSON Schema:',
    schemaOf(TripSkeleton),
    '',
    'Brief wyjazdu:',
    JSON.stringify(brief, null, 1),
  ].join('\n');
}

export function stage2Prompt(brief: TripBrief, variant: SkeletonVariant, chunk: Chunk, facts: DayFact[], allDays: number, memory: readonly PlannerPlaceMemory[] = []): string {
  const dayList = chunk.dates.map((date, i) => `${chunk.dayRefs[i]} = ${date}`).join(', ');
  const part = chunk.refPrefix === '' ? '' : ` To część ${chunk.index + 1} wyjazdu (dni ${dayList} z ${allDays}); inne części planuje osobne zapytanie.`;
  return [
    `Etap 2 — punkty i harmonogram dla wybranego wariantu.${part}`,
    '',
    'Zasady:',
    `1. Dni: dokładnie ${dayList} (pole \`ref\` i \`date\`), \`tz\` = strefa IANA dnia. ${chunk.refPrefix ? `Każdy \`ref\` miejsc, punktów, grup wariantów i wariantów zaczyna się od „${chunk.refPrefix}” (dni zostają bez przedrostka: ${chunk.dayRefs.join(', ')}).` : ''}`,
    '2. Punkty dnia w kolejności: `dayRef` + `sortKey` („0010”, „0020”…). Każde przemieszczenie między miejscami to punkt `kind: "transport"` z `leg` (tryb, `durationMin`, przy aucie `distanceKm`) — realne czasy.',
    '3. Godziny liczy silnik z kolejności, `durationMin` (`durationMaxMin` przy niepewności) i `bufferAfterMin`; godzina w `time` znaczy „nie wcześniej niż”. Podaj kotwice: każdy dzień ma `dayStart` (wyjście z noclegu) i `dayEnd`; loty i rezerwacje z `fixed` — `precision: "exact"`, `isFixed: true` (`time.tz` przy innej strefie niż dzień); posiłki (`kind: "meal"`) — `precision: "approx"` w rozsądnej porze (śniadanie, obiad 12–15, kolacja 18–21); punkty pod zachód słońca albo otwarcie — godzina z faktów dnia. Gdy przed kotwicą zostaje luka, wstaw punkt `kind: "free"` albo dopisz atrakcję z puli — nie zostawiaj dnia skończonego o 15:00 z kolacją o 14:00.',
    '4. Miejsca: każdy odwiedzany punkt ma `placeRef` do `places` z `name` (po polsku), `category` (po angielsku, jedno z: city, town, village, neighbourhood, square, old_town, beach, park, garden, national_park, viewpoint, peak, glacier, lake, waterfall, canyon, cave, river, desert, museum, monument, church, mosque, palace, fortress, market, shop, restaurant, cafe, lodging, airport, station, bus_stop, parking, fuel, cable_car, trailhead, stadium, attraction) i `searchName` — nazwą konkretnego obiektu w OpenStreetMap (lokalna albo angielska, np. „Koutoubia Mosque”, „Ushguli”). Miejsca nieokreślone („restauracja w centrum”, „nocleg w medynie”, „parking przy medynie”) — bez `searchName`. Bez współrzędnych i godzin otwarcia z pamięci — dołoży je kod.',
    '5. `priority` (must/should/optional) i `cutRank` (kolejność cięć, 1 = tniemy najpierw). Pula: atrakcje „do wyboru” / alternatywy bez `dayRef`, `planStatus: "candidate"` albo `"alternative"`.',
    '6. Ograniczenia → `constraints` (np. `no_driving_after_dark` dla dni z jazdą, gdy brief tego wymaga; `arrive_before` / `depart_before` z godziną). Wariant A/B w dniu (pogoda, zmęczenie) → `variantGroups` + `variants` + `variantRefs` punktów; `excludesRefs` wariantu wskazuje PUNKTY (items), które ten wariant wyrzuca, nigdy inne warianty.',
    '7. Ceny w `price` (minor units, waluta lokalna, `approx: true`, progi wiekowe w `tiers`), płatność w `payment` (np. `cash_only`).',
    '8. Notatki: na każdy dzień `notes` z `kind: "slack_audit"` (`slack`: large/small/none/negative, krótko dlaczego) oraz ostrzeżenia (`kind: "warning"`) o ryzykach: zmrok, święta i zamknięcia, kolejki, pogoda, miejsca bez rezerwacji.',
    '9. Fakty dni poniżej są policzone kodem — używaj ich (zachód słońca, zmierzch, święta, zmiana czasu), nie zgaduj z pamięci.',
    '10. Bez rezerwacji: nie wypełniaj `lodgingRef`, `bookingRef` ani `leg.ticketBookingRef` — rezerwacje i porównanie noclegów to osobny etap; nocleg opisz punktem `kind: "lodging"`.',
    '',
    ...memorySection(memory),
    'JSON Schema:',
    schemaOf(StagePlan),
    '',
    'Fakty dni:',
    JSON.stringify(facts),
    '',
    'Wybrany wariant (szkielet):',
    JSON.stringify({ ...variant, days: variant.days.filter((day) => chunk.dates.includes(day.date)) }),
    '',
    'Brief wyjazdu:',
    JSON.stringify(brief, null, 1),
  ].join('\n');
}
