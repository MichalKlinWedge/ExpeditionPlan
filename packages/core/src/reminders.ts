import { scheduleDay, type ScheduleOptions } from './engine/schedule.ts';
import { addDays, zonedToInstant } from './engine/time.ts';
import type { TripDocument } from './schemas/trip-document.ts';

/**
 * Przypomnienia z planu (powiadomienia lokalne w telefonie — działają offline): otwarte zadania
 * z terminem i „Jutro wyjazd”. Przed wyjazdem liczone w strefie domowej, w trakcie — w strefie dnia.
 * Godzina domyślna 9:00 (zadania), 19:00 (dzień przed wyjazdem); zadanie z własnym przypomnieniem (`remindAt`)
 * przypomina tylko o nim.
 */

type Doc = TripDocument;
export type Reminder = { key: string; title: string; body: string; at: number };

export function tripReminders(doc: Doc, now: number): Reminder[] {
  const home = doc.trip.homeTz;
  const days = new Map(doc.days.map((day) => [day.ref, day]));
  const items = new Map(doc.items.map((item) => [item.ref, item]));
  const bookings = new Map(doc.bookings.map((booking) => [booking.ref, booking]));
  const out: Reminder[] = [];
  const add = (key: string, title: string, body: string, date: string | undefined, time: string, tz: string) => {
    if (date === undefined) return;
    const at = zonedToInstant(date, time, tz);
    if (at > now) out.push({ key, title, body, at });
  };

  for (const task of doc.tasks) {
    if (task.status !== 'open') continue;
    const title = task.priority === 'high' ? `Ważne: ${task.title}` : task.title;
    const body = `${doc.trip.title}${task.body ? ` — ${task.body}` : ''}`;
    const key = `task:${task.ref}`;
    // Własne przypomnienie zastępuje domyślną godzinę z terminu: w strefie dnia wyjazdu z tą datą, inaczej domowej.
    if (task.remindAt !== undefined) {
      const { date, time } = task.remindAt;
      add(key, title, body, date, time, doc.days.find((day) => day.date === date)?.tz ?? home);
      continue;
    }
    if (task.due === undefined) continue;
    const due = task.due;
    switch (due.kind) {
      case 'absolute':
        add(key, title, body, due.date, due.time ?? '09:00', home);
        break;
      case 'before_trip':
        add(key, title, body, addDays(doc.trip.startDate, -due.days), '09:00', home);
        break;
      case 'before_item': {
        const day = days.get(items.get(due.itemRef)?.dayRef ?? '');
        if (day) add(key, title, body, addDays(day.date, -due.days), '09:00', day.tz);
        break;
      }
      case 'before_booking': {
        const start = bookings.get(due.bookingRef)?.start;
        if (start) add(key, title, body, addDays(start.date, -1), '09:00', start.tz ?? home);
        break;
      }
      case 'on_trip': {
        const day = due.dayRef ? days.get(due.dayRef) : undefined;
        const date = day?.date ?? doc.trip.startDate;
        add(key, title, body, date, due.time ?? '08:00', day?.tz ?? doc.trip.primaryTz);
        break;
      }
    }
  }
  add('trip:eve', `Jutro wyjazd: ${doc.trip.title}`, 'Otwórz plan raz z internetem — zapisze się na telefonie do użytku offline.', addDays(doc.trip.startDate, -1), '19:00', home);
  return out.sort((a, b) => a.at - b.at);
}

/**
 * Powiadomienia z osi dnia: „Za 15 min: …” przed każdym punktem (godziny z silnika, z opóźnieniami
 * i pominięciami z terenu, scenariusz optymistyczny — plan mówi „nie wcześniej niż”) i przypomnienie
 * 30 min przed terminem decyzji wariantu, póki wariant nie jest wybrany w terenie. Najbliższe `limit`
 * od teraz — telefon przelicza je po każdym wczytaniu planu i po każdym zdarzeniu dnia.
 */
export function dayAlerts(doc: Doc, options: Omit<ScheduleOptions, 'scenario'>, now: number, { leadMin = 15, decisionLeadMin = 30, limit = 25 } = {}): Reminder[] {
  const out: Reminder[] = [];
  const chosen = options.activeVariants ?? {};
  for (const day of doc.days) {
    // Dzień, który na pewno minął (z zapasem na punkty po północy), pomijamy bez liczenia.
    if (zonedToInstant(addDays(day.date, 2), '00:00', day.tz) < now) continue;
    let items: ReturnType<typeof scheduleDay>['items'] = [];
    try {
      items = scheduleDay(doc, day.ref, { ...options, scenario: 'optimistic' }).items;
    } catch {
      continue;
    }
    for (const item of items) {
      if (item.routeStop) continue;
      const at = item.start - leadMin * 60_000;
      if (at > now) out.push({ key: `item:${day.ref}:${item.ref}`, title: `Za ${leadMin} min: ${item.title}`, body: `${item.startLocal} · ${doc.trip.title}`, at });
    }
  }
  const days = new Map(doc.days.map((day) => [day.ref, day]));
  for (const group of doc.variantGroups) {
    // Wariant z planu (`chosenRef`) to domyślny wybór — decyzję i tak podejmuje się w terenie.
    if (group.decideBy === undefined || chosen[group.ref] !== undefined) continue;
    const day = group.dayRef === undefined ? undefined : days.get(group.dayRef);
    const deadline =
      'local' in group.decideBy
        ? zonedToInstant(group.decideBy.local.slice(0, 10), group.decideBy.local.slice(11, 16), group.decideBy.tz)
        : day === undefined
          ? undefined
          : zonedToInstant(day.date, group.decideBy.time, day.tz);
    if (deadline === undefined) continue;
    const at = deadline - decisionLeadMin * 60_000;
    const labels = doc.variants.filter((variant) => variant.groupRef === group.ref).map((variant) => variant.label);
    const time = 'local' in group.decideBy ? group.decideBy.local.slice(11, 16) : group.decideBy.time;
    if (at > now) out.push({ key: `decide:${group.ref}`, title: `Decyzja do ${time}: ${group.title}`, body: labels.length > 0 ? labels.join(' albo ') : doc.trip.title, at });
  }
  return out.sort((a, b) => a.at - b.at).slice(0, limit);
}
