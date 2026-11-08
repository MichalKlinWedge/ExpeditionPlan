"use client";

import { addDays, climateFor, climateLine, climateYearsText, DAY_ANSWER, type DayAnswer, type DatePoll, dayChip, dayMonth, needsClimate, type TermOption } from "@expeditionplan/core";
import { useActionState, useState, useTransition } from "react";

import type { FormState } from "@/app/actions";
import { castVote, chooseVariant, saveAvailability, saveDatePoll, setVotingOpen } from "@/app/vote-actions";
import { ClimateCredit, useClimate, useClimatePlace } from "@/components/climate-hint";
import { RescheduleDialog } from "@/components/trip-reschedule";
import type { ClimateSource } from "@/lib/climate-place";

/**
 * Tablica głosowania: za kogo głosuję, ankieta terminu (kalendarz dostępności i najlepsze terminy)
 * oraz grupy wariantów z wynikami. Głos zapisuje się od razu (wariant) albo przyciskiem (dostępność);
 * „Wybieram”, okno ankiety i „Ustaw ten termin” są dla organizatora i edytora w trybie edycji, tak jak
 * otwieranie głosowania nad grupą: zamkniętą grupę widzą (i mogą w niej głosować) tylko oni.
 */

export type BoardPerson = { ref: string; id: string; name: string; mine: boolean; account: boolean };
export type BoardOption = { variantRef: string; id: string; label: string; summary: string | null; recommended: boolean; chosen: boolean; voters: string[] };
export type BoardGroup = {
  ref: string;
  id: string;
  title: string;
  where: string;
  condition: string | null;
  decideBy: string | null;
  chosenRef: string | null;
  /** Uczestnicy widzą i mogą głosować; zamkniętą widzą tylko organizator i edytor. */
  votingOpen: boolean;
  options: BoardOption[];
  indifferent: string[];
  missing: string[];
  leaders: string[];
  byTraveler: Record<string, string | null>;
};

type Props = {
  tripId: string;
  people: BoardPerson[];
  travelerCount: number;
  groups: BoardGroup[];
  poll: DatePoll | null;
  length: number;
  terms: TermOption[];
  answers: Record<string, Record<string, DayAnswer>>;
  dayCounts: Record<string, { yes: number; maybe: number; no: number }>;
  trip: { startDate: string; endDate: string; today: string };
  canEdit: boolean;
  /** Organizator albo edytor (niezależnie od trybu edycji). */
  mayEdit: boolean;
  /** Miejsce do klimatu terminów dalej niż 16 dni. */
  climate: ClimateSource;
};

const card = "card flex flex-col gap-3 p-4";

