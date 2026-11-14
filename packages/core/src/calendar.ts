import { scheduleDay, type ScheduleOptions } from './engine/schedule.ts';
import { markdownPlainLines, notesMarkdown } from './note-markdown.ts';
import type { TripDocument } from './schemas/trip-document.ts';

/**
 * Plan wyjazdu jako kalendarz iCalendar (RFC 5545) — do zaimportowania w Google Calendar albo
 * w kalendarzu telefonu. Godziny z silnika harmonogramu (te same co „Plan dzień po dniu”), zapis
 * w UTC (`…Z`), więc kalendarz sam pokaże je w strefie użytkownika. UID z `ref` punktu — ponowny
 * import tego samego wyjazdu aktualizuje wydarzenia zamiast je dublować.
 */

export type CalendarOptions = ScheduleOptions & {
  /** Stały identyfikator wyjazdu (id z bazy) — część UID. */
  tripId: string;
  /** Adres karty punktu na webie; `{ref}` zostaje zastąpione `ref` punktu. */
  itemUrl?: string;
  /** Chwila wygenerowania (DTSTAMP); domyślnie teraz. */
  now?: number;
};

const utc = (instant: number) => new Date(instant).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** Znaki specjalne treści (RFC 5545 §3.3.11). */
const escape = (value: string) => value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Zawijanie linii do 75 bajtów UTF-8; kontynuacja zaczyna się spacją, znak nie jest dzielony. */
function fold(line: string): string {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = '';
  let size = 0;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    if (size + bytes > (parts.length === 0 ? 75 : 74)) {
      parts.push(current);
      current = '';
      size = 0;
    }
    current += char;
    size += bytes;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

export function tripCalendar(doc: TripDocument, options: CalendarOptions): string {
  const { tripId, itemUrl, now = Date.now(), ...schedule } = options;
  const items = new Map(doc.items.map((item) => [item.ref, item]));
  const places = new Map(doc.places.map((place) => [place.ref, place]));
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ExpeditionPlan//Planner Hub//PL', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${escape(doc.trip.title)}`];

  for (const day of doc.days) {
    let scheduled;
    try {
      scheduled = scheduleDay(doc, day.ref, schedule);
    } catch {
      // Dzień, którego silnik nie policzy (np. bez godziny zera), zostaje poza kalendarzem.
      continue;
    }
    for (const entry of scheduled.items) {
      const item = items.get(entry.ref);
      if (item === undefined) continue;
      const placeRef = item.leg?.toPlaceRef ?? item.placeRef;
      const place = placeRef === undefined ? undefined : places.get(placeRef);
      const url = itemUrl?.replace('{ref}', encodeURIComponent(item.ref));
      const description = [item.description, ...markdownPlainLines(notesMarkdown(item.notes)), url].filter((each) => each !== undefined && each.trim() !== '').join('\n');
      lines.push(
        'BEGIN:VEVENT',
        `UID:${tripId}-${item.ref}@expeditionplan`,
        `DTSTAMP:${utc(now)}`,
        `DTSTART:${utc(entry.start)}`,
        // Punkt bez czasu trwania — kalendarze nie lubią wydarzeń zerowych, więc kwadrans.
        `DTEND:${utc(Math.max(entry.end, entry.start + 15 * 60_000))}`,
        `SUMMARY:${escape(item.title)}`,
      );
      if (place !== undefined) lines.push(`LOCATION:${escape(place.address ? `${place.name}, ${place.address}` : place.name)}`);
      if (place?.lat !== undefined && place.lng !== undefined) lines.push(`GEO:${place.lat};${place.lng}`);
      if (description !== '') lines.push(`DESCRIPTION:${escape(description)}`);
      if (url !== undefined) lines.push(`URL:${url}`);
      lines.push('END:VEVENT');
    }
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
