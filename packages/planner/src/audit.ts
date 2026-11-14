import { type AiClient, type AiUsage, askStructured } from '@expeditionplan/ai';
import {
  BOOKING_KIND,
  BOOKING_STATUS,
  bookingWhen,
  dayLodging,
  itemsOfBooking,
  READINESS_GROUP,
  type ReadinessIssue,
  type StoredAudit,
  ticketItems,
  TripAudit,
  type TripDocument,
} from '@expeditionplan/core';
import { z } from 'zod';

import { SYSTEM } from './prompts.ts';
import { reviewContext } from './review.ts';

/**
 * Kontrola całego wyjazdu z AI (strona „Dostrajanie z AI”): spójność, błędy i zagrożenia. Model dostaje plan
 * z faktami z kodu (godziny i ostrzeżenia silnika jak w przeglądzie planu, noclegi noc po nocy, rezerwacje
 * z terminami i punktami, braki z „Gotowości do wyjazdu”) i odpowiada listą uwag z kluczami dnia, punktów
 * i rezerwacji. Nic nie zmienia w planie — uwagi czyta człowiek.
 */

type Doc = TripDocument;

const schemaOf = (schema: z.ZodType) => JSON.stringify(z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }));

/** Plan dla modelu: przegląd dni z `reviewContext` plus wyjazd, noclegi, rezerwacje i braki znalezione przez kod. */
export function auditContext(doc: Doc, locked: ReadonlySet<string>, codeIssues: readonly ReadinessIssue[], today: string) {
  const base = reviewContext(doc, locked);
  const places = new Map(doc.places.map((place) => [place.ref, place.name]));
  return {
    title: doc.trip.title,
    today,
    dates: { start: doc.trip.startDate, end: doc.trip.endDate, timeZone: doc.trip.primaryTz },
    travelers: doc.travelers.map((person) => ({
      name: person.name,
      ...(person.age !== undefined ? { age: person.age } : {}),
      ...(person.tentative ? { tentative: true } : {}),
      ...(person.fromDate || person.toDate ? { present: `${person.fromDate ?? doc.trip.startDate} – ${person.toDate ?? doc.trip.endDate}` } : {}),
    })),
    days: base.days.map((day) => {
      const lodging = dayLodging(doc, day.ref);
      return { ...day, night: lodging === null ? 'brak noclegu w planie' : `${lodging.name}${lodging.booking ? ` (rezerwacja ${lodging.booking.ref})` : ' (bez rezerwacji)'}` };
    }),
    bookings: doc.bookings
      .filter((booking) => booking.status !== 'idea')
      .map((booking) => ({
        ref: booking.ref,
        kind: BOOKING_KIND[booking.kind] ?? booking.kind,
        title: booking.title,
        status: BOOKING_STATUS[booking.status] ?? booking.status,
        when: bookingWhen(booking) || undefined,
        ...(booking.startPlaceRef ? { place: places.get(booking.startPlaceRef) } : {}),
        ...(booking.endPlaceRef ? { endPlace: places.get(booking.endPlaceRef) } : {}),
        ...(booking.refundable === false ? { refundable: false } : {}),
        ...(booking.freeCancellationUntil ? { freeCancellationUntil: booking.freeCancellationUntil } : {}),
        ...(booking.checkInFrom ? { checkInFrom: booking.checkInFrom } : {}),
        ...(booking.checkOutUntil ? { checkOutUntil: booking.checkOutUntil } : {}),
        items: itemsOfBooking(doc, booking.ref).map((item) => item.ref),
        ...(ticketItems(doc, booking.ref).length > 0 ? { ticketFor: ticketItems(doc, booking.ref).map((item) => item.ref) } : {}),
      })),
    pool: base.pool,
    placesNotOnMap: base.placesNotOnMap,
    codeIssues: codeIssues.map((issue) => `${READINESS_GROUP[issue.group]}: ${issue.title}${issue.date ? ` (${issue.date})` : ''}${issue.overdue ? ' — po terminie' : ''}`),
  };
}

