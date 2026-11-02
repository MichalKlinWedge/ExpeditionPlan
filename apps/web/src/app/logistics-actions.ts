"use server";

import { BudgetCategory, parseMoney, TripDocument } from "@expeditionplan/core";
import { refIndex, saveElements, stateFromPayload, uuidv7 } from "@expeditionplan/sync";
import { refresh } from "next/cache";

import type { FormState } from "@/app/actions";
import { requireUser } from "@/lib/auth";

/**
 * Edycja budżetu, rezerwacji i zadań (strona „Rezerwacje, budżet i zadania”). Każda zmiana:
 * dokument z bazy → zmiana jednego elementu → walidacja CAŁEGO dokumentu (odwołania, kwoty)
 * → zapis jednego wiersza. Nowy element dostaje klucz `id-<uuid>`, jak punkty z edytora planu.
 * O prawie do zapisu decyduje RLS (organizator, edytor).
 */

type Doc = TripDocument;
type Editable = "budgetLines" | "tasks" | "bookings";
type Element = { ref: string } & Record<string, unknown>;

const message = (error: { message: string; code?: string }) => (error.code === "42501" ? "Brak uprawnień do tej zmiany." : error.message);

async function change(tripId: string, collection: Editable, ref: string | null, build: (doc: Doc, current: Element | undefined) => Element | null | string): Promise<FormState> {
  const { supabase } = await requireUser(`/trips/${tripId}/logistics`);
  const { data, error } = await supabase.rpc("pull_changes", { p_trip: tripId, p_since: 0 });
  if (error) return { error: message(error) };
  if (data === null) return { error: "Nie ma takiego wyjazdu." };
  const payload = data as Parameters<typeof stateFromPayload>[0];
  const { doc } = stateFromPayload(payload);
  const list = doc[collection] as Element[];
  const current = ref === null ? undefined : list.find((each) => each.ref === ref);
  if (ref !== null && current === undefined) return { error: "Tego elementu już nie ma — odśwież stronę." };

  const next = build(doc, current);
  if (typeof next === "string") return { error: next };
  const remove = next === null;
  const element: Element = next ?? current!;
  const updated = { ...doc, [collection]: remove ? list.filter((each) => each.ref !== ref) : current ? list.map((each) => (each.ref === ref ? element : each)) : [...list, element] };
  const checked = TripDocument.safeParse(updated);
  if (!checked.success) {
    const issue = checked.error.issues[0]!;
    return { error: `Nie zapisano: ${issue.message}${issue.path.length > 0 ? ` (${issue.path.join(".")})` : ""}` };
  }

  try {
    await saveElements(supabase, tripId, checked.data, [{ collection, element, op: remove ? "remove" : current === undefined ? "insert" : "update" }], refIndex(payload.tables));
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  refresh();
  return { ok: remove ? "Usunięto." : "Zapisano." };
}

const text = (form: FormData, name: string) => String(form.get(name) ?? "").trim();
const optional = (value: string) => (value === "" ? undefined : value);

// --- Budżet ---------------------------------------------------------------------------------

/** Pozycja budżetu: tytuł, kategoria, status, kwota „od–do” (albo jedna), waluta, na osobę. */
export async function saveBudgetLine(tripId: string, ref: string | null, _prev: FormState, form: FormData): Promise<FormState> {
  const title = text(form, "title");
  if (title === "") return { error: "Podaj nazwę pozycji." };
  const category = BudgetCategory.safeParse(text(form, "category"));
  if (!category.success) return { error: "Wybierz kategorię." };
  const low = parseMoney(text(form, "low"));
  const highText = text(form, "high");
  const high = highText === "" ? low : parseMoney(highText);
  if (low === null || high === null) return { error: "Kwota: liczba, np. 1200 albo 1200,50." };
  if (low > high) return { error: "Kwota „od” większa niż „do”." };
  const currency = text(form, "currency").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return { error: "Waluta: trzy litery, np. PLN, EUR, MAD." };
  const status = ["estimate", "committed", "paid"].includes(text(form, "status")) ? text(form, "status") : "estimate";
  return change(tripId, "budgetLines", ref, (_doc, current) => ({
    ...(current ?? { ref: `id-${uuidv7()}` }),
    title,
    category: category.data,
    status,
    lowMinor: low,
    highMinor: high,
    currency,
    perPerson: form.get("perPerson") === "on",
    note: optional(text(form, "note")),
  }));
}

/** Usunięcie pozycji budżetu (miękkie). Nic na pozycje budżetu nie wskazuje. */
export async function removeBudgetLine(tripId: string, ref: string): Promise<FormState> {
  return change(tripId, "budgetLines", ref, () => null);
}

// --- Zadania --------------------------------------------------------------------------------

/** Zadanie: tytuł, rodzaj, priorytet, opis, odpowiedź; termin „do dnia” (inne rodzaje terminu zostają bez zmian). */
export async function saveTask(tripId: string, ref: string | null, _prev: FormState, form: FormData): Promise<FormState> {
  const title = text(form, "title");
  if (title === "") return { error: "Podaj treść zadania." };
  const kind = ["todo", "question", "decision"].includes(text(form, "kind")) ? text(form, "kind") : "todo";
  const priority = ["high", "normal", "low"].includes(text(form, "priority")) ? text(form, "priority") : undefined;
  const date = text(form, "dueDate");
  if (date !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Termin: data RRRR-MM-DD." };
  return change(tripId, "tasks", ref, (_doc, current) => {
    const keepDue = current?.due !== undefined && (current.due as { kind: string }).kind !== "absolute";
    return {
      ...(current ?? { ref: `id-${uuidv7()}`, status: "open", assigneeRefs: [] }),
      title,
      kind,
      priority,
      body: optional(text(form, "body")),
      answer: optional(text(form, "answer")),
      due: date !== "" ? { kind: "absolute", date } : keepDue ? current!.due : undefined,
    };
  });
}

export async function setTaskStatus(tripId: string, ref: string, status: "open" | "done" | "dropped"): Promise<FormState> {
  return change(tripId, "tasks", ref, (_doc, current) => ({ ...current!, status }));
}

export async function removeTask(tripId: string, ref: string): Promise<FormState> {
  return change(tripId, "tasks", ref, () => null);
}

// --- Rezerwacje -----------------------------------------------------------------------------

const BOOKING_STATUSES = ["idea", "candidate", "to_book", "booked", "paid", "cancelled", "unknown", "not_required"];

/**
 * Rezerwacja po zakupie: status, kod, zapłacona kwota i data, darmowe odwołanie, zwrotność.
 * Usuwania nie ma — na rezerwację wskazują punkty, noclegi dni i budżet; zamiast tego „anulowane”.
 */
export async function saveBooking(tripId: string, ref: string, _prev: FormState, form: FormData): Promise<FormState> {
  const status = text(form, "status");
  if (!BOOKING_STATUSES.includes(status)) return { error: "Wybierz status." };
  const paidText = text(form, "paidAmount");
  const paid = paidText === "" ? null : parseMoney(paidText);
  if (paidText !== "" && paid === null) return { error: "Zapłacono: liczba, np. 1200 albo 1200,50." };
  const currency = text(form, "paidCurrency").toUpperCase();
  if (paid !== null && !/^[A-Z]{3}$/.test(currency)) return { error: "Waluta: trzy litery, np. PLN, EUR." };
  const paidOn = text(form, "paidOn");
  const freeCancel = text(form, "freeCancellationUntil");
  for (const date of [paidOn, freeCancel]) if (date !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Data: RRRR-MM-DD." };
  const refundable = text(form, "refundable");
  return change(tripId, "bookings", ref, (_doc, current) => ({
    ...current!,
    status,
    confirmationCode: optional(text(form, "confirmationCode")),
    paid: paid === null ? undefined : { amountMinor: paid, currency, ...(paidOn ? { date: paidOn } : {}) },
    freeCancellationUntil: optional(freeCancel),
    refundable: refundable === "yes" ? true : refundable === "no" ? false : undefined,
  }));
}