export function VoteBoard(props: Props) {
  const { people, groups } = props;
  const [as, setAs] = useState(people[0]?.ref ?? "");
  const person = people.find((each) => each.ref === as) ?? null;
  const open = groups.filter((group) => group.chosenRef === null);
  const decided = groups.filter((group) => group.chosenRef !== null);

  return (
    <>
      {people.length === 0 ? (
        <p className="text-sm text-amber-700 dark:text-amber-400">Twoje konto nie jest połączone z żadnym uczestnikiem, więc nie możesz głosować. Poproś organizatora o zaproszenie dla Twojej osoby (strona „Uczestnicy i dostęp”).</p>
      ) : people.length > 1 ? (
        <label className="flex flex-wrap items-center gap-2 text-sm">
          Głosuję jako
          <select value={as} onChange={(event) => setAs(event.target.value)} className="field px-2 py-1 text-sm">
            {people.map((each) => (
              <option key={each.ref} value={each.ref}>
                {each.name}
                {each.mine ? "" : each.account ? " (za tę osobę)" : " (bez konta)"}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="text-sm text-zinc-500">Głosujesz jako {person?.name}.</p>
      )}

      <DateSection {...props} person={person} />

      <section className={card}>
        <h2 className="card-title">Warianty i kandydaci ({open.length} do decyzji)</h2>
        {groups.length === 0 && (
          <p className="text-sm text-zinc-500">{props.mayEdit ? "W planie nie ma wyborów z co najmniej dwoma wariantami." : "Organizator nie otworzył jeszcze głosowania nad żadnym wyborem."}</p>
        )}
        {props.mayEdit && groups.length > 0 && (
          <p className="text-xs text-zinc-500">
            Uczestnicy widzą tylko wybory z otwartym głosowaniem ({groups.filter((group) => group.votingOpen).length} z {groups.length}).
            {props.canEdit ? " Otwierasz je przyciskiem przy wyborze." : " Otwierasz je po „Edytuj”."}
          </p>
        )}
        {open.map((group) => (
          <GroupCard key={group.ref} tripId={props.tripId} group={group} person={person} canEdit={props.canEdit} />
        ))}
        {decided.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-zinc-500">Rozstrzygnięte ({decided.length})</summary>
            <div className="mt-2 flex flex-col gap-3">
              {decided.map((group) => (
                <GroupCard key={group.ref} tripId={props.tripId} group={group} person={person} canEdit={props.canEdit} />
              ))}
            </div>
          </details>
        )}
      </section>
    </>
  );
}

function GroupCard({ tripId, group, person, canEdit }: { tripId: string; group: BoardGroup; person: BoardPerson | null; canEdit: boolean }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<FormState>({});
  const mine = person === null ? undefined : group.byTraveler[person.ref];
  const voted = person !== null && person.ref in group.byTraveler;
  const run = (action: () => Promise<FormState>) => start(async () => setMessage(await action()));
  const vote = (variantId: string | null, withdrawn = false) => run(() => castVote(tripId, person!.id, { groupId: group.id, variantId }, withdrawn));

  return (
    <div id={`glos-${group.ref}`} className="flex scroll-mt-20 flex-col gap-2 rounded-md border border-zinc-200 p-3 text-sm target:border-signal dark:border-zinc-800">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium">{group.title}</p>
        <span className="text-xs text-zinc-500">{[group.where, group.decideBy ? `decyzja do ${group.decideBy}` : null].filter(Boolean).join(" · ")}</span>
      </div>
      {(canEdit || !group.votingOpen) && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className={group.votingOpen ? "chip" : "chip text-zinc-500"}>{group.votingOpen ? "głosowanie otwarte dla wszystkich" : "głosowanie zamknięte: widzisz je tylko Ty i edytorzy"}</span>
          {canEdit && (
            <button type="button" disabled={pending} onClick={() => run(() => setVotingOpen(tripId, group.ref, !group.votingOpen))} className="btn-mini">
              {group.votingOpen ? "zamknij głosowanie" : "otwórz głosowanie"}
            </button>
          )}
        </div>
      )}
      {group.condition && <p className="text-xs text-zinc-500">{group.condition}</p>}
      <ul className="flex flex-col gap-2">
        {group.options.map((option) => {
          const lead = group.leaders.includes(option.variantRef);
          return (
            <li key={option.variantRef} className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">
                  {option.label}
                  {option.recommended ? " ★" : ""}
                </span>
                {option.chosen && <span className="chip">wybrany</span>}
                {lead && !option.chosen && <span className="chip">{group.leaders.length > 1 ? "remis" : "prowadzi"}</span>}
                <span className="text-zinc-500">
                  głosy: {option.voters.length}
                  {option.voters.length > 0 ? ` (${option.voters.join(", ")})` : ""}
                </span>
                {person !== null &&
                  (mine === option.variantRef ? (
                    <button type="button" disabled={pending} onClick={() => vote(option.id, true)} className="btn-mini" title="Cofnij swój głos">
                      ✓ Twój głos · wycofaj
                    </button>
                  ) : (
                    <button type="button" disabled={pending} onClick={() => vote(option.id)} className="btn-mini">
                      głosuję
                    </button>
                  ))}
                {canEdit && !option.chosen && (
                  <button type="button" disabled={pending} onClick={() => run(() => chooseVariant(tripId, group.ref, option.variantRef))} className="btn-mini">
                    wybieram
                  </button>
                )}
              </div>
              {option.summary && <p className="text-xs text-zinc-500">{option.summary}</p>}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
        {person !== null &&
          (voted && mine === null ? (
            <button type="button" disabled={pending} onClick={() => vote(null, true)} className="btn-mini">
              ✓ wszystko mi jedno · wycofaj
            </button>
          ) : (
            <button type="button" disabled={pending} onClick={() => vote(null)} className="btn-mini">
              wszystko mi jedno
            </button>
          ))}
        {group.indifferent.length > 0 && <span>wszystko jedno: {group.indifferent.join(", ")}</span>}
        {group.missing.length > 0 && <span>nie głosowali: {group.missing.join(", ")}</span>}
      </div>
      {message.error && <p className="text-xs text-red-600">{message.error}</p>}
    </div>
  );
}

const TONE: Record<DayAnswer | "none", string> = {
  yes: "bg-emerald-200 text-emerald-950 dark:bg-emerald-800 dark:text-emerald-50",
  maybe: "bg-amber-200 text-amber-950 dark:bg-amber-700 dark:text-amber-50",
  no: "bg-red-200 text-red-950 dark:bg-red-800 dark:text-red-50",
  none: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
};
const NEXT: Record<DayAnswer | "none", DayAnswer | null> = { none: "yes", yes: "maybe", maybe: "no", no: null };

/** Poniedziałek = 0. */
const weekday = (date: string) => (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;

function DateSection({ tripId, poll, length, terms, answers, dayCounts, trip, canEdit, person, travelerCount, climate: climateFrom }: Props & { person: BoardPerson | null }) {
  const saved = person === null ? {} : (answers[person.ref] ?? {});
  const [draft, setDraft] = useState<Record<string, DayAnswer | null>>({});
  const [draftFor, setDraftFor] = useState(person?.ref);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<FormState>({});
  const [reschedule, setReschedule] = useState<string | null>(null);
  // Terminy dalej niż 16 dni: klimat z jednego pobrania dla całego okna ankiety.
  const far = poll !== null && terms.some((term) => needsClimate(term.start, trip.today));
  const climatePlace = useClimatePlace(far ? { source: climateFrom } : {});
  const climate = useClimate(far ? climatePlace : null, poll?.from ?? null, poll?.to ?? null, trip.today);
  const termClimate = (term: TermOption) => (climate.data !== null && needsClimate(term.start, trip.today) ? climateFor(climate.data, term.start, term.end) : null);
  const anyClimate = terms.map(termClimate).find((each) => each !== null) ?? null;
  // Zmiana osoby = niezapisane kliknięcia poprzedniej przepadają.
  if (draftFor !== person?.ref) {
    setDraftFor(person?.ref);
    setDraft({});
  }

  if (poll === null) {
    return (
      <section className={card}>
        <h2 className="card-title">Termin wyjazdu</h2>
        <p className="text-sm text-zinc-500">Nie ma ankiety terminu.{canEdit ? " Podaj okno, w którym szukacie terminu — każdy zaznaczy dni, w które może." : ""}</p>
        {canEdit && <PollForm tripId={tripId} poll={null} />}
      </section>
    );
  }

  const days: string[] = [];
  for (let date = poll.from; date <= poll.to; date = addDays(date, 1)) days.push(date);
  const current = (date: string): DayAnswer | null => (date in draft ? draft[date]! : (saved[date] ?? null));
  const changed = Object.keys(draft).filter((date) => (draft[date] ?? null) !== (saved[date] ?? null));
  const months = [...new Set(days.map((date) => date.slice(0, 7)))];
  const closed = poll.closesOn !== undefined && poll.closesOn < trip.today;

  return (
    <section className={card}>
      <h2 className="card-title">Termin wyjazdu</h2>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Szukamy {length} {length === 1 ? "dnia" : "dni"} między {dayMonth(poll.from)} a {dayMonth(poll.to)}
        {poll.closesOn ? ` · odpowiedzi do ${dayMonth(poll.closesOn)}${closed ? " (minęło)" : ""}` : ""}. Teraz w planie: {dayMonth(trip.startDate)} – {dayMonth(trip.endDate)}.
      </p>

      {person !== null && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-zinc-500">
            Kliknij dzień: <span className={`rounded px-1 ${TONE.yes}`}>{DAY_ANSWER.yes}</span> → <span className={`rounded px-1 ${TONE.maybe}`}>{DAY_ANSWER.maybe}</span> → <span className={`rounded px-1 ${TONE.no}`}>{DAY_ANSWER.no}</span> → bez odpowiedzi. Liczby pod datą: ile osób może / nie może (z {travelerCount}).
          </p>
          <div className="flex flex-wrap gap-4">
            {months.map((month) => {
              const inMonth = days.filter((date) => date.startsWith(month));
              return (
                <div key={month} className="flex flex-col gap-1">
                  <p className="text-xs font-medium text-zinc-500">{new Intl.DateTimeFormat("pl-PL", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-15T12:00:00Z`))}</p>
                  <div className="grid grid-cols-7 gap-1 text-center text-[11px]">
                    {["pn", "wt", "śr", "cz", "pt", "so", "nd"].map((name) => (
                      <span key={name} className="text-zinc-400">
                        {name}
                      </span>
                    ))}
                    {Array.from({ length: weekday(inMonth[0]!) }, (_, index) => (
                      <span key={`pusty-${index}`} />
                    ))}
                    {inMonth.map((date) => {
                      const answer = current(date);
                      const counts = dayCounts[date];
                      return (
                        <button
                          key={date}
                          type="button"
                          disabled={pending}
                          title={`${dayChip(date)}: ${answer ? DAY_ANSWER[answer] : "bez odpowiedzi"}`}
                          onClick={() => setDraft({ ...draft, [date]: NEXT[answer ?? "none"] })}
                          className={`flex size-10 flex-col items-center justify-center rounded leading-tight ${TONE[answer ?? "none"]} ${date in draft ? "ring-2 ring-signal" : ""}`}>
                          <span className="text-sm font-medium">{Number(date.slice(8))}</span>
                          {counts && (counts.yes > 0 || counts.no > 0) && (
                            <span className="opacity-75">
                              {counts.yes}/{counts.no}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={pending || changed.length === 0}
              onClick={() =>
                start(async () => {
                  const result = await saveAvailability(tripId, person.id, changed.map((day) => ({ day, answer: draft[day] ?? null })));
                  setMessage(result);
                  if (result.ok) setDraft({});
                })
              }
              className="btn-primary btn-sm">
              {pending ? "Zapisuję…" : `Zapisz dostępność${changed.length > 0 ? ` (${changed.length})` : ""}`}
            </button>
            <button type="button" disabled={pending} onClick={() => setDraft(Object.fromEntries(days.filter((date) => current(date) === null).map((date) => [date, "yes" as const])))} className="btn-mini">
              puste dni: mogę
            </button>
            {changed.length > 0 && (
              <button type="button" disabled={pending} onClick={() => setDraft({})} className="btn-secondary btn-sm">
                Anuluj
              </button>
            )}
            {message.ok && <span className="text-xs text-emerald-700 dark:text-emerald-400">{message.ok}</span>}
            {message.error && <span className="text-xs text-red-600">{message.error}</span>}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1 text-sm">
        <p className="font-medium">Najlepsze terminy</p>
        {terms.length === 0 ? (
          <p className="text-zinc-500">Okno jest krótsze niż wyjazd ({length} dni) — wydłuż je.</p>
        ) : (
          <ol className="flex flex-col gap-1.5">
            {terms.map((term) => (
              <li key={term.start} className="flex flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">
                    {dayChip(term.start)} – {dayChip(term.end)}
                  </span>
                  {term.start === trip.startDate && <span className="chip">obecny termin</span>}
                  {canEdit && term.start !== trip.startDate && (
                    <button type="button" onClick={() => setReschedule(term.start)} className="btn-mini">
                      ustaw ten termin
                    </button>
                  )}
                </span>
                <span className="text-xs text-zinc-500">
                  {[
                    term.yes.length > 0 ? `mogą: ${term.yes.join(", ")}` : null,
                    term.maybe.length > 0 ? `może: ${term.maybe.join(", ")}` : null,
                    term.blocked.length > 0 ? `nie mogą: ${term.blocked.join(", ")}` : null,
                    term.unknown.length > 0 ? `bez odpowiedzi: ${term.unknown.join(", ")}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                {termClimate(term) !== null && <span className="text-xs text-zinc-500">klimat: {climateLine(termClimate(term)!)}</span>}
              </li>
            ))}
          </ol>
        )}
        {anyClimate !== null && (
          <p className="text-xs text-zinc-500">
            Klimat{climatePlace ? ` (${climatePlace.name})` : ""}: {climateYearsText(anyClimate)} dla tych dni kalendarza, bo prognoza sięga tylko 16 dni. Źródło: <ClimateCredit place={climatePlace} />.
          </p>
        )}
      </div>
      {canEdit && <PollForm tripId={tripId} poll={poll} />}
      {reschedule !== null && <RescheduleDialog tripId={tripId} startDate={trip.startDate} endDate={trip.endDate} today={trip.today} initial={reschedule} onClose={() => setReschedule(null)} />}
    </section>
  );
}

function PollForm({ tripId, poll }: { tripId: string; poll: DatePoll | null }) {
  const [state, action, pending] = useActionState(saveDatePoll.bind(null, tripId), {} as FormState);
  const input = "field px-2 py-1 text-sm";
  return (
    <form action={action} className="flex flex-col gap-2 border-t border-zinc-200 pt-3 text-xs text-zinc-500 dark:border-zinc-800">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          Szukamy od
          <input type="date" name="from" defaultValue={poll?.from ?? ""} className={input} />
        </label>
        <label className="flex flex-col gap-1">
          do
          <input type="date" name="to" defaultValue={poll?.to ?? ""} className={input} />
        </label>
        <label className="flex flex-col gap-1">
          Odpowiedzi do (opcjonalnie)
          <input type="date" name="closesOn" defaultValue={poll?.closesOn ?? ""} className={input} />
        </label>
        <button disabled={pending} className="btn-primary btn-sm">
          {poll === null ? "Otwórz ankietę terminu" : "Zapisz okno"}
        </button>
      </div>
      <p>Długość terminu to długość wyjazdu. Okno najwyżej na 4 miesiące; puste daty zamykają ankietę (odpowiedzi zostają).</p>
      {state.ok && <p className="text-emerald-700 dark:text-emerald-400">{state.ok}</p>}
      {state.error && <p className="text-red-600">{state.error}</p>}
    </form>
  );
}