export function auditPrompt(doc: Doc, locked: ReadonlySet<string>, codeIssues: readonly ReadinessIssue[], today: string, note: string): string {
  return [
    'Kontrola całego wyjazdu przed wyjazdem. Przeczytaj plan dzień po dniu razem z noclegami i rezerwacjami i znajdź to, co jest niespójne, błędne albo groźne. Nie poprawiasz planu — piszesz uwagi dla organizatora.',
    '',
    'Szukaj zwłaszcza:',
    '- niespójności (`consistency`): daty i godziny rezerwacji kontra punkty planu (lot, odbiór i zwrot auta, zameldowanie, bilety), nocleg tej nocy kontra miejsce końca dnia i startu następnego, przejazd, który zaczyna się gdzie indziej, niż skończył się poprzedni punkt, ta sama rzecz dwa razy, punkt poza datami wyjazdu albo uczestnik poza swoimi datami obecności;',
    '- błędów w planie (`mistake`): niemożliwa kolejność albo godziny (ostrzeżenia silnika `!`), brak dojazdu albo powrotu, przejazd bez środka lub czasu, rezerwacja anulowana a wciąż używana, punkt, który się nie zmieści;',
    '- zagrożeń na miejscu (`risk`): za mały zapas przed lotem, odprawą albo stałą godziną, długa jazda po locie albo nocą, wędrówka kończąca się po zachodzie (`sunset`), dzień bez przerwy na posiłek, punkty na zewnątrz bez planu B, za ciężki dzień dla dzieci (`travelers.age`), miejsca, które bywają zamknięte w ten dzień tygodnia — wtedy pisz „sprawdź”, nie zgaduj godzin;',
    '- braków (`missing`): nocy bez noclegu, rezerwacji, które powinny być, a ich nie ma, przejazdów bez rezerwacji tam, gdzie zwykle trzeba ją mieć.',
    '',
    'Zasady:',
    '1. Opieraj się na faktach z planu i kodu: godziny silnika (`engine`), ostrzeżenia (`warnings`), `kmFromPrevious`, `night`, `bookings.when`, `codeIssues`. Nie wymyślaj cen, godzin otwarcia, numerów linii ani przepisów.',
    '2. `codeIssues` kod już pokazuje w „Gotowości do wyjazdu”: nie przepisuj ich jeden do jednego — uwzględnij tylko, gdy coś do nich dodajesz (skutek dla planu, związek z innym punktem).',
    '3. Każda uwaga wskazuje, czego dotyczy: `dayRef`, `itemRefs` (klucze punktów) i `bookingRef` — tylko klucze z planu, nie wymyślaj.',
    '4. `severity`: `error` = plan się nie uda albo coś jest sprzeczne, `warning` = realne ryzyko, `tip` = warto rozważyć. Nie zawyżaj.',
    '5. `title` krótko z dniem („Dzień 2: …”), `detail` 1–3 zdania z konkretnymi godzinami i nazwami, `suggestion` jedno zdanie, co zrobić.',
    '6. Najwyżej 25 uwag, od najważniejszej. Lepiej mniej i pewnych. Jeśli wszystko się zgadza — pusta lista i dobra ocena w `summary`.',
    '7. Punkty z `variantOnly` należą do wariantu: nie traktuj dwóch wariantów jednego dnia jako sprzeczności.',
    '8. Piszesz po polsku, rzeczowo.',
    ...(note.trim() ? ['', `Organizator prosi szczególnie: ${note.trim()}`] : []),
    '',
    'JSON Schema odpowiedzi:',
    schemaOf(TripAudit),
    '',
    'Wyjazd z faktami z kodu:',
    JSON.stringify(auditContext(doc, locked, codeIssues, today), null, 1),
  ].join('\n');
}

/** Uwagi z numerami (`a1`, `a2`…) i bez kluczy, których w planie nie ma (model czasem je zmyśla). */
export function numberedAudit(doc: Doc, audit: TripAudit): StoredAudit {
  const items = new Set(doc.items.map((item) => item.ref));
  const days = new Set(doc.days.map((day) => day.ref));
  const bookings = new Set(doc.bookings.map((booking) => booking.ref));
  const findings = audit.findings.map((finding, index) => {
    const { dayRef, bookingRef, ...rest } = finding;
    return {
      ...rest,
      id: `a${index + 1}`,
      itemRefs: finding.itemRefs.filter((ref) => items.has(ref)),
      ...(dayRef !== undefined && days.has(dayRef) ? { dayRef } : {}),
      ...(bookingRef !== undefined && bookings.has(bookingRef) ? { bookingRef } : {}),
    };
  });
  return { audit: { summary: audit.summary, findings }, dismissed: [] };
}

export async function auditTrip(
  doc: Doc,
  locked: ReadonlySet<string>,
  options: { codeIssues: readonly ReadinessIssue[]; today: string; note: string },
  deps: { client: AiClient; timeoutMs?: number; onUsage?: (usage: AiUsage) => void },
): Promise<StoredAudit> {
  const answer = await askStructured(deps.client, TripAudit, auditPrompt(doc, locked, options.codeIssues, options.today, options.note), {
    system: SYSTEM,
    maxTokens: 16_000,
    timeoutMs: deps.timeoutMs ?? 110_000,
    label: `${doc.trip.title} kontrola`,
    ...(deps.onUsage ? { onUsage: deps.onUsage } : {}),
  });
  return numberedAudit(doc, answer.data);
}

/** Uwagi jeszcze nieodrzucone. */
export const openFindings = (stored: StoredAudit) => stored.audit.findings.filter((each) => !stored.dismissed.includes(each.id));
