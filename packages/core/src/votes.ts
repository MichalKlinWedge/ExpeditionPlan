import { z } from 'zod';

import { addDays } from './engine/time.ts';
import { IsoDate } from './schemas/common.ts';
import type { TripDocument } from './schemas/trip-document.ts';
import { daysBetween } from './trip-reschedule.ts';

/**
 * Głosowanie grupy (wiersze `trip_votes`, poza dokumentem planu, jak `packing_carriers`): nad wariantem
 * w grupie wariantów (także kandydaci noclegu `scope = booking`) i nad terminem (dostępność dzień po dniu
 * w oknie `trips.date_poll`). Głos to podpowiedź: decyzję (`chosenRef`, nowy termin) podejmuje organizator.
 * Ten sam kod liczy wyniki na webie i w telefonie.
 */

type Doc = TripDocument;
type Group = Doc['variantGroups'][number];

export type VariantVote = { travelerRef: string; groupRef: string; /** `null` = „wszystko mi jedno”. */ variantRef: string | null };
export type DayAnswer = 'yes' | 'maybe' | 'no';
export type DayVote = { travelerRef: string; date: string; answer: DayAnswer };
export type Votes = { variants: VariantVote[]; days: DayVote[] };

export const DAY_ANSWER: Record<DayAnswer, string> = { yes: 'mogę', maybe: 'może', no: 'nie mogę' };

/** Okno ankiety terminu (`trips.date_poll`); długość szukanego terminu = długość wyjazdu. */
export const DatePoll = z
  .object({ from: IsoDate, to: IsoDate, closesOn: IsoDate.optional() })
  .refine((poll) => poll.from <= poll.to, { message: 'Koniec okna przed początkiem.', path: ['to'] })
  .refine((poll) => daysBetween(poll.from, poll.to) <= MAX_POLL_DAYS, { message: 'Okno ankiety najwyżej na 4 miesiące.', path: ['to'] });
export type DatePoll = z.infer<typeof DatePoll>;

export const MAX_POLL_DAYS = 122;

/** Wiersze `trip_votes` (z `pull_changes` albo z pamięci telefonu) → głosy na klucze planu; usunięte i nieznane pomija. */
export function votesFromRows(rows: readonly Record<string, unknown>[], refOf: ReadonlyMap<string, string>): Votes {
  const votes: Votes = { variants: [], days: [] };
  for (const row of rows) {
    if (row.deleted_at !== null && row.deleted_at !== undefined) continue;
    const travelerRef = refOf.get(String(row.traveler_id));
    if (travelerRef === undefined) continue;
    if (typeof row.variant_group_id === 'string') {
      const groupRef = refOf.get(row.variant_group_id);
      const variantRef = typeof row.variant_id === 'string' ? refOf.get(row.variant_id) : null;
      if (groupRef !== undefined && variantRef !== undefined) votes.variants.push({ travelerRef, groupRef, variantRef });
    } else if (typeof row.day === 'string' && (row.answer === 'yes' || row.answer === 'maybe' || row.answer === 'no')) {
      votes.days.push({ travelerRef, date: row.day.slice(0, 10), answer: row.answer });
    }
  }
  return votes;
}

/** Grupy, nad którymi można głosować: co najmniej dwa warianty. */
export function votingGroups(doc: Doc): Group[] {
  return doc.variantGroups.filter((group) => doc.variants.filter((variant) => variant.groupRef === group.ref).length > 1);
}

export type VariantTally = { variantRef: string; label: string; recommended: boolean; chosen: boolean; voters: string[] };
export type GroupTally = {
  groupRef: string;
  options: VariantTally[];
  /** Głosujący „wszystko mi jedno”. */
  indifferent: string[];
  /** Uczestnicy bez głosu. */
  missing: string[];
  /** Warianty z największą liczbą głosów (pusta lista, gdy nikt nie wskazał wariantu); dwa i więcej = remis. */
  leaders: string[];
  /** Głos osoby (klucz uczestnika → wariant, `null` = wszystko jedno). */
  byTraveler: Record<string, string | null>;
};

