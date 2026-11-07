"use client";

import { BOOKING_KIND, BUDGET_CATEGORY, BUDGET_LINE_STATUS, type BudgetSuggestion, CONTACT_ROLE, formatMoneyRange, fxLine, lineTravelerNames, moneyToInput, PRICE_BASIS, type TripDocument } from "@expeditionplan/core";
import Link from "next/link";
import { Fragment, type ReactNode, startTransition, useActionState, useEffect, useState, useTransition } from "react";

import type { FormState } from "@/app/actions";
import { bookingAnchor, contactAnchor } from "@/lib/booking-link";
import {
  addSuggestedBudgetLine,
  removeBudgetLine,
  removeCancelledBooking,
  removeContact,
  removeShoppingItem,
  removeTask,
  saveBooking,
  setBookingStatus,
  setSelfCooked,
  saveBudgetLine,
  saveContact,
  fetchFx,
  saveFx,
  saveShoppingItem,
  saveTask,
  setBookingItems,
  setExpenseSplits,
  setTaskStatus,
  setTripCurrency,
} from "@/app/logistics-actions";

/**
 * Edycja na stronie „Rezerwacje, budżet i zadania”: każda zmiana to akcja serwera, która sprawdza
 * cały dokument i odświeża stronę (sumy budżetu liczą się na nowo po stronie serwera).
 */

type Doc = TripDocument;
type Line = Doc["budgetLines"][number];
type Task = Doc["tasks"][number];
type Booking = Doc["bookings"][number];
type Contact = Doc["contacts"][number];

// `min-w-0`: lista wyboru ma szerokość najdłuższej opcji i bez tego rozpycha kartę na telefonie.
const input = "field min-w-0 px-2 py-1 text-sm";
const small = "btn-mini";
const danger = "btn-mini btn-mini-danger";
const primary = "btn-primary btn-sm";

function Status({ state }: { state: FormState }) {
  if (state.error) return <p className="text-xs text-red-600">{state.error}</p>;
  if (state.ok) return <p className="text-xs text-green-700 dark:text-green-400">{state.ok}</p>;
  return null;
}

/** Przycisk akcji bez formularza (usuń, odhacz) z potwierdzeniem i wynikiem. */
function useAction() {
  const [state, setState] = useState<FormState>({});
  const [pending, start] = useTransition();
  const run = (action: () => Promise<FormState>, confirm?: string) => {
    if (confirm !== undefined && !window.confirm(confirm)) return;
    start(async () => setState(await action()));
  };
  return { state, pending, run };
}

// --- Budżet ---------------------------------------------------------------------------------


type Person = { ref: string; name: string };

/** „Wszyscy” albo wybrane osoby; pusta lista = wszyscy, a komplet wybranych wraca do „wszyscy”. */
function ForWhomPicker({ people, chosen, onChange }: { people: Person[]; chosen: string[]; onChange: (chosen: string[]) => void }) {
  const toggle = (ref: string) => {
    const next = chosen.includes(ref) ? chosen.filter((each) => each !== ref) : [...chosen, ref];
    onChange(next.length === people.length ? [] : next);
  };
  return (
    <fieldset className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
      <legend className="sr-only">Kogo dotyczy</legend>
      kogo dotyczy:
      <label className="flex items-center gap-1">
        <input type="checkbox" checked={chosen.length === 0} onChange={() => onChange([])} /> wszyscy
      </label>
      {people.map((person) => (
        <label key={person.ref} className="flex items-center gap-1">
          <input type="checkbox" name="for" value={person.ref} checked={chosen.includes(person.ref)} onChange={() => toggle(person.ref)} /> {person.name}
        </label>
      ))}
    </fieldset>
  );
}

