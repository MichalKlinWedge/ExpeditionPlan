import { shortDate } from "@expeditionplan/core";
import type { TripDocument } from "@expeditionplan/core";

import type { Choices, TaskColumns } from "@/components/logistics-editors";

/**
 * Zadania na webie (strona „Zadania”, logistyka): termin i osoby po ludzku, listy wyboru do
 * formularza i to, które zadania wolno odhaczyć — liczone na serwerze, bo potrzebują całego dokumentu.
 */

type Doc = TripDocument;
type Task = Doc["tasks"][number];


function due(task: Task, doc: Doc): string | null {
  const d = task.due;
  if (!d) return null;
  switch (d.kind) {
    case "absolute":
      return `do ${shortDate(d.date)}${d.time ? ` ${d.time}` : ""}`;
    case "before_trip":
      return d.days === 0 ? "przed wyjazdem" : `${d.days} dni przed wyjazdem`;
    case "before_item": {
      const item = doc.items.find((each) => each.ref === d.itemRef)?.title ?? "punktem";
      return d.days === 0 ? `przed: ${item}` : `${d.days} dni przed: ${item}`;
    }
    case "before_booking":
      return `przed: ${doc.bookings.find((each) => each.ref === d.bookingRef)?.title ?? "rezerwacją"}`;
    case "on_trip": {
      const day = d.dayRef ? doc.days.find((each) => each.ref === d.dayRef) : undefined;
      return `w trakcie wyjazdu${day ? `, ${shortDate(day.date)}` : ""}${d.time ? ` ${d.time}` : ""}`;
    }
  }
}

/** Termin i osoby każdego zadania do kolumn tabeli („3 dni przed wyjazdem”, „Ania, Tomek”). */
export function taskColumns(doc: Doc): Record<string, TaskColumns> {
  return Object.fromEntries(
    doc.tasks.map((task) => [
      task.ref,
      { due: due(task, doc) ?? "", who: task.assigneeRefs.map((ref) => doc.travelers.find((each) => each.ref === ref)?.name ?? "?").join(", ") },
    ]),
  );
}

/** Listy wyboru do formularzy rezerwacji, kontaktów i zadań. */
export function planChoices(doc: Doc): Choices {
  const dayLabel = new Map(doc.days.map((day, index) => [day.ref, `dz. ${index + 1}`]));
  return {
    travelers: doc.travelers.map((traveler) => ({ ref: traveler.ref, name: traveler.name })),
    items: doc.items.filter((item) => item.dayRef !== undefined).map((item) => ({ ref: item.ref, label: `${dayLabel.get(item.dayRef!) ?? ""} · ${item.title}` })),
    bookings: doc.bookings.filter((booking) => booking.status !== "candidate" && booking.status !== "idea").map((booking) => ({ ref: booking.ref, title: booking.title })),
    days: doc.days.map((day, index) => ({ ref: day.ref, label: `${index + 1}. ${shortDate(day.date)}` })),
    groups: doc.variantGroups.filter((group) => group.scope !== "booking").map((group) => ({ ref: group.ref, title: group.title })),
  };
}

type TravelerRow = { id: string; ref?: unknown; user_id?: unknown; guardian_id?: unknown };

/**
 * Zadania, które widz może odhaczyć: przypisane do uczestnika z jego kontem albo do dziecka pod
 * jego opieką — jak RLS `tasks_update` (`is_my_traveler`). Organizator i edytor odhaczają wszystkie.
 */
export function checkableTasks(doc: Doc, travelers: readonly TravelerRow[], userId: string): string[] {
  const byId = new Map(travelers.map((row) => [row.id, row]));
  const mine = new Set(
    travelers
      .filter((row) => row.user_id === userId || (typeof row.guardian_id === "string" && byId.get(row.guardian_id)?.user_id === userId))
      .map((row) => row.ref)
      .filter((ref): ref is string => typeof ref === "string"),
  );
  return doc.tasks.filter((task) => task.assigneeRefs.some((ref) => mine.has(ref))).map((task) => task.ref);
}
