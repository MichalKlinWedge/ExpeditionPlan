import { type GearCarry, gearGaps } from './gear.ts';
import { dayLodging, missingOnMap } from './plan-info.ts';
import type { TripDocument } from './schemas/trip-document.ts';
import { taskDueDate, taskOverdue } from './task-due.ts';
import { documentWarnings } from './travel-documents.ts';

/**
 * Gotowość przed wyjazdem: jedna lista braków z planu — rezerwacje do zrobienia i do zapłaty,
 * rezerwacje bez dokumentu w sejfie, noce bez noclegu, nierozstrzygnięte warianty, otwarte zadania
 * (z terminem przed końcem wyjazdu), wspólny sprzęt bez osoby, punkty bez miejsca na mapie, paszporty
 * i dowody, które nie wystarczą (`documentWarnings`). Każdy brak z `ref` do linku.
 * Ludzie (kto bez konta / bez telefonu) dochodzą osobno — to dane spoza dokumentu.
 */

type Doc = TripDocument;

export type ReadinessGroup = 'book' | 'documents' | 'pay' | 'vault' | 'lodging' | 'decide' | 'task' | 'gear' | 'map';

export type ReadinessIssue = {
  group: ReadinessGroup;
  /** Element, którego dotyczy (rezerwacja, dzień, grupa wariantów, zadanie, punkt). */
  ref: string;
  title: string;
  /** Data, do kiedy (zadanie, decyzja, zapłata) albo noc (nocleg). */
  date?: string;
  /** Termin już minął. */
  overdue?: true;
};

export const READINESS_GROUP: Record<ReadinessGroup, string> = {
  book: 'Do zarezerwowania',
  documents: 'Dokumenty tożsamości',
  pay: 'Do zapłaty przed wyjazdem',
  vault: 'Rezerwacje bez dokumentu w sejfie',
  lodging: 'Noce bez noclegu',
  decide: 'Do decyzji',
  task: 'Otwarte zadania',
  gear: 'Wspólny sprzęt: nie wiadomo, kto bierze',
  map: 'Punkty bez miejsca na mapie',
};

/** Kolejność grup na liście: najpierw to, co może przepaść (rezerwacje), na końcu kosmetyka. */
export const READINESS_ORDER: ReadinessGroup[] = ['book', 'documents', 'decide', 'lodging', 'pay', 'task', 'gear', 'vault', 'map'];

const OPEN_BOOKING = new Set(['idea', 'candidate', 'to_book', 'unknown']);
const DONE_BOOKING = new Set(['booked', 'paid']);

/** Data zadania na liście: wcześniejsza z terminu i ostatecznego terminu wykonania (zadania „w trakcie” tu nie trafiają). */
function taskDate(doc: Doc, task: Doc['tasks'][number]): string | undefined {
  const dates = [taskDueDate(doc, task), task.deadline].filter((date): date is string => date !== undefined).sort();
  return dates[0];
}

/**
 * Braki planu na dzień `today` (data lokalna). `vaultBookingRefs` — rezerwacje z dokumentem w sejfie;
 * bez niej (np. brak dostępu do sejfu) grupa „vault” jest pomijana. `carries` — kto co bierze
 * (`packing_carriers`); bez niego grupa „gear” jest pomijana.
 */
export function tripReadiness(doc: Doc, today: string, vaultBookingRefs?: ReadonlySet<string>, carries?: readonly GearCarry[]): ReadinessIssue[] {
  const out: ReadinessIssue[] = [];
  const groups = new Map(doc.variantGroups.map((group) => [group.ref, group]));
  /** Rezerwacja-kandydat w porównaniu liczy się dopiero, gdy wybrano właśnie ją (wcześniej — „Do decyzji”). */
  const inPlay = (booking: Doc['bookings'][number]) => {
    if (booking.variantGroupRef === undefined) return true;
    const group = groups.get(booking.variantGroupRef);
    return group?.chosenRef !== undefined && group.chosenRef === booking.variantRef;
  };

  for (const booking of doc.bookings) {
    if (!inPlay(booking)) continue;
    if (OPEN_BOOKING.has(booking.status)) {
      out.push({ group: 'book', ref: booking.ref, title: booking.title, ...(booking.start ? { date: booking.start.date } : {}) });
      continue;
    }
    if (booking.status === 'booked' && booking.paid === undefined && (booking.payWhen === 'prepaid' || booking.payWhen === 'before_arrival')) {
      const date = booking.start?.date;
      out.push({ group: 'pay', ref: booking.ref, title: booking.title, ...(date ? { date } : {}), ...(date !== undefined && date < today ? { overdue: true as const } : {}) });
    }
    if (vaultBookingRefs !== undefined && DONE_BOOKING.has(booking.status) && !vaultBookingRefs.has(booking.ref)) out.push({ group: 'vault', ref: booking.ref, title: booking.title });
  }

  // Noce: każdy dzień poza ostatnim. Tylko gdy plan w ogóle prowadzi noclegi — inaczej to szum.
  const days = [...doc.days].sort((a, b) => a.date.localeCompare(b.date));
  const nights = days.slice(0, -1).map((day) => ({ day, lodging: dayLodging(doc, day.ref) }));
  if (nights.some((night) => night.lodging?.booking !== undefined || night.day.lodgingRef !== undefined)) {
    for (const { day, lodging } of nights) {
      if (lodging?.booking === undefined && day.lodgingRef === undefined) out.push({ group: 'lodging', ref: day.ref, title: day.title ?? day.date, date: day.date });
    }
  }

  for (const group of doc.variantGroups) {
    if (group.chosenRef !== undefined) continue;
    // Warianty pogodowe i „na wypadek” rozstrzyga się w trasie; przed wyjazdem — wybory i rezerwacje.
    if (group.conditionKind !== 'choice' && group.scope !== 'booking') continue;
    const date = group.decideBy && 'local' in group.decideBy ? group.decideBy.local.slice(0, 10) : undefined;
    out.push({ group: 'decide', ref: group.ref, title: group.title, ...(date ? { date } : {}), ...(date !== undefined && date < today ? { overdue: true as const } : {}) });
  }

  for (const task of doc.tasks) {
    if (task.status !== 'open' || task.due?.kind === 'on_trip') continue;
    const date = taskDate(doc, task);
    if (date !== undefined && date > doc.trip.endDate) continue;
    out.push({ group: 'task', ref: task.ref, title: task.title, ...(date ? { date } : {}), ...(taskOverdue(doc, task, today) ? { overdue: true as const } : {}) });
  }

  // Nowy paszport to tygodnie: ostrzeżenie od razu, nieważny lub tracący ważność w trakcie — jako zaległy.
  for (const warning of documentWarnings(doc, today)) {
    out.push({ group: 'documents', ref: warning.travelerRef, title: `${warning.name}: ${warning.text}`, ...(warning.problem !== 'short_margin' ? { overdue: true as const } : {}) });
  }

  if (carries !== undefined) for (const item of gearGaps(doc, carries)) out.push({ group: 'gear', ref: item.ref, title: item.title });

  for (const item of doc.items) {
    if (item.dayRef === undefined || item.planStatus !== 'scheduled' || !missingOnMap(doc, item)) continue;
    out.push({ group: 'map', ref: item.ref, title: item.title });
  }

  const rank = new Map(READINESS_ORDER.map((group, at) => [group, at]));
  return out.sort((a, b) => rank.get(a.group)! - rank.get(b.group)! || (a.date ?? '9999').localeCompare(b.date ?? '9999'));
}
