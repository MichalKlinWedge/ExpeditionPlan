/**
 * Wspólny transport: kto rusza z tego samego miejsca tego samego dnia i kto w tym samym miejscu kończy.
 * Działa na wierszach uczestników, bez dokumentu: strona uczestników nie pobiera całego planu.
 */

export type TransportPerson = {
  id: string;
  name: string;
  isDriver?: boolean | null;
  tentative?: boolean | null;
  startPlaceId?: string | null;
  endPlaceId?: string | null;
  /** Dołącza później: inny dzień to inny transport. */
  fromDate?: string | null;
  /** Wyjeżdża wcześniej. */
  toDate?: string | null;
};

export type TransportGroup<P extends TransportPerson = TransportPerson> = { placeId: string; date: string | null; people: P[] };

export type TransportPlan<P extends TransportPerson = TransportPerson> = {
  starts: TransportGroup<P>[];
  ends: TransportGroup<P>[];
  noStart: P[];
  noEnd: P[];
};

function grouped<P extends TransportPerson>(people: P[], place: (person: P) => string | null | undefined, date: (person: P) => string | null | undefined): TransportGroup<P>[] {
  const groups = new Map<string, TransportGroup<P>>();
  for (const person of people) {
    const placeId = place(person);
    if (!placeId) continue;
    const day = date(person) ?? null;
    const key = `${placeId}|${day ?? ''}`;
    const group = groups.get(key) ?? { placeId, date: day, people: [] };
    group.people.push(person);
    groups.set(key, group);
  }
  // Najpierw największe grupy; bez daty (cały wyjazd) przed tymi z datą.
  return [...groups.values()].sort((a, b) => b.people.length - a.people.length || (a.date ?? '').localeCompare(b.date ?? ''));
}

export function transportPlan<P extends TransportPerson>(people: P[]): TransportPlan<P> {
  return {
    starts: grouped(people, (person) => person.startPlaceId, (person) => person.fromDate),
    ends: grouped(people, (person) => person.endPlaceId, (person) => person.toDate),
    noStart: people.filter((person) => !person.startPlaceId),
    noEnd: people.filter((person) => !person.endPlaceId),
  };
}