/** Na kogo dzieli się wydatek: wiersz przy wydatku, po „zmień” wybór osób. `people` i `chosen` po id z bazy. */
export function ExpenseSplitEditor({ tripId, expenseId, people, chosen, canEdit }: { tripId: string; expenseId: string; people: Person[]; chosen: string[]; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(chosen);
  const save = useAction();
  const names = people.filter((person) => chosen.includes(person.ref)).map((person) => person.name);
  if (names.length === 0 && !canEdit) return null;
  if (!editing)
    return (
      <span className="block text-xs text-zinc-500">
        na: {names.length === 0 ? "wszystkich" : names.join(", ")}
        {canEdit && (
          <>
            {" "}
            <button
              onClick={() => {
                setValue(chosen);
                setEditing(true);
              }}
              className={small}
            >
              zmień
            </button>
          </>
        )}
      </span>
    );
  return (
    <div className="flex flex-col gap-1">
      <ForWhomPicker people={people} chosen={value} onChange={setValue} />
      <div className="flex items-center gap-2">
        <button
          disabled={save.pending}
          onClick={() =>
            save.run(async () => {
              const result = await setExpenseSplits(tripId, expenseId, value);
              if (result.ok) setEditing(false);
              return result;
            })
          }
          className={primary}
        >
          {save.pending ? "Zapisuję…" : "Zapisz"}
        </button>
        <button onClick={() => setEditing(false)} className="btn-secondary btn-sm">
          Anuluj
        </button>
      </div>
      <Status state={save.state} />
    </div>
  );
}

function BudgetForm({ tripId, line, currency, people, onDone }: { tripId: string; line?: Line; currency: string; people: Person[]; onDone?: () => void }) {
  const [chosen, setChosen] = useState(line?.participantRefs ?? []);
  const [state, action, pending] = useActionState(async (prev: FormState, form: FormData) => {
    const result = await saveBudgetLine(tripId, line?.ref ?? null, prev, form);
    if (result.ok && onDone) onDone();
    return result;
  }, {});
  return (
    <form action={action} className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <input name="title" required defaultValue={line?.title} placeholder="np. Nocleg w Marakeszu" className={`${input} min-w-48 flex-1`} aria-label="Pozycja" />
        <select name="category" defaultValue={line?.category ?? "other"} className={input} aria-label="Kategoria">
          {Object.entries(BUDGET_CATEGORY).map(([key, name]) => (
            <option key={key} value={key}>
              {name}
            </option>
          ))}
        </select>
        <select name="status" defaultValue={line?.status ?? "estimate"} className={input} aria-label="Status">
          {Object.entries(BUDGET_LINE_STATUS).map(([key, name]) => (
            <option key={key} value={key}>
              {name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input name="low" required defaultValue={line ? moneyToInput(line.lowMinor) : ""} placeholder="kwota" inputMode="decimal" className={`${input} w-28`} aria-label="Kwota od" />
        <span className="text-xs text-zinc-500">do</span>
        <input name="high" defaultValue={line && line.highMinor !== line.lowMinor ? moneyToInput(line.highMinor) : ""} placeholder="(opcjonalnie)" inputMode="decimal" className={`${input} w-28`} aria-label="Kwota do" />
        <input name="currency" required defaultValue={line?.currency ?? currency} maxLength={3} className={`${input} w-16 uppercase`} aria-label="Waluta" />
        <label className="flex items-center gap-1 text-xs">
          <input name="perPerson" type="checkbox" defaultChecked={line?.perPerson ?? false} /> na osobę
        </label>
        <input name="note" defaultValue={line?.note} placeholder="notatka" className={`${input} min-w-32 flex-1`} aria-label="Notatka" />
      </div>
      {people.length > 1 && <ForWhomPicker people={people} chosen={chosen} onChange={setChosen} />}
      <div className="flex gap-2">
        <button disabled={pending} className={primary}>
          {pending ? "Zapisuję…" : line ? "Zapisz" : "Dodaj pozycję"}
        </button>
        {onDone && (
          <button type="button" onClick={onDone} className="btn-secondary btn-sm">
            Anuluj
          </button>
        )}
      </div>
      <Status state={state} />
    </form>
  );
}

export function BudgetLines({ tripId, lines, currency, people, canEdit }: { tripId: string; lines: Line[]; currency: string; people: Person[]; canEdit: boolean }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const remove = useAction();
  return (
    <div className="flex flex-col gap-3">
      {lines.length > 0 && (
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-zinc-500">
            <tr>
              <th className="py-1 font-normal">Pozycja</th>
              <th className="hidden py-1 font-normal sm:table-cell">Kategoria</th>
              <th className="hidden py-1 font-normal sm:table-cell">Status</th>
              <th className="py-1 text-right font-normal">Kwota</th>
              {canEdit && <th className="py-1" />}
            </tr>
          </thead>
          <tbody>
            {lines.map((line) =>
              editing === line.ref ? (
                <tr key={line.ref} className="border-t border-zinc-100 dark:border-zinc-900">
                  <td colSpan={5} className="py-2">
                    <BudgetForm tripId={tripId} line={line} currency={currency} people={people} onDone={() => setEditing(null)} />
                  </td>
                </tr>
              ) : (
                <tr key={line.ref} className="border-t border-zinc-100 dark:border-zinc-900">
                  <td className="py-1">
                    {line.title}
                    {line.perPerson ? <span className="text-zinc-500"> · na osobę</span> : null}
                    {/* Na telefonie kategoria i status pod nazwą — pięć kolumn się nie mieści. */}
                    <span className="block text-xs text-zinc-500 sm:hidden">
                      {BUDGET_CATEGORY[line.category] ?? line.category} · {BUDGET_LINE_STATUS[line.status]}
                    </span>
                    {lineTravelerNames(people, line) !== null && <span className="block text-xs text-zinc-500">dotyczy: {lineTravelerNames(people, line)!.join(", ")}</span>}
                    {line.note ? <span className="block text-xs text-zinc-500">{line.note}</span> : null}
                  </td>
                  <td className="hidden py-1 pr-3 text-zinc-500 sm:table-cell">{BUDGET_CATEGORY[line.category] ?? line.category}</td>
                  <td className="hidden py-1 pr-3 text-zinc-500 sm:table-cell">{BUDGET_LINE_STATUS[line.status]}</td>
                  <td className="py-1 text-right font-mono whitespace-nowrap">
                    {formatMoneyRange(line.lowMinor, line.highMinor, line.currency)}
                  </td>
                  {canEdit && (
                    <td className="py-1 pl-2 text-right whitespace-nowrap text-zinc-500">
                      <button onClick={() => setEditing(line.ref)} className={small}>
                        edytuj
                      </button>
                      <br className="sm:hidden" />{" "}
                      <button disabled={remove.pending} onClick={() => remove.run(() => removeBudgetLine(tripId, line.ref), `Usunąć pozycję „${line.title}”?`)} className={danger}>
                        usuń
                      </button>
                    </td>
                  )}
                </tr>
              ),
            )}
          </tbody>
        </table>
      )}
      <Status state={remove.state} />
      {canEdit &&
        (adding ? (
          <BudgetForm tripId={tripId} currency={currency} people={people} onDone={() => setAdding(false)} />
        ) : (
          <button onClick={() => setAdding(true)} className="btn-secondary btn-sm self-start">
            + Dodaj pozycję budżetu
          </button>
        ))}
    </div>
  );
}

// --- Zadania --------------------------------------------------------------------------------

const TASK_KIND: Record<string, string> = { todo: "do zrobienia", question: "pytanie", decision: "decyzja" };

/** Listy do wyboru w formularzach (osoby, punkty, rezerwacje, dni, decyzje) — liczone na stronie. */
export type Choices = {
  travelers: { ref: string; name: string }[];
  items: { ref: string; label: string }[];
  bookings: { ref: string; title: string }[];
  days: { ref: string; label: string }[];
  groups: { ref: string; title: string }[];
};

const DUE: Record<string, string> = {
  "": "bez terminu",
  absolute: "do dnia",
  before_trip: "N dni przed wyjazdem",
  before_item: "N dni przed punktem",
  before_booking: "przed rezerwacją",
  on_trip: "w trakcie wyjazdu",
};

function TaskForm({ tripId, task, choices, onDone }: { tripId: string; task?: Task; choices: Choices; onDone?: () => void }) {
  const [state, action, pending] = useActionState(async (prev: FormState, form: FormData) => {
    const result = await saveTask(tripId, task?.ref ?? null, prev, form);
    if (result.ok && onDone) onDone();
    return result;
  }, {});
  const [kind, setKind] = useState(task?.kind ?? "todo");
  const [dueKind, setDueKind] = useState<string>(task?.due?.kind ?? "");
  const due = task?.due;
  const dueTime = due && "time" in due ? (due.time ?? "") : "";
  return (
    <form action={action} className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <input name="title" required defaultValue={task?.title} placeholder="np. Kupić eSIM" className={`${input} min-w-48 flex-1`} aria-label="Zadanie" />
        <select name="kind" value={kind} onChange={(event) => setKind(event.target.value as Task["kind"])} className={input} aria-label="Rodzaj">
          {Object.entries(TASK_KIND).map(([key, name]) => (
            <option key={key} value={key}>
              {name}
            </option>
          ))}
        </select>
        <select name="priority" defaultValue={task?.priority ?? "normal"} className={input} aria-label="Priorytet">
          <option value="high">pilne</option>
          <option value="normal">zwykłe</option>
          <option value="low">kiedyś</option>
        </select>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select name="dueKind" value={dueKind} onChange={(event) => setDueKind(event.target.value)} className={input} aria-label="Rodzaj terminu">
          {Object.entries(DUE).map(([key, name]) => (
            <option key={key} value={key}>
              {name}
            </option>
          ))}
        </select>
        {dueKind === "absolute" && <input name="dueDate" type="date" required defaultValue={due?.kind === "absolute" ? due.date : ""} className={input} aria-label="Data" />}
        {(dueKind === "before_trip" || dueKind === "before_item") && (
          <label className="flex items-center gap-1 text-xs text-zinc-500">
            <input name="dueDays" type="number" min={0} defaultValue={due && "days" in due ? due.days : 1} className={`${input} w-16`} aria-label="Ile dni przed" /> dni przed
          </label>
        )}
        {dueKind === "before_item" && (
          <select name="dueItem" required defaultValue={due?.kind === "before_item" ? due.itemRef : ""} className={`${input} max-w-64`} aria-label="Punkt planu">
            <option value="">— punkt planu —</option>
            {choices.items.map((item) => (
              <option key={item.ref} value={item.ref}>
                {item.label}
              </option>
            ))}
          </select>
        )}
        {dueKind === "before_booking" && (
          <select name="dueBooking" required defaultValue={due?.kind === "before_booking" ? due.bookingRef : ""} className={`${input} max-w-64`} aria-label="Rezerwacja">
            <option value="">— rezerwacja —</option>
            {choices.bookings.map((booking) => (
              <option key={booking.ref} value={booking.ref}>
                {booking.title}
              </option>
            ))}
          </select>
        )}
        {dueKind === "on_trip" && (
          <select name="dueDay" defaultValue={due?.kind === "on_trip" ? (due.dayRef ?? "") : ""} className={input} aria-label="Dzień">
            <option value="">— któregoś dnia —</option>
            {choices.days.map((day) => (
              <option key={day.ref} value={day.ref}>
                {day.label}
              </option>
            ))}
          </select>
        )}
        {(dueKind === "absolute" || dueKind === "on_trip") && <input name="dueTime" type="time" defaultValue={dueTime} className={input} aria-label="Godzina" />}
      </div>
      <textarea name="body" defaultValue={task?.body} placeholder="opis (opcjonalnie)" rows={2} className={input} aria-label="Opis" />
      {(kind === "question" || kind === "decision") && <textarea name="answer" defaultValue={task?.answer} placeholder="odpowiedź / decyzja" rows={2} className={input} aria-label="Odpowiedź" />}
      {choices.travelers.length > 0 && (
        <fieldset className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
          <legend className="sr-only">Kto</legend>
          kto:
          {choices.travelers.map((traveler) => (
            <label key={traveler.ref} className="flex items-center gap-1">
              <input type="checkbox" name="assignee" value={traveler.ref} defaultChecked={task?.assigneeRefs.includes(traveler.ref)} /> {traveler.name}
            </label>
          ))}
        </fieldset>
      )}
      <div className="flex flex-wrap gap-2">
        <select name="bookingRef" defaultValue={task?.bookingRef ?? ""} className={`${input} max-w-56`} aria-label="Dotyczy rezerwacji">
          <option value="">— rezerwacja —</option>
          {choices.bookings.map((booking) => (
            <option key={booking.ref} value={booking.ref}>
              {booking.title}
            </option>
          ))}
        </select>
        <select name="itemRef" defaultValue={task?.itemRef ?? ""} className={`${input} max-w-56`} aria-label="Dotyczy punktu">
          <option value="">— punkt planu —</option>
          {choices.items.map((item) => (
            <option key={item.ref} value={item.ref}>
              {item.label}
            </option>
          ))}
        </select>
        {kind === "decision" && (
          <select name="variantGroupRef" defaultValue={task?.variantGroupRef ?? ""} className={`${input} max-w-56`} aria-label="Wybór w planie">
            <option value="">— wybór w planie (warianty) —</option>
            {choices.groups.map((group) => (
              <option key={group.ref} value={group.ref}>
                {group.title}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="flex gap-2">
        <button disabled={pending} className={primary}>
          {pending ? "Zapisuję…" : task ? "Zapisz" : "Dodaj zadanie"}
        </button>
        {onDone && (
          <button type="button" onClick={onDone} className="btn-secondary btn-sm">
            Anuluj
          </button>
        )}
      </div>
      <Status state={state} />
    </form>
  );
}
/** Kolumny wiersza zadania, liczone na stronie, bo potrzebują całego planu. */
export type TaskColumns = { due: string; who: string };

/** Tabela zadań, jak budżet i rezerwacje. `checkable` — zadania do odhaczenia także w podglądzie (organizator, edytor, widz przy swoich). */
export function TaskList({ tripId, tasks, columns, choices, canEdit, checkable = [] }: { tripId: string; tasks: Task[]; columns: Record<string, TaskColumns>; choices: Choices; canEdit: boolean; checkable?: string[] }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const action = useAction();
  const open = tasks.filter((task) => task.status === "open");
  const closed = tasks.filter((task) => task.status !== "open");
  const checkColumn = canEdit || checkable.length > 0;
  const span = 4 + (checkColumn ? 1 : 0) + (canEdit ? 1 : 0);
  const buttons = (task: Task) => (
    <>
      <button onClick={() => setEditing(task.ref)} className={small}>
        edytuj
      </button>
      <button disabled={action.pending} onClick={() => action.run(() => removeTask(tripId, task.ref), `Usunąć zadanie „${task.title}”?`)} className={danger}>
        usuń
      </button>
    </>
  );
  const row = (task: Task) => {
    if (editing === task.ref) {
      return (
        <tr key={task.ref} className="border-t border-zinc-100 dark:border-zinc-900">
          <td colSpan={span} className="py-2">
            <TaskForm tripId={tripId} task={task} choices={choices} onDone={() => setEditing(null)} />
          </td>
        </tr>
      );
    }
    const { due, who } = columns[task.ref] ?? { due: "", who: "" };
    const muted = task.status !== "open" ? "text-zinc-400 line-through" : "";
    return (
      <Fragment key={task.ref}>
        <tr className="border-t border-zinc-100 dark:border-zinc-900">
          {checkColumn && (
            <td className="w-6 py-1 pr-2 align-top">
              {(canEdit || checkable.includes(task.ref)) && (
                <input
                  type="checkbox"
                  checked={task.status === "done"}
                  disabled={action.pending}
                  onChange={() => action.run(() => setTaskStatus(tripId, task.ref, task.status === "open" ? "done" : "open"))}
                  className="mt-1"
                  aria-label={task.status === "open" ? "Zrobione" : "Otwórz ponownie"}
                />
              )}
            </td>
          )}
          <td className="py-1 pr-3 align-top break-words">
            <span className={`block ${muted}`}>
              {task.priority === "high" ? <span className="text-red-600" title="pilne">! </span> : null}
              {task.title}
            </span>
            {/* Na telefonie rodzaj, termin, osoby i działania pod nazwą: tyle kolumn się nie mieści. */}
            <span className="block text-xs text-zinc-500 sm:hidden">{[TASK_KIND[task.kind], due, who].filter(Boolean).join(" · ")}</span>
            {canEdit && <span className="mt-1 flex gap-1 sm:hidden">{buttons(task)}</span>}
          </td>
          <td className="hidden py-1 pr-3 align-top whitespace-nowrap text-zinc-500 sm:table-cell">{TASK_KIND[task.kind]}</td>
          <td className="hidden py-1 pr-3 align-top text-zinc-500 sm:table-cell">{due}</td>
          <td className="hidden py-1 pr-3 align-top text-zinc-500 sm:table-cell">{who}</td>
          {canEdit && (
            <td className="hidden py-1 pl-2 align-top sm:table-cell">
              <div className="flex items-center justify-end gap-1 whitespace-nowrap">{buttons(task)}</div>
            </td>
          )}
        </tr>
        {/* Opis i odpowiedź na całą szerokość tabeli, żeby nie ściskały kolumny z nazwą. */}
        {(task.body || task.answer) && (
          <tr>
            {checkColumn && <td />}
            <td colSpan={span - (checkColumn ? 1 : 0)} className="pb-1.5 text-xs break-words">
              {task.body && <span className="block whitespace-pre-line text-zinc-500">{task.body}</span>}
              {task.answer && <span className="block whitespace-pre-line text-green-700 dark:text-green-400">→ {task.answer}</span>}
            </td>
          </tr>
        )}
      </Fragment>
    );
  };
  const table = (rows: Task[]) => (
    <table className="w-full text-left text-sm">
      <thead className="text-xs text-zinc-500">
        <tr>
          {checkColumn && <th className="w-6 py-1 font-normal"><span className="sr-only">Zrobione</span></th>}
          <th className="py-1 font-normal">Zadanie</th>
          <th className="hidden py-1 font-normal sm:table-cell">Rodzaj</th>
          <th className="hidden py-1 font-normal sm:table-cell">Termin</th>
          <th className="hidden py-1 font-normal sm:table-cell">Kto</th>
          {canEdit && <th className="hidden py-1 sm:table-cell" />}
        </tr>
      </thead>
      <tbody>{rows.map(row)}</tbody>
    </table>
  );
  return (
    <div className="flex flex-col gap-3 text-sm">
      {open.length > 0 && table(open)}
      <Status state={action.state} />
      {canEdit &&
        (adding ? (
          <TaskForm tripId={tripId} choices={choices} onDone={() => setAdding(false)} />
        ) : (
          <button onClick={() => setAdding(true)} className="btn-secondary btn-sm self-start">
            + Dodaj zadanie
          </button>
        ))}
      {closed.length > 0 && (
        <button onClick={() => setShowClosed(!showClosed)} className="btn-mini self-start">
          {showClosed ? "Ukryj zamknięte" : `Pokaż zamknięte (${closed.length})`}
        </button>
      )}
      {showClosed && table(closed)}
    </div>
  );
}

// --- Rezerwacje -----------------------------------------------------------------------------

const label = "flex min-w-0 flex-col gap-1 text-xs text-zinc-500";

/** Rezerwacja: nowa albo zmiana. Pola zależne od rodzaju (lot, auto, nocleg) pokazują się po wyborze rodzaju. */
/** Status rezerwacji jako lista wyboru (organizator, edytor — także w podglądzie): zapis od razu po wyborze. */
export function BookingStatusSelect({ tripId, bookingRef, status, statuses, tone }: { tripId: string; bookingRef: string; status: string; statuses: Record<string, string>; tone: string }) {
  const action = useAction();
  return (
    <span className="inline-flex items-center gap-1">
      <select
        value={status}
        disabled={action.pending}
        onChange={(event) => action.run(() => setBookingStatus(tripId, bookingRef, event.target.value))}
        aria-label="Status rezerwacji"
        title="Zmień status (np. zapłacone)"
        className={`cursor-pointer rounded border border-transparent bg-transparent text-xs [field-sizing:content] hover:border-zinc-300 dark:hover:border-zinc-700 ${tone}`}>
        {Object.entries(statuses).map(([key, name]) => (
          <option key={key} value={key}>
            {name}
          </option>
        ))}
      </select>
      {action.pending && <span className="text-xs text-zinc-500">zapisuję…</span>}
      {action.state.error && <span className="text-xs text-red-600">{action.state.error}</span>}
    </span>
  );
}

/** „Usuń z listy” przy anulowanej rezerwacji; `note` mówi, co straci powiązanie. */
export function RemoveCancelledBooking({ tripId, bookingRef, title, note }: { tripId: string; bookingRef: string; title: string; note: string }) {
  const action = useAction();
  const question = [`Usunąć anulowaną rezerwację „${title}” z listy? W aplikacji nie da się tego cofnąć.`, note, "Jej dokumenty z sejfu (jeśli są) zostaną w „Inne dokumenty”."].filter(Boolean).join("\n\n");
  return (
    <span className="inline-flex items-center gap-1">
      <button type="button" disabled={action.pending} onClick={() => action.run(() => removeCancelledBooking(tripId, bookingRef), question)} className="btn-mini btn-mini-danger">
        {action.pending ? "usuwam…" : "usuń z listy"}
      </button>
      {action.state.error && <span className="text-xs text-red-600">{action.state.error}</span>}
    </span>
  );
}

type PlaceOption = Doc["places"][number];

function BookingForm({ tripId, booking, statuses, zones, places, onDone }: { tripId: string; booking?: Booking; statuses: Record<string, string>; zones: string[]; places: PlaceOption[]; onDone: () => void }) {
  const [state, action, pending] = useActionState(async (prev: FormState, form: FormData) => {
    const result = await saveBooking(tripId, booking?.ref ?? null, prev, form);
    if (result.ok) onDone();
    return result;
  }, {});
  const [kind, setKind] = useState(booking?.kind ?? "lodging");
  const refundable = booking?.refundable === true ? "yes" : booking?.refundable === false ? "no" : "";
  const price = booking?.price;
  const listId = `zones-${booking?.ref ?? "new"}`;
  const placeListId = `places-${booking?.ref ?? "new"}`;
  const place = places.find((each) => each.ref === booking?.startPlaceRef);
  // Sam `action` czyści formularz po każdej odpowiedzi serwera, także po błędzie: wpisane dane by przepadły.
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => action(data));
  };
  return (
    <form action={action} onSubmit={submit} className="mt-1 flex flex-col gap-3 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
      <datalist id={listId}>
        {zones.map((zone) => (
          <option key={zone} value={zone} />
        ))}
      </datalist>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className={`${label} sm:col-span-2`}>
          Nazwa
          <input name="title" required defaultValue={booking?.title} placeholder="np. Riad Lakhdar, noc 1" className={input} />
        </label>
        <label className={label}>
          Rodzaj
          <select name="kind" value={kind} onChange={(event) => setKind(event.target.value as Booking["kind"])} className={input}>
            {Object.entries(BOOKING_KIND).map(([key, name]) => (
              <option key={key} value={key}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Status
          <select name="status" defaultValue={booking?.status ?? "to_book"} className={input}>
            {Object.entries(statuses).map(([key, name]) => (
              <option key={key} value={key}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          {kind === "flight" ? "Linia lotnicza" : "Firma / obiekt"}
          <input name="provider" defaultValue={booking?.provider} className={input} />
        </label>
        <label className={label}>
          Kod rezerwacji
          <input name="confirmationCode" defaultValue={booking?.confirmationCode} className={input} />
        </label>
      </div>

      <div className="grid gap-2 sm:grid-cols-[auto_auto_1fr]">
        {(["start", "end"] as const).map((part) => {
          const time = booking?.[part];
          return (
            <div key={part} className="contents">
              <label className={label}>
                {part === "start" ? (kind === "lodging" ? "Zameldowanie — dzień" : "Początek") : kind === "lodging" ? "Wymeldowanie — dzień" : "Koniec"}
                <input name={`${part}Date`} type="date" defaultValue={time?.date ?? ""} className={input} />
              </label>
              <label className={label}>
                godzina
                <input name={`${part}Time`} type="time" defaultValue={time?.time ?? ""} className={input} />
              </label>
              <label className={label}>
                strefa czasowa
                <input name={`${part}Tz`} list={listId} defaultValue={time?.tz ?? ""} placeholder="strefa wyjazdu" className={input} />
              </label>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className={label}>
          Cena od
          <input name="priceLow" defaultValue={price ? moneyToInput(price.minMinor) : ""} inputMode="decimal" className={`${input} w-28`} />
        </label>
        <label className={label}>
          do
          <input name="priceHigh" defaultValue={price && price.maxMinor !== price.minMinor ? moneyToInput(price.maxMinor) : ""} inputMode="decimal" className={`${input} w-28`} />
        </label>
        <label className={label}>
          waluta
          <input name="priceCurrency" defaultValue={price?.currency ?? "PLN"} maxLength={3} className={`${input} w-16 uppercase`} />
        </label>
        <label className={label}>
          za
          <select name="priceBasis" defaultValue={price?.basis ?? "per_group"} className={input}>
            {Object.entries(PRICE_BASIS).map(([key, name]) => (
              <option key={key} value={key}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1 pb-1 text-xs text-zinc-500">
          <input name="priceApprox" type="checkbox" defaultChecked={price?.approx ?? false} /> szacunek
        </label>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className={label}>
          Zapłacono
          <input name="paidAmount" defaultValue={booking?.paid ? moneyToInput(booking.paid.amountMinor) : ""} inputMode="decimal" className={`${input} w-28`} />
        </label>
        <label className={label}>
          waluta
          <input name="paidCurrency" defaultValue={booking?.paid?.currency ?? price?.currency ?? "PLN"} maxLength={3} className={`${input} w-16 uppercase`} />
        </label>
        <label className={label}>
          dnia
          <input name="paidOn" type="date" defaultValue={booking?.paid?.date ?? ""} className={input} />
        </label>
        <label className={label}>
          Płatność
          <select name="payWhen" defaultValue={booking?.payWhen ?? ""} className={input}>
            <option value="">—</option>
            <option value="prepaid">z góry</option>
            <option value="before_arrival">przed przyjazdem</option>
            <option value="on_site">na miejscu</option>
          </select>
        </label>
        <label className={label}>
          czym
          <select name="paymentMethod" defaultValue={booking?.paymentMethod ?? ""} className={input}>
            <option value="">—</option>
            <option value="cash">gotówka</option>
            <option value="card">karta</option>
            <option value="credit_card_only">tylko karta kredytowa</option>
            <option value="online">online</option>
          </select>
        </label>
        <label className={label}>
          Zwrotna
          <select name="refundable" defaultValue={refundable} className={input}>
            <option value="">?</option>
            <option value="yes">zwrotna</option>
            <option value="no">bezzwrotna</option>
          </select>
        </label>
        <label className={label}>
          Darmowe odwołanie do
          <input name="freeCancellationUntil" type="date" defaultValue={booking?.freeCancellationUntil ?? ""} className={input} />
        </label>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className={label}>
          Zgłoszeni dorośli
          <input name="partyAdults" type="number" min={0} defaultValue={booking?.party?.adults ?? ""} className={`${input} w-20`} />
        </label>
        <label className={label}>
          dzieci
          <input name="partyChildren" type="number" min={0} defaultValue={booking?.party?.children ?? ""} className={`${input} w-20`} />
        </label>
        <label className={`${label} min-w-64 flex-1`}>
          W cenie (po przecinku)
          <input name="includes" defaultValue={booking?.includes.join(", ")} placeholder="np. śniadanie, quad, kolacja" className={input} />
        </label>
      </div>

      {kind === "flight" && (
        <div className="flex flex-wrap items-end gap-2">
          <label className={label}>
            Nr lotu
            <input name="flightNumber" defaultValue={booking?.flight?.number} placeholder="FR 2145" className={`${input} w-28 uppercase`} />
          </label>
          <label className={label}>
            Z lotniska
            <input name="fromAirport" defaultValue={booking?.flight?.fromAirport} placeholder="WRO" className={`${input} w-20 uppercase`} />
          </label>
          <label className={label}>
            Do
            <input name="toAirport" defaultValue={booking?.flight?.toAirport} placeholder="AGA" className={`${input} w-20 uppercase`} />
          </label>
          <label className={label}>
            Bagaż
            <input name="baggage" defaultValue={booking?.flight?.baggage} placeholder="1 × 20 kg" className={input} />
          </label>
        </div>
      )}
      {kind === "car_rental" && (
        <div className="flex flex-wrap items-end gap-2">
          <label className={label}>
            Klasa / model
            <input name="carClass" defaultValue={booking?.car?.carClass} className={input} />
          </label>
          <label className={label}>
            Limit km
            <input name="kmLimit" type="number" min={1} defaultValue={booking?.car?.kmLimit ?? ""} className={`${input} w-24`} />
          </label>
          <label className={`${label} flex-1`}>
            Godziny biura
            <input name="officeHours" defaultValue={booking?.car?.officeHours} placeholder="np. 08:00–22:00" className={input} />
          </label>
        </div>
      )}
      {kind === "lodging" && (
        <div className="flex flex-col gap-1">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className={label}>
              Miejsce noclegu
              <input name="placeName" defaultValue={place?.name} list={placeListId} placeholder="np. Riad Lakhdar" className={input} />
              <datalist id={placeListId}>
                {places.map((each) => (
                  <option key={each.ref} value={each.name} />
                ))}
              </datalist>
            </label>
            <label className={label}>
              Współrzędne albo link z mapy
              <input name="placeCoordinates" defaultValue={place?.lat !== undefined && place.lng !== undefined ? `${place.lat}, ${place.lng}` : ""} placeholder="31.6295, -7.9811" className={input} />
            </label>
          </div>
          <p className="text-xs text-zinc-500">Dzięki temu nocleg jest na mapie dnia. Nowe współrzędne przenoszą to miejsce wszędzie, gdzie występuje w planie. Krótkiego linku maps.app.goo.gl nie odczytamy: otwórz go i skopiuj pełny adres.</p>
        </div>
      )}
      {kind === "lodging" && (
        <div className="flex flex-wrap items-end gap-2">
          <label className={label}>
            Zameldowanie od
            <input name="checkInFrom" type="time" defaultValue={booking?.checkInFrom ?? ""} className={input} />
          </label>
          <label className={label}>
            Wymeldowanie do
            <input name="checkOutUntil" type="time" defaultValue={booking?.checkOutUntil ?? ""} className={input} />
          </label>
          <label className={label}>
            Pokoje
            <input name="rooms" type="number" min={1} defaultValue={booking?.lodging?.rooms ?? ""} className={`${input} w-20`} />
          </label>
          <label className={`${label} flex-1`}>
            Śniadanie
            <input name="breakfast" defaultValue={booking?.lodging?.breakfast} placeholder="np. w cenie, 8:00–10:00" className={input} />
          </label>
        </div>
      )}

      <div className="flex gap-2">
        <button disabled={pending} className={primary}>
          {pending ? "Zapisuję…" : booking ? "Zapisz" : "Dodaj rezerwację"}
        </button>
        <button type="button" onClick={onDone} className="btn-secondary btn-sm">
          Anuluj
        </button>
      </div>
      <Status state={state} />
    </form>
  );
}

/**
 * Wiersz tabeli rezerwacji: komórki z danymi przychodzą ze strony, a tu działania i formularz w osobnym
 * wierszu na całą szerokość. Na telefonie działania też są w osobnym wierszu, bo kolumna się nie mieści.
 */
export function BookingRow({
  tripId,
  booking,
  statuses,
  zones,
  places,
  items,
  chosen,
  canEdit,
  actionsColumn,
  removal,
  details,
  children,
}: {
  tripId: string;
  booking: Booking;
  statuses: Record<string, string>;
  zones: string[];
  places: PlaceOption[];
  items: { ref: string; label: string }[];
  chosen: string[];
  canEdit: boolean;
  actionsColumn: boolean;
  removal: ReactNode;
  /** Szczegóły pod wierszem, na całą szerokość tabeli, żeby nie ściskały kolumny z nazwą. */
  details: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState<"edit" | "items" | null>(null);
  const buttons = canEdit ? (
    <>
      <button onClick={() => setOpen(open === "edit" ? null : "edit")} className={small}>
        edytuj
      </button>
      <button onClick={() => setOpen(open === "items" ? null : "items")} title="Punkty planu w pakiecie tej rezerwacji" className={small}>
        pakiet{chosen.length > 0 ? ` (${chosen.length})` : ""}
      </button>
    </>
  ) : null;
  return (
    <>
      <tr id={bookingAnchor(booking.ref)} className="border-t border-zinc-100 data-focus:bg-signal/10 dark:border-zinc-900">
        {children}
        {actionsColumn && (
          <td className="hidden py-1 pl-2 align-top sm:table-cell">
            <div className="flex items-center justify-end gap-1 whitespace-nowrap">
              {buttons}
              {removal}
            </div>
          </td>
        )}
      </tr>
      {details !== null && (
        <tr>
          <td colSpan={6} className="pb-1.5 text-xs text-zinc-500 [overflow-wrap:anywhere]">
            {details}
          </td>
        </tr>
      )}
      {(buttons !== null || removal !== null) && (
        <tr className="sm:hidden">
          <td colSpan={6} className="pb-1.5">
            <div className="flex flex-wrap items-center gap-1">
              {buttons}
              {removal}
            </div>
          </td>
        </tr>
      )}
      {open !== null && (
        <tr>
          <td colSpan={6} className="pb-3">
            {open === "edit" ? (
              <BookingForm tripId={tripId} booking={booking} statuses={statuses} zones={zones} places={places} onDone={() => setOpen(null)} />
            ) : (
              <BookingItemsForm tripId={tripId} bookingRef={booking.ref} items={items} chosen={chosen} onDone={() => setOpen(null)} />
            )}
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * Wejście z kotwicą (`#rezerwacja-…` z planu, `#kontakt-…` z rezerwacji): przewija do elementu i go podświetla
 * (`data-focus`). Samo `:target` nie wystarcza: przejście w aplikacji go nie ustawia, a strona dochodzi
 * strumieniem już po przewinięciu.
 */
export function HashFocus() {
  useEffect(() => {
    const focus = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      document.querySelectorAll("[data-focus]").forEach((each) => each.removeAttribute("data-focus"));
      const row = id === "" ? null : document.getElementById(id);
      if (row === null) return;
      row.setAttribute("data-focus", "");
      row.scrollIntoView({ block: "center" });
    };
    focus();
    window.addEventListener("hashchange", focus);
    return () => window.removeEventListener("hashchange", focus);
  }, []);
  return null;
}

export function NewBooking({ tripId, statuses, zones, places }: { tripId: string; statuses: Record<string, string>; zones: string[]; places: PlaceOption[] }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-secondary btn-sm self-start">
        + Dodaj rezerwację
      </button>
    );
  }
  return <BookingForm tripId={tripId} statuses={statuses} zones={zones} places={places} onDone={() => setOpen(false)} />;
}

/** Punkty planu „w pakiecie” rezerwacji — zaznaczone wskazują rezerwację i mają płatność „w cenie”. */
function BookingItemsForm({ tripId, bookingRef, items, chosen, onDone }: { tripId: string; bookingRef: string; items: { ref: string; label: string }[]; chosen: string[]; onDone: () => void }) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(chosen));
  const action = useAction();
  return (
    <div className="mt-1 flex flex-col gap-2 rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800">
      <p className="text-xs text-zinc-500">Zaznacz punkty planu, które ta rezerwacja obejmuje — dostaną płatność „w cenie” i nie trafią osobno do budżetu.</p>
      <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
        {items.map((item) => (
          <li key={item.ref}>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={picked.has(item.ref)}
                onChange={(event) => {
                  const next = new Set(picked);
                  if (event.target.checked) next.add(item.ref);
                  else next.delete(item.ref);
                  setPicked(next);
                }}
              />
              {item.label}
            </label>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <button disabled={action.pending} onClick={() => action.run(async () => {
          const result = await setBookingItems(tripId, bookingRef, [...picked]);
          if (result.ok) onDone();
          return result;
        })} className={primary}>
          {action.pending ? "Zapisuję…" : "Zapisz"}
        </button>
        <button type="button" onClick={onDone} className="btn-secondary btn-sm">
          Anuluj
        </button>
      </div>
      <Status state={action.state} />
    </div>
  );
}

// --- Kontakty -------------------------------------------------------------------------------


function ContactForm({ tripId, contact, bookings, onDone, defaultRole = "host" }: { tripId: string; contact?: Contact; bookings: { ref: string; title: string }[]; onDone: () => void; defaultRole?: Contact["role"] }) {
  const [state, action, pending] = useActionState(async (prev: FormState, form: FormData) => {
    const result = await saveContact(tripId, contact?.ref ?? null, prev, form);
    if (result.ok) onDone();
    return result;
  }, {});
  return (
    <form action={action} className="flex flex-col gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex flex-wrap gap-2">
        <input name="name" required defaultValue={contact?.name} placeholder="np. Youssef (riad)" className={`${input} min-w-40 flex-1`} aria-label="Nazwa" />
        <select name="role" defaultValue={contact?.role ?? defaultRole} className={input} aria-label="Rola">
          {Object.entries(CONTACT_ROLE).map(([key, name]) => (
            <option key={key} value={key}>
              {name}
            </option>
          ))}
        </select>
        <input name="phone" type="tel" defaultValue={contact?.phone} placeholder="telefon, np. +212 600 000 000" className={input} aria-label="Telefon" />
        <input name="email" type="email" defaultValue={contact?.email} placeholder="e-mail" className={input} aria-label="E-mail" />
      </div>
      <div className="flex flex-wrap gap-2">
        <select name="bookingRef" defaultValue={contact?.bookingRef ?? ""} className={`${input} max-w-64`} aria-label="Rezerwacja">
          <option value="">— przy całym wyjeździe —</option>
          {bookings.map((booking) => (
            <option key={booking.ref} value={booking.ref}>
              {booking.title}
            </option>
          ))}
        </select>
        <input name="notes" defaultValue={contact?.notes} placeholder="notatka, np. mówi po francusku" className={`${input} min-w-40 flex-1`} aria-label="Notatka" />
      </div>
      <div className="flex gap-2">
        <button disabled={pending} className={primary}>
          {pending ? "Zapisuję…" : contact ? "Zapisz" : "Dodaj kontakt"}
        </button>
        <button type="button" onClick={onDone} className="btn-secondary btn-sm">
          Anuluj
        </button>
      </div>
      <Status state={state} />
    </form>
  );
}

/** `defaultRole` i `addLabel` — np. lista numerów alarmowych z „+ Dodaj numer alarmowy”. */
export function Contacts({
  tripId,
  contacts,
  bookings,
  canEdit,
  defaultRole,
  addLabel = "+ Dodaj kontakt",
  bookingHrefs = {},
}: {
  tripId: string;
  contacts: Contact[];
  bookings: { ref: string; title: string }[];
  canEdit: boolean;
  defaultRole?: Contact["role"];
  addLabel?: string;
  /** Ref rezerwacji → jej wiersz na „Rezerwacje i budżet”; bez wpisu sama nazwa. */
  bookingHrefs?: Record<string, string>;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const remove = useAction();
  const titles = new Map(bookings.map((booking) => [booking.ref, booking.title]));
  return (
    <div className="flex flex-col gap-2 text-sm">
      {contacts.length === 0 && <p className="text-zinc-500">Brak kontaktów.</p>}
      <ul className="flex flex-col gap-2">
        {contacts.map((contact) =>
          editing === contact.ref ? (
            <li key={contact.ref}>
              <ContactForm tripId={tripId} contact={contact} bookings={bookings} onDone={() => setEditing(null)} />
            </li>
          ) : (
            <li key={contact.ref} id={contactAnchor(contact.ref)} className="flex flex-wrap items-baseline gap-x-2 rounded data-focus:bg-signal/10">
              <span className="font-medium">{contact.name}</span>
              <span className="text-xs text-zinc-500">{CONTACT_ROLE[contact.role]}</span>
              {contact.phone && (
                <a href={`tel:${contact.phone.replace(/\s/g, "")}`} className="underline">
                  {contact.phone}
                </a>
              )}
              {contact.email && (
                <a href={`mailto:${contact.email}`} className="underline">
                  {contact.email}
                </a>
              )}
              {contact.bookingRef && (
                <span className="text-xs text-zinc-500">
                  ·{" "}
                  {bookingHrefs[contact.bookingRef] ? (
                    <Link href={bookingHrefs[contact.bookingRef]!} title="Szczegóły rezerwacji na „Rezerwacje i budżet”" className="btn-mini">
                      {titles.get(contact.bookingRef) ?? "rezerwacja"}
                    </Link>
                  ) : (
                    (titles.get(contact.bookingRef) ?? "rezerwacja")
                  )}
                </span>
              )}
              {contact.notes && <span className="text-xs text-zinc-500">· {contact.notes}</span>}
              {canEdit && (
                <span className="text-zinc-500">
                  <button onClick={() => setEditing(contact.ref)} className={small}>
                    edytuj
                  </button>{" "}
                  <button disabled={remove.pending} onClick={() => remove.run(() => removeContact(tripId, contact.ref), `Usunąć kontakt „${contact.name}”?`)} className={danger}>
                    usuń
                  </button>
                </span>
              )}
            </li>
          ),
        )}
      </ul>
      <Status state={remove.state} />
      {canEdit &&
        (editing === "new" ? (
          <ContactForm tripId={tripId} bookings={bookings} onDone={() => setEditing(null)} defaultRole={defaultRole} />
        ) : (
          <button onClick={() => setEditing("new")} className="btn-secondary btn-sm self-start">
            {addLabel}
          </button>
        ))}
    </div>
  );
}

// --- Budżet z planu i kursy -----------------------------------------------------------------

/** Rezerwacje i punkty z ceną bez pozycji w budżecie — „Dodaj” robi z propozycji pozycję. */
export function BudgetSuggestions({ tripId, suggestions }: { tripId: string; suggestions: BudgetSuggestion[] }) {
  const action = useAction();
  if (suggestions.length === 0) return null;
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-zinc-500">Ceny z planu bez pozycji w budżecie ({suggestions.length})</summary>
      <p className="mt-1 text-xs text-zinc-500">Sprawdź, czy kwota nie jest już w pozycji zbiorczej (np. „Wstępy”), zanim dodasz.</p>
      <ul className="mt-2 flex flex-col gap-1">
        {suggestions.map((each) => (
          <li key={`${each.source}:${each.ref}`} className="flex flex-wrap items-baseline gap-x-2">
            <span>{each.title}</span>
            <span className="text-xs text-zinc-500">
              {each.source === "booking" ? "rezerwacja" : "punkt planu"} · {BUDGET_CATEGORY[each.line.category]} · {BUDGET_LINE_STATUS[each.line.status]}
              {each.note ? ` · ${each.note}` : ""}
            </span>
            <span className="font-mono text-xs">
              {formatMoneyRange(each.line.lowMinor, each.line.highMinor, each.line.currency)}
            </span>
            <button disabled={action.pending} onClick={() => action.run(() => addSuggestedBudgetLine(tripId, each.source, each.ref))} className={small}>
              dodaj
            </button>
          </li>
        ))}
      </ul>
      <Status state={action.state} />
    </details>
  );
}

/** Kursy walut wyjazdu: ile waluty bazowej za jednostkę i z kiedy — z nich sumy budżetu i portfela. */
/** Waluta wyjazdu: w niej są sumy i rozliczenie. Podpowiedzi to waluty z kursów i te najczęstsze. */
export function TripCurrency({ tripId, base, known, canEdit }: { tripId: string; base: string; known: string[]; canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(async (prev: FormState, form: FormData) => {
    const result = await setTripCurrency(tripId, prev, form);
    if (result.ok) setOpen(false);
    return result;
  }, {});
  if (!open)
    return (
      <p className="text-xs text-zinc-500">
        Waluta wyjazdu (sumy i rozliczenie): <span className="font-medium">{base}</span>
        {canEdit && (
          <>
            {" "}
            <button onClick={() => setOpen(true)} className={small}>
              zmień
            </button>
          </>
        )}
        {state.ok && <span className="text-green-700 dark:text-green-400"> {state.ok}</span>}
      </p>
    );
  return (
    <form action={action} className="flex flex-col gap-2 rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800">
      <p className="text-xs text-zinc-500">Przeliczą się sumy, plan dzień po dniu, rozliczenie i kursy. Kwoty pozycji i wydatków zostają w swoich walutach.</p>
      <div className="flex flex-wrap items-center gap-2">
        <input name="currency" required defaultValue={base} list="trip-currencies" maxLength={3} className={`${input} w-20 uppercase`} aria-label="Waluta wyjazdu" />
        <datalist id="trip-currencies">
          {[...new Set([...known, "PLN", "EUR", "USD", "GBP", "CZK"])]
            .filter((currency) => currency !== base)
            .map((currency) => (
              <option key={currency} value={currency} />
            ))}
        </datalist>
        <button disabled={pending} className={primary}>
          {pending ? "Zapisuję…" : "Zmień walutę"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="btn-secondary btn-sm">
          Anuluj
        </button>
      </div>
      <Status state={state} />
    </form>
  );
}

export function FxEditor({ tripId, fx, base, missing, canEdit }: { tripId: string; fx: Doc["trip"]["fx"]; base: string; missing: string[]; canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  // Stały klucz wiersza — pola są niekontrolowane, usunięcie środkowego nie może przesunąć wartości.
  const [rows, setRows] = useState(() => [...fx.map((each) => ({ ...each })), ...missing.map((currency) => ({ currency, rateToBase: 0, date: undefined as string | undefined }))].map((row, key) => ({ ...row, key })));
  const [state, action, pending] = useActionState(async (prev: FormState, form: FormData) => {
    const result = await saveFx(tripId, prev, form);
    if (result.ok) setOpen(false);
    return result;
  }, {});
  const [fetched, setFetched] = useState<FormState>({});
  const [fetching, startFetch] = useTransition();
  const summary = fx.length === 0 ? "brak kursów" : fx.map((each) => fxLine(each, base)).join(" · ");
  if (!open) {
    return (
      <p className="text-xs text-zinc-500">
        Kursy: {summary}
        {missing.length > 0 && <span className="text-amber-700"> · bez kursu: {missing.join(", ")}</span>}
        {canEdit && (
          <>
            {" "}
            <button onClick={() => setOpen(true)} className={small}>
              zmień
            </button>{" "}
            <button disabled={fetching} onClick={() => startFetch(async () => setFetched(await fetchFx(tripId)))} className={small}>
              {fetching ? "pobieram…" : "pobierz aktualne kursy"}
            </button>
          </>
        )}
        {fetched.ok && <span className="text-green-700 dark:text-green-400"> {fetched.ok}</span>}
        {fetched.error && <span className="text-red-600"> {fetched.error}</span>}
      </p>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-2 rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800">
      <p className="text-xs text-zinc-500">Ile {base} za 1 jednostkę waluty — np. MAD 0,43. Data: z kiedy kurs (np. z dnia zakupu).</p>
      {rows.map((row) => (
        <div key={row.key} className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-zinc-500">1</span>
          <input name="fxCurrency" defaultValue={row.currency} maxLength={3} placeholder="EUR" className={`${input} w-16 uppercase`} aria-label="Waluta" />
          <span className="text-xs text-zinc-500">=</span>
          <input name="fxRate" defaultValue={row.rateToBase > 0 ? String(row.rateToBase).replace(".", ",") : ""} inputMode="decimal" placeholder="4,27" className={`${input} w-24`} aria-label="Kurs" />
          <span className="text-xs text-zinc-500">{base}</span>
          <input name="fxDate" type="date" defaultValue={row.date ?? ""} className={input} aria-label="Data kursu" />
          <button type="button" onClick={() => setRows(rows.filter((each) => each.key !== row.key))} className={danger}>
            usuń
          </button>
        </div>
      ))}
      <button type="button" onClick={() => setRows([...rows, { currency: "", rateToBase: 0, date: undefined, key: Math.max(-1, ...rows.map((each) => each.key)) + 1 }])} className={`${small} self-start`}>
        + waluta
      </button>
      <div className="flex gap-2">
        <button disabled={pending} className={primary}>
          {pending ? "Zapisuję…" : "Zapisz kursy"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="btn-secondary btn-sm">
          Anuluj
        </button>
      </div>
      <Status state={state} />
    </form>
  );
}

// --- Zakupy ---------------------------------------------------------------------------------

type Shopping = Doc["packing"][number] & { bought: boolean };

function ShoppingForm({ tripId, item, onDone }: { tripId: string; item?: Shopping; onDone?: () => void }) {
  const [state, action, pending] = useActionState(async (prev: FormState, form: FormData) => {
    const result = await saveShoppingItem(tripId, item?.ref ?? null, prev, form);
    if (result.ok && onDone) onDone();
    return result;
  }, {});
  return (
    <form action={action} className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <input name="title" required defaultValue={item?.title} placeholder="np. makaron, mleko UHT" className={`${input} min-w-40 flex-1`} aria-label="Co kupić" />
        <input name="quantity" inputMode="decimal" defaultValue={item?.quantity} placeholder="ile" className={`${input} w-16`} aria-label="Ilość" />
        <input name="unit" defaultValue={item?.unit} placeholder="kg, szt." className={`${input} w-20`} aria-label="Jednostka" />
        <input name="note" defaultValue={item?.note} placeholder="na kolację dnia 1" className={`${input} min-w-32 flex-1`} aria-label="Uwagi" />
      </div>
      <div className="flex items-center gap-3">
        <button disabled={pending} className={primary}>
          {pending ? "Zapisuję…" : item ? "Zapisz" : "Dodaj"}
        </button>
        {onDone && (
          <button type="button" onClick={onDone} className={small}>
            anuluj
          </button>
        )}
        <Status state={state} />
      </div>
    </form>
  );
}

/** „Gotujemy sami” przy posiłku — zapis od razu. */
export function SelfCookedToggle({ tripId, itemRef, value }: { tripId: string; itemRef: string; value: boolean }) {
  const toggle = useAction();
  return (
    <label className="inline-flex items-center gap-1 text-xs">
      <input type="checkbox" checked={value} disabled={toggle.pending} onChange={(event) => toggle.run(() => setSelfCooked(tripId, itemRef, event.target.checked))} />
      gotujemy sami
      {toggle.state.error && <span className="text-red-600"> {toggle.state.error}</span>}
    </label>
  );
}

export function ShoppingList({ tripId, items, canEdit }: { tripId: string; items: Shopping[]; canEdit: boolean }) {
  const [editing, setEditing] = useState<string | null>(null);
  const remove = useAction();
  return (
    <div className="flex flex-col gap-2">
      {items.length === 0 && <p className="text-zinc-500">Lista jest pusta.{canEdit ? " Dodaj, co kupić na wyjazd — na telefonie odhaczycie to w sklepie." : ""}</p>}
      <ul className="flex flex-col gap-1">
        {items.map((item) =>
          editing === item.ref ? (
            <li key={item.ref}>
              <ShoppingForm tripId={tripId} item={item} onDone={() => setEditing(null)} />
            </li>
          ) : (
            <li key={item.ref} className="flex flex-wrap items-baseline gap-x-2">
              <span aria-label={item.bought ? "kupione" : "do kupienia"}>{item.bought ? "☑" : "☐"}</span>
              <span className={item.bought ? "text-zinc-500 line-through" : "font-medium"}>{item.title}</span>
              {item.quantity && (
                <span>
                  × {item.quantity.toLocaleString("pl-PL")}
                  {item.unit ? ` ${item.unit}` : ""}
                </span>
              )}
              {item.note && <span className="text-xs text-zinc-500">· {item.note}</span>}
              {canEdit && (
                <span className="text-zinc-500">
                  <button onClick={() => setEditing(item.ref)} className={small}>
                    edytuj
                  </button>{" "}
                  <button disabled={remove.pending} onClick={() => remove.run(() => removeShoppingItem(tripId, item.ref), `Usunąć „${item.title}” z listy?`)} className={danger}>
                    usuń
                  </button>
                </span>
              )}
            </li>
          ),
        )}
      </ul>
      <Status state={remove.state} />
      {canEdit &&
        (editing === "new" ? (
          <ShoppingForm tripId={tripId} onDone={() => setEditing(null)} />
        ) : (
          <button onClick={() => setEditing("new")} className="btn-secondary btn-sm self-start">
            + Dodaj do zakupów
          </button>
        ))}
    </div>
  );
}
