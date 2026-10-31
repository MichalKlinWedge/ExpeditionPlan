import { TripDocument } from '@expeditionplan/core';
import { z } from 'zod';

/**
 * Polecenie importu planu (SPECYFIKACJA §4, etap „Import planu”). Kształt odpowiedzi to
 * JSON Schema wygenerowany z tego samego schematu Zod, którym potem walidujemy — jedno źródło
 * prawdy, bez ręcznie przepisanego opisu, który rozjechałby się ze schematem po pierwszej zmianie.
 */

export const SYSTEM = [
  'Jesteś importerem planów podróży. Zamieniasz dokument planu (tekst wyciągnięty z DOCX lub PDF)',
  'na jeden obiekt JSON zgodny z podanym JSON Schema. Odpowiadasz wyłącznie JSON-em, bez komentarza.',
].join(' ');

const RULES = `
Zasady:
1. Wierność, nie twórczość. Nie dopisuj niczego, czego nie ma w dokumencie: żadnych współrzędnych, cen ani godzin z własnej wiedzy.
2. Kompletność. Każdy wiersz harmonogramu to element \`items\` z \`sortKey\` („0010”, „0020”… w kolejności z dokumentu, także dla punktów bez godziny). Przejazd, który ma własny wiersz, to punkt \`kind: "transport"\` z polem \`leg\` (tryb, linia, instrukcja, częstotliwość, przesiadki, alternatywa); \`legs\` tylko dla przejść bez własnego wiersza. Każda atrakcja z list „do wyboru”, „nie mieści się”, „alternatywa” trafia do \`items\` bez \`dayRef\` (pula) z właściwym \`planStatus\`. Punkt opłacony w pakiecie: \`bookingRef\` + \`payment: "included"\`.
3. Precyzja godzin jak w dokumencie: „09:45” → exact, „~09:30” / „ok. 9:30” → approx, „11:45–12:45” → range, „rano”/„wieczór” → part_of_day, cały dzień bez godzin → day, „+1:20” → relative: \`from: "previous"\`, jeśli liczy się od poprzedniego kroku, \`from: "anchor"\` od „godziny zero” (\`days[].anchorTime\` puste, jeśli nieustalona).
4. Czas lokalny + strefa IANA. Lot zaczyna się w strefie lotniska wylotu, kończy w strefie przylotu. Punkt dnia w innej strefie niż dzień (lotnisko wylotu) dostaje \`time.tz\`. Rezerwacja bez godziny: \`start: { date, tz }\`; „ok. 10:00” → \`precision: "approx"\`.
5. Pieniądze w groszach/centach (\`minMinor\`, \`lowMinor\`…), w oryginalnej walucie. Przedziały jako min/max, „od” jako \`from: true\`, szacunki jako \`approx: true\`, progi wiekowe kas jako \`tiers\`. Kursy z dokumentu do \`trip.fx\`.
6. Warianty („opcja A/B”, „wersja lżejsza”, „plan B”, „jeśli … to …”) to \`variantGroups\` + \`variants\`, punkty wariantu wskazują \`variantRefs\`, a punkty, które wariant wyrzuca, są w \`excludesRefs\` wariantu. Kandydaci do porównania (noclegi, auta) to rezerwacje \`status: "candidate"\` z \`variantGroupRef\` i \`variantRef\`; dodatki (ubezpieczenie, pakiet km) to \`addons\`. Dzień i punkt mogą wskazać grupę kandydatów (\`lodgingRef\`, \`bookingRef\`). Status nieznany → \`unknown\`, rezerwacja niemożliwa → \`not_required\` — nie zgaduj. Termin decyzji → \`decideBy\`. Tabela porównania → \`comparison\` (tyle wartości w wierszu, ile kolumn).
7. Ograniczenia czasowe („nie wyjeżdżać po 15:00”, „przed zmrokiem”, „biuro otwiera 07:00”) → \`constraints\`. Co ciąć najpierw → \`priority\` i \`cutRank\`. Ocena zapasu dnia → notatka \`kind: "slack_audit"\` z polem \`slack\`.
8. „Do ustalenia” → \`tasks\` kind question/decision; „TODO” → kind todo; terminy względne („dzień wcześniej”, „2 dni przed”) → \`due\`.
9. Pakowanie: osobiste (każdy) → scope personal, wspólne → shared z \`assigneeRef\`, jeśli wiadomo, kto bierze.
10. Klucze \`ref\`: krótkie, małe litery, cyfry i myślniki, unikalne w CAŁYM dokumencie. Każde \`…Ref\` musi wskazywać istniejący element właściwego rodzaju.
11. Źródła z datami sprawdzenia → \`sources\` (\`appliesToRefs\` wskazuje, czego dotyczą).
12. Czego nie da się wyrazić polami — notatka (\`notes\`) o właściwym zasięgu i temacie, nie pomijaj.
13. „0:00 wyjazd” / „godzina zero” to NIE północ: \`days[].anchorTime\` puste (albo podana godzina zero), punkt z \`precision: "relative"\`, \`offsetMin: 0\`, \`from: "anchor"\`.
14. Fakty dnia (wschód i zachód słońca, zmiana czasu w nocy, faza Księżyca) to notatki dnia (\`kind: "info"\`, \`topic: "time"\`), nie punkty harmonogramu — silnik liczy je sam.
15. Część grupy osobno (szpica, ekipy) → \`participantRefs\`; blok z podpunktami równoległymi („PRACA 14:15–16:00” i ekipy) → punkt-rodzic i podpunkty z \`parentRef\`.
16. Kompletność ponad zwięzłość: każdy dzień, każdy blok trasy (spacer po dzielnicy z listą miejsc to osobne punkty) i każda rezerwacja z dokumentu (przylot, nocleg, bilety) — nie streszczaj i nie pomijaj sekcji.`;

const ANONYMIZE = `
17. ANONIMIZACJA: zamiast imion i nazwisk osób prywatnych używaj ról („Dorosły A”, „Dziecko A1”, „Uczestnik 1”). Kody rezerwacji zastąp „ANON-…”. Pomiń prywatne telefony, e-maile i prywatne linki (Google Drive, Docs, linki „share”). Nazwy firm, miejsc i publiczne numery alarmowe zostają.`;

export function jsonSchema(): string {
  return JSON.stringify(z.toJSONSchema(TripDocument, { io: 'input', unrepresentable: 'any' }));
}

export function importPrompt(documentText: string, options: { anonymize?: boolean; fileName?: string } = {}): string {
  return [
    'Zaimportuj poniższy plan wyjazdu do JSON-a zgodnego z JSON Schema.',
    RULES,
    options.anonymize ? ANONYMIZE : '',
    '',
    'JSON Schema:',
    jsonSchema(),
    '',
    `Dokument${options.fileName ? ` „${options.fileName}”` : ''}:`,
    '<<<',
    documentText,
    '>>>',
  ].join('\n');
}