/** Wyniki jednej grupy wariantów: kto na co, kto obojętny, kto jeszcze nie głosował. */
export function groupTally(doc: Doc, groupRef: string, votes: Votes): GroupTally {
  const group = doc.variantGroups.find((each) => each.ref === groupRef);
  const names = new Map(doc.travelers.map((person) => [person.ref, person.name]));
  const byTraveler: Record<string, string | null> = {};
  for (const vote of votes.variants) if (vote.groupRef === groupRef && names.has(vote.travelerRef)) byTraveler[vote.travelerRef] = vote.variantRef;
  const options = doc.variants
    .filter((variant) => variant.groupRef === groupRef)
    .map((variant) => ({
      variantRef: variant.ref,
      label: variant.label,
      recommended: variant.recommended === true,
      chosen: group?.chosenRef === variant.ref,
      voters: doc.travelers.filter((person) => byTraveler[person.ref] === variant.ref).map((person) => person.name),
    }));
  const known = new Set(options.map((option) => option.variantRef));
  const top = Math.max(0, ...options.map((option) => option.voters.length));
  return {
    groupRef,
    options,
    indifferent: doc.travelers.filter((person) => person.ref in byTraveler && (byTraveler[person.ref] === null || !known.has(byTraveler[person.ref]!))).map((person) => person.name),
    missing: doc.travelers.filter((person) => !(person.ref in byTraveler)).map((person) => person.name),
    leaders: top === 0 ? [] : options.filter((option) => option.voters.length === top).map((option) => option.variantRef),
    byTraveler,
  };
}

/** „sob 18:00” albo „2027-01-10 18:00”: termin decyzji grupy, jak w edytorze reguł dnia. */
export function decideByText(group: Group): string | undefined {
  if (group.decideBy === undefined) return undefined;
  return 'time' in group.decideBy ? group.decideBy.time : group.decideBy.local.replace('T', ' ');
}

/** Dni okna ankiety. */
export function pollDays(poll: DatePoll): string[] {
  const count = Math.min(daysBetween(poll.from, poll.to), MAX_POLL_DAYS);
  return Array.from({ length: count + 1 }, (_, index) => addDays(poll.from, index));
}

export type TermOption = {
  start: string;
  end: string;
  /** Mogą we wszystkie dni. */
  yes: string[];
  /** Bez „nie mogę”, ale z „może” w którymś dniu. */
  maybe: string[];
  /** „Nie mogę” w którymś dniu. */
  blocked: string[];
  /** Bez odpowiedzi na któryś dzień (i bez „nie mogę”). */
  unknown: string[];
};

/**
 * Najlepsze terminy o długości wyjazdu (`length` dni) w oknie ankiety: najpierw najmniej osób, które nie
 * mogą, potem najwięcej pewnych, potem najmniej „może”, a przy równych wcześniejszy. Najwyżej `limit`.
 */
export function bestTerms(doc: Doc, poll: DatePoll, votes: Votes, length: number, limit = 5): TermOption[] {
  const days = pollDays(poll);
  const answers = new Map<string, DayAnswer>();
  for (const vote of votes.days) answers.set(`${vote.travelerRef}|${vote.date}`, vote.answer);
  const options: TermOption[] = [];
  for (let first = 0; first + length <= days.length; first++) {
    const window = days.slice(first, first + length);
    const option: TermOption = { start: window[0]!, end: window.at(-1)!, yes: [], maybe: [], blocked: [], unknown: [] };
    for (const person of doc.travelers) {
      const given = window.map((date) => answers.get(`${person.ref}|${date}`));
      if (given.includes('no')) option.blocked.push(person.name);
      else if (given.includes(undefined)) option.unknown.push(person.name);
      else if (given.includes('maybe')) option.maybe.push(person.name);
      else option.yes.push(person.name);
    }
    options.push(option);
  }
  return options
    .sort((a, b) => a.blocked.length - b.blocked.length || b.yes.length - a.yes.length || a.maybe.length - b.maybe.length || (a.start < b.start ? -1 : 1))
    .slice(0, limit);
}

/** Ile dni okna ma odpowiedź danej osoby — do „wypełnione 12 z 40 dni”. */
export function answeredDays(poll: DatePoll, votes: Votes, travelerRef: string): number {
  const inWindow = new Set(pollDays(poll));
  return votes.days.filter((vote) => vote.travelerRef === travelerRef && inWindow.has(vote.date)).length;
}
