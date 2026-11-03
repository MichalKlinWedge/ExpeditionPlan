import { addDays } from './engine/time.ts';
import { dayLodging, missingOnMap } from './plan-info.ts';
import type { TripDocument } from './schemas/trip-document.ts';

/**
 * Gotowość przed wyjazdem: jedna lista braków z planu — rezerwacje do zrobienia i do zapłaty,
 * rezerwacje bez dokumentu w sejfie, noce bez noclegu, nierozstrzygnięte warianty, otwarte zadania
 * (z terminem przed końcem wyjazdu), punkty bez miejsca na mapie. Każdy brak z `ref` do linku.
 * Ludzie (kto bez konta / bez telefonu) dochodzą osobno — to dane spoza dokumentu.
 */

type Doc = TripDocument;

export type ReadinessGroup = 'book' | 'pay' | 'vault' | 'lodging' | 'decide' | 'task' | 'map';

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
  pay: 'Do zapłaty przed wyjazdem',
  vault: 'Rezerwacje bez dokumentu w sejfie',
  lodging: 'Noce bez noclegu',
  decide: 'Do decyzji',
  task: 'Otwarte zadania',
  map: 'Punkty bez miejsca na mapie',
};

/** Kolejność grup na liście: najpierw to, co może przepaść (rezerwacje), na końcu kosmetyka. */
export const READINESS_ORDER: ReadinessGroup[] = ['book', 'decide', 'lodging', 'pay', 'task', 'vault', 'map'];

const OPEN_BOOKING = new Set(['idea', 'candidate', 'to_book', 'unknown']);
const DONE_BOOKING = new Set(['booked', 'paid']);

/** Termin zadania jako data (zadania „w trakcie” — bez terminu przed wyjazdem). */
function taskDate(doc: Doc, task: Doc['tasks'][number]): string | undefined {
  const due = task.due;
  switch (due?.kind) {
    case 'absolute':
      return due.date;
    case 'before_trip':
      return addDays(doc.trip.startDate, -due.days);
    case 'before_item': {
      const dayRef = doc.items.find((item) => item.ref === due.itemRef)?.dayRef;
      const day = doc.days.find((each) => each.ref === dayRef);
      return day === undefined ? undefined : addDays(day.date, -due.days);
    }
    case 'before_booking': {
      const start = doc.bookings.find((booking) => booking.ref === due.bookingRef)?.start;
      return start === undefined ? undefined : addDays(start.date, -1);
    }
    default:
      return undefined;
  }
}

/**
 * Braki planu na dzień `today` (data lokalna). `vaultBookingRefs` — rezerwacje z dokumentem w sejfie;
 * bez niej (np. brak dostępu do sejfu) grupa „vault” jest pomijana.
 */
export function tripReadiness(doc: Doc, today: string, vaultBookingRefs?: ReadonlySet<string>): ReadinessIssue[] {
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
    out.push({ group: 'task', ref: task.ref, title: task.title, ...(date ? { date } : {}), ...(date !== undefined && date < today ? { overdue: true as const } : {}) });
  }

  for (const item of doc.items) {
    if (item.dayRef === undefined || item.planStatus !== 'scheduled' || !missingOnMap(doc, item)) continue;
    out.push({ group: 'map', ref: item.ref, title: item.title });
  }

  const rank = new Map(READINESS_ORDER.map((group, at) => [group, at]));
  return out.sort((a, b) => rank.get(a.group)! - rank.get(b.group)! || (a.date ?? '9999').localeCompare(b.date ?? '9999'));
}
