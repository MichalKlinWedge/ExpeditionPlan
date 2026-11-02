"use client";

import { BUDGET_CATEGORY, formatMoney, type TripDocument } from "@expeditionplan/core";
import { useActionState, useState, useTransition } from "react";

import type { FormState } from "@/app/actions";
import { removeBudgetLine, removeTask, saveBooking, saveBudgetLine, saveTask, setTaskStatus } from "@/app/logistics-actions";

/**
 * Edycja na stronie „Rezerwacje, budżet i zadania”: każda zmiana to akcja serwera, która sprawdza
 * cały dokument i odświeża stronę (sumy budżetu liczą się na nowo po stronie serwera).
 */

type Doc = TripDocument;
type Line = Doc["budgetLines"][number];
type Task = Doc["tasks"][number];
type Booking = Doc["bookings"][number];

const input = "field px-2 py-1 text-sm";
const small = "text-xs underline disabled:opacity-50";
const primary = "btn-primary btn-sm";
const minorText = (minor: number) => (minor / 100).toLocaleString("pl-PL", { useGrouping: false, maximumFractionDigits: 2 });

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

const LINE_STATUS: Record<string, string> = { estimate: "szacunek", committed: "zobowiązanie", paid: "zapłacone" };

function BudgetForm({ tripId, line, currency, onDone }: { tripId: string; line?: Line; currency: string; onDone?: () => void }) {
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
          {Object.entries(LINE_STATUS).map(([key, name]) => (
            <option key={key} value={key}>
              {name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input name="low" required defaultValue={line ? minorText(line.lowMinor) : ""} placeholder="kwota" inputMode="decimal" className={`${input} w-28`} aria-label="Kwota od" />
        <span className="text-xs text-zinc-500">do</span>
        <input name="high" defaultValue={line && line.highMinor !== line.lowMinor ? minorText(line.highMinor) : ""} placeholder="(opcjonalnie)" inputMode="decimal" className={`${input} w-28`} aria-label="Kwota do" />
        <input name="currency" required defaultValue={line?.currency ?? currency} maxLength={3} className={`${input} w-16 uppercase`} aria-label="Waluta" />
        <label className="flex items-center gap-1 text-xs">
          <input name="perPerson" type="checkbox" defaultChecked={line?.perPerson ?? false} /> na osobę
        </label>
        <input name="note" defaultValue={line?.note} placeholder="notatka" className={`${input} min-w-32 flex-1`} aria-label="Notatka" />
      </div>
      <div className="flex gap-2">
        <button disabled={pending} className={primary}>
          {pending ? "Zapisuję…" : line ? "Zapisz" : "Dodaj pozycję"}
        </button>
        {onDone && (
          <button type="button" onClick={onDone} className="text-sm underline">
            Anuluj
          </button>
        )}
      </div>
      <Status state={state} />
    </form>
  );
}

export function BudgetLines({ tripId, lines, currency, canEdit }: { tripId: string; lines: Line[]; currency: string; canEdit: boolean }) {
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
              <th className="py-1 font-normal">Kategoria</th>
              <th className="py-1 font-normal">Status</th>
              <th className="py-1 text-right font-normal">Kwota</th>
              {canEdit && <th className="py-1" />}
            </tr>
          </thead>
          <tbody>
            {lines.map((line) =>
              editing === line.ref ? (
                <tr key={line.ref} className="border-t border-zinc-100 dark:border-zinc-900">
                  <td colSpan={5} className="py-2">
                    <BudgetForm tripId={tripId} line={line} currency={currency} onDone={() => setEditing(null)} />
                  </td>
                </tr>
              ) : (
                <tr key={line.ref} className="border-t border-zinc-100 dark:border-zinc-900">
                  <td className="py-1">
                    {line.title}
                    {line.perPerson ? <span className="text-zinc-500"> · na osobę</span> : null}
                    {line.note ? <span className="block text-xs text-zinc-500">{line.note}</span> : null}
                  </td>
                  <td className="py-1 pr-3 text-zinc-500">{BUDGET_CATEGORY[line.category] ?? line.category}</td>
                  <td className="py-1 pr-3 text-zinc-500">{LINE_STATUS[line.status]}</td>
                  <td className="py-1 text-right font-mono whitespace-nowrap">
                    {line.lowMinor === line.highMinor ? formatMoney(line.lowMinor, line.currency) : `${formatMoney(line.lowMinor, line.currency)} – ${formatMoney(line.highMinor, line.currency)}`}
                  </td>
                  {canEdit && (
                    <td className="py-1 pl-2 text-right whitespace-nowrap text-zinc-500">
                      <button onClick={() => setEditing(line.ref)} className={small}>
                        edytuj
                      </button>{" "}
                      <button disabled={remove.pending} onClick={() => remove.run(() => removeBudgetLine(tripId, line.ref), `Usunąć pozycję „${line.title}”?`)} className={small}>
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
          <BudgetForm tripId={tripId} currency={currency} onDone={() => setAdding(false)} />
        ) : (
          <button onClick={() => setAdding(true)} className="self-start text-sm underline">
            + Dodaj pozycję budżetu
          </button>
        ))}
    </div>
  );
}

// --- Zadania --------------------------------------------------------------------------------

const TASK_KIND: Record<string, string> = { todo: "do zrobienia", question: "pytanie", decision: "decyzja" };

function TaskForm({ tripId, task, onDone }: { tripId: string; task?: Task; onDone?: () => void }) {
  const [state, action, pending] = useActionState(async (prev: FormState, form: FormData) => {
    const result = await saveTask(tripId, task?.ref ?? null, prev, form);
    if (result.ok && onDone) onDone();
    return result;
  }, {});
  const dueDate = task?.due?.kind === "absolute" ? task.due.date : "";
  return (
    <form action={action} className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <input name="title" required defaultValue={task?.title} placeholder="np. Kupić eSIM" className={`${input} min-w-48 flex-1`} aria-label="Zadanie" />
        <select name="kind" defaultValue={task?.kind ?? "todo"} className={input} aria-label="Rodzaj">
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
        <input name="dueDate" type="date" defaultValue={dueDate} className={input} aria-label="Termin" />
      </div>
      {task?.due !== undefined && task.due.kind !== "absolute" && <p className="text-xs text-zinc-500">Termin względny (np. „przed wyjazdem”) zostaje, chyba że wpiszesz datę.</p>}
      <textarea name="body" defaultValue={task?.body} placeholder="opis (opcjonalnie)" rows={2} className={input} aria-label="Opis" />
      {(task?.kind === "question" || task?.kind === "decision") && <textarea name="answer" defaultValue={task.answer} placeholder="odpowiedź / decyzja" rows={2} className={input} aria-label="Odpowiedź" />}
      <div className="flex gap-2">
        <button disabled={pending} className={primary}>
          {pending ? "Zapisuję…" : task ? "Zapisz" : "Dodaj zadanie"}
        </button>
        {onDone && (
          <button type="button" onClick={onDone} className="text-sm underline">
            Anuluj
          </button>
        )}
      </div>
      <Status state={state} />
    </form>
  );
}

export function TaskList({ tripId, tasks, describe, canEdit }: { tripId: string; tasks: Task[]; describe: Record<string, string>; canEdit: boolean }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const action = useAction();
  const open = tasks.filter((task) => task.status === "open");
  const closed = tasks.filter((task) => task.status !== "open");
  const row = (task: Task) =>
    editing === task.ref ? (
      <li key={task.ref} className="card p-3">
        <TaskForm tripId={tripId} task={task} onDone={() => setEditing(null)} />
      </li>
    ) : (
      <li key={task.ref} className="flex items-start gap-2">
        {canEdit && (
          <input
            type="checkbox"
            checked={task.status === "done"}
            disabled={action.pending}
            onChange={() => action.run(() => setTaskStatus(tripId, task.ref, task.status === "open" ? "done" : "open"))}
            className="mt-1"
            aria-label={task.status === "open" ? "Zrobione" : "Otwórz ponownie"}
          />
        )}
        <span className={`flex flex-1 flex-col ${task.status !== "open" ? "text-zinc-400 line-through" : ""}`}>
          <span>
            {task.priority === "high" ? <span className="text-red-600">! </span> : null}
            {task.title}
            <span className="text-xs text-zinc-500"> · {TASK_KIND[task.kind]}{describe[task.ref] ? ` · ${describe[task.ref]}` : ""}</span>
          </span>
          {task.body && <span className="text-xs whitespace-pre-line text-zinc-500">{task.body}</span>}
          {task.answer && <span className="text-xs whitespace-pre-line text-green-700 dark:text-green-400">→ {task.answer}</span>}
        </span>
        {canEdit && (
          <span className="text-zinc-500 whitespace-nowrap">
            <button onClick={() => setEditing(task.ref)} className={small}>
              edytuj
            </button>{" "}
            <button disabled={action.pending} onClick={() => action.run(() => removeTask(tripId, task.ref), `Usunąć zadanie „${task.title}”?`)} className={small}>
              usuń
            </button>
          </span>
        )}
      </li>
    );
  return (
    <div className="flex flex-col gap-3 text-sm">
      <ul className="flex flex-col gap-2">{open.map(row)}</ul>
      <Status state={action.state} />
      {canEdit &&
        (adding ? (
          <TaskForm tripId={tripId} onDone={() => setAdding(false)} />
        ) : (
          <button onClick={() => setAdding(true)} className="self-start underline">
            + Dodaj zadanie
          </button>
        ))}
      {closed.length > 0 && (
        <button onClick={() => setShowClosed(!showClosed)} className="self-start text-xs text-zinc-500 underline">
          {showClosed ? "Ukryj zamknięte" : `Pokaż zamknięte (${closed.length})`}
        </button>
      )}
      {showClosed && <ul className="flex flex-col gap-2">{closed.map(row)}</ul>}
    </div>
  );
}

// --- Rezerwacje -----------------------------------------------------------------------------

export function BookingEditor({ tripId, booking, statuses }: { tripId: string; booking: Booking; statuses: Record<string, string> }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(async (prev: FormState, form: FormData) => {
    const result = await saveBooking(tripId, booking.ref, prev, form);
    if (result.ok) setOpen(false);
    return result;
  }, {});
  if (!open) {
    return (
      <span className="text-zinc-500">
        <button onClick={() => setOpen(true)} className={small}>
          edytuj
        </button>
        {state.ok && <span className="ml-2 text-xs text-green-700 dark:text-green-400">{state.ok}</span>}
      </span>
    );
  }
  const refundable = booking.refundable === true ? "yes" : booking.refundable === false ? "no" : "";
  return (
    <form action={action} className="mt-1 flex flex-col gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex flex-wrap gap-2">
        <select name="status" defaultValue={booking.status} className={input} aria-label="Status">
          {Object.entries(statuses).map(([key, name]) => (
            <option key={key} value={key}>
              {name}
            </option>
          ))}
        </select>
        <input name="provider" defaultValue={booking.provider} placeholder={booking.kind === "flight" ? "linia lotnicza" : "firma / obiekt"} className={input} aria-label={booking.kind === "flight" ? "Linia lotnicza" : "Firma"} />
        {booking.kind === "flight" && (
          <>
            <input name="flightNumber" defaultValue={booking.flight?.number} placeholder="nr lotu, np. FR 2145" className={`${input} w-40 uppercase`} aria-label="Numer lotu" />
            <input name="baggage" defaultValue={booking.flight?.baggage} placeholder="bagaż, np. 1 × 20 kg" className={input} aria-label="Bagaż" />
          </>
        )}
        <input name="confirmationCode" defaultValue={booking.confirmationCode} placeholder="kod rezerwacji" className={input} aria-label="Kod rezerwacji" />
        <select name="refundable" defaultValue={refundable} className={input} aria-label="Zwrotna">
          <option value="">zwrotna?</option>
          <option value="yes">zwrotna</option>
          <option value="no">bezzwrotna</option>
        </select>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-zinc-500">zapłacono</span>
        <input name="paidAmount" defaultValue={booking.paid ? minorText(booking.paid.amountMinor) : ""} placeholder="kwota" inputMode="decimal" className={`${input} w-28`} aria-label="Zapłacona kwota" />
        <input name="paidCurrency" defaultValue={booking.paid?.currency ?? booking.price?.currency ?? "PLN"} maxLength={3} className={`${input} w-16 uppercase`} aria-label="Waluta zapłaty" />
        <input name="paidOn" type="date" defaultValue={booking.paid?.date ?? ""} className={input} aria-label="Data zapłaty" />
        <span className="text-xs text-zinc-500">darmowe odwołanie do</span>
        <input name="freeCancellationUntil" type="date" defaultValue={booking.freeCancellationUntil ?? ""} className={input} aria-label="Darmowe odwołanie do" />
      </div>
      <div className="flex gap-2">
        <button disabled={pending} className={primary}>
          {pending ? "Zapisuję…" : "Zapisz"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm underline">
          Anuluj
        </button>
      </div>
      <Status state={state} />
    </form>
  );
}
