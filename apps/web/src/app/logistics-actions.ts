"use server";

import { BookingKind, bookingPlace, BookingStatus, BudgetCategory, budgetSuggestions, fetchRates, type FxRate, mergeRates, parseMoney, parseWeightKg, PriceBasis, rebaseRates, removeBooking, SHOPPING_CATEGORY, tripCurrencies, TripDocument } from "@expeditionplan/core";
import { carrierRow, dbErrorMessage, type ElementWrite, expenseSplitRows, refIndex, saveElements, stateFromPayload, uuidv7 } from "@expeditionplan/sync";
import { refresh } from "next/cache";

import type { FormState } from "@/app/actions";
import { requireUser } from "@/lib/auth";
import { pullTrip, validationError } from "@/lib/trip-snapshot";

/**
 * Edycja budżetu, rezerwacji, zadań i listy zakupów (strona „Rezerwacje, budżet i zadania”). Każda zmiana:
 * dokument z bazy → zmiana jednego elementu → walidacja CAŁEGO dokumentu (odwołania, kwoty)
 * → zapis jednego wiersza. Nowy element dostaje klucz `id-<uuid>`, jak punkty z edytora planu.
 * O prawie do zapisu decyduje RLS (organizator, edytor).
 */

type Doc = TripDocument;
type Editable = "budgetLines" | "tasks" | "bookings" | "contacts" | "packing" | "items";
type Element = { ref: string } & Record<string, unknown>;

async function change(tripId: string, collection: Editable, ref: string | null, build: (doc: Doc, current: Element | undefined) => Element | null | string): Promise<FormState> {
  const { supabase } = await requireUser(`/trips/${tripId}/logistics`);
  const pulled = await pullTrip(supabase, tripId);
  if (pulled.error !== undefined) return { error: pulled.error };
  const { payload } = pulled;
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
    return { error: validationError(checked.error) };
  }

  try {
    await saveElements(supabase, tripId, checked.data, [{ collection, element, op: remove ? "remove" : current === undefined ? "insert" : "update" }], refIndex(payload.tables));
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  refresh();
  return { ok: remove ? "Usunięto." : "Zapisano." };
}

/**
 * Kilka elementów naraz (rezerwacja → punkty „w pakiecie”): ta sama droga co `change` —
 * świeży dokument z bazy, walidacja całości, zapis wierszy w podanej kolejności.
 */
async function commit(tripId: string, build: (doc: Doc) => { doc: Doc; writes: ElementWrite[]; ok: string } | string): Promise<FormState> {
  const { supabase } = await requireUser(`/trips/${tripId}/logistics`);
  const pulled = await pullTrip(supabase, tripId);
  if (pulled.error !== undefined) return { error: pulled.error };
  const { payload } = pulled;
  const result = build(stateFromPayload(payload).doc);
  if (typeof result === "string") return { error: result };
  const checked = TripDocument.safeParse(result.doc);
  if (!checked.success) {
    return { error: validationError(checked.error) };
  }
  if (result.writes.length > 0) {
    try {
      await saveElements(supabase, tripId, checked.data, result.writes, refIndex(payload.tables));
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }
  refresh();
  return { ok: result.ok };
}

const text = (form: FormData, name: string) => String(form.get(name) ?? "").trim();
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;
/** Liczba całkowita ≥ 0 z pola; puste = brak, śmieci = `NaN` (do komunikatu). */
function count(form: FormData, name: string): number | undefined {
  const value = text(form, name);
  if (value === "") return undefined;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : Number.NaN;
}

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
  const depositText = text(form, "deposit");
  const deposit = depositText === "" ? undefined : parseMoney(depositText);
  if (deposit === null) return { error: "Zadatek: liczba, np. 500 albo 500,50." };
  const currency = text(form, "currency").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return { error: "Waluta: trzy litery, np. PLN, EUR, MAD." };
  const status = ["estimate", "committed", "paid"].includes(text(form, "status")) ? text(form, "status") : "estimate";
  const perPerson = form.get("perPerson") === "on";
  if (deposit !== undefined && !perPerson && deposit > high) return { error: "Zadatek większy niż kwota pozycji." };
  const chosen = form.getAll("for").map(String);
  const vehicle = text(form, "vehicle");
  return change(tripId, "budgetLines", ref, (doc, current) => {
    if (vehicle !== "" && !doc.vehicles.some((each) => each.ref === vehicle)) return "Tego auta już nie ma: odśwież stronę.";
    return {
      ...(current ?? { ref: `id-${uuidv7()}` }),
      title,
      category: category.data,
      status,
      lowMinor: low,
      highMinor: high,
      currency,
      perPerson,
      // Pozycja zapłacona w całości nie potrzebuje zadatku.
      depositMinor: status === "paid" || deposit === 0 ? undefined : deposit,
      // Wszyscy zaznaczeni to to samo co brak wyboru: osoba dodana później też się liczy. Koszt auta dzielą osoby auta.
      participantRefs: vehicle !== "" || chosen.length === 0 || doc.travelers.every((traveler) => chosen.includes(traveler.ref)) ? undefined : chosen,
      vehicleRef: vehicle === "" ? undefined : vehicle,
      note: optional(text(form, "note")),
    };
  });
}

/** Na kogo dzieli się wydatek; pusto = na wszystkich. Prawo: RLS `expense_splits`, jak na telefonie. */
export async function setExpenseSplits(tripId: string, expenseId: string, chosen: string[]): Promise<FormState> {
  const { supabase } = await requireUser(`/trips/${tripId}/logistics`);
  const [people, existing] = await Promise.all([supabase.from("travelers").select("id").eq("trip_id", tripId).is("deleted_at", null), supabase.from("expense_splits").select("id").eq("expense_id", expenseId)]);
  if (people.error) return { error: dbErrorMessage(people.error) };
  if (existing.error) return { error: dbErrorMessage(existing.error) };
  const known = new Set(existing.data.map((row) => row.id));
  const rows = expenseSplitRows(tripId, expenseId, chosen, people.data.map((row) => row.id), (id) => known.has(id));
  if (rows.length > 0) {
    const { error } = await supabase.from("expense_splits").upsert(rows);
    if (error) return { error: dbErrorMessage(error) };
  }
  refresh();
  return { ok: "Zapisano." };
}

/** Usunięcie pozycji budżetu (miękkie). Nic na pozycje budżetu nie wskazuje. */
export async function removeBudgetLine(tripId: string, ref: string): Promise<FormState> {
  return change(tripId, "budgetLines", ref, () => null);
}

// --- Zadania --------------------------------------------------------------------------------

/**
 * Zadanie: tytuł, rodzaj, priorytet, opis, odpowiedź, termin (data, N dni przed wyjazdem albo
 * punktem, przed rezerwacją, w trakcie wyjazdu), osoby i powiązanie z rezerwacją, punktem albo
 * decyzją (grupa wariantów).
 */
export async function saveTask(tripId: string, ref: string | null, _prev: FormState, form: FormData): Promise<FormState> {
  const title = text(form, "title");
  if (title === "") return { error: "Podaj treść zadania." };
  const kind = ["todo", "question", "decision"].includes(text(form, "kind")) ? text(form, "kind") : "todo";
  const priority = ["high", "normal", "low"].includes(text(form, "priority")) ? text(form, "priority") : undefined;
  const date = text(form, "dueDate");
  const time = text(form, "dueTime");
  const days = count(form, "dueDays") ?? 0;
  if (Number.isNaN(days)) return { error: "Termin: liczba dni, np. 2." };
  if (time !== "" && !TIME.test(time)) return { error: "Godzina: GG:MM." };
  let due: unknown;
  switch (text(form, "dueKind")) {
    case "absolute":
      if (!DATE.test(date)) return { error: "Termin: podaj datę." };
      due = { kind: "absolute", date, ...(time ? { time } : {}) };
      break;
    case "before_trip":
      due = { kind: "before_trip", days };
      break;
    case "before_item":
      if (text(form, "dueItem") === "") return { error: "Termin: wybierz punkt planu." };
      due = { kind: "before_item", itemRef: text(form, "dueItem"), days };
      break;
    case "before_booking":
      if (text(form, "dueBooking") === "") return { error: "Termin: wybierz rezerwację." };
      due = { kind: "before_booking", bookingRef: text(form, "dueBooking") };
      break;
    case "on_trip":
      due = { kind: "on_trip", ...(text(form, "dueDay") ? { dayRef: text(form, "dueDay") } : {}), ...(time ? { time } : {}) };
      break;
    default:
      due = undefined;
  }
  return change(tripId, "tasks", ref, (_doc, current) => ({
    ...(current ?? { ref: `id-${uuidv7()}`, status: "open" }),
    title,
    kind,
    priority,
    body: optional(text(form, "body")),
    answer: optional(text(form, "answer")),
    due,
    assigneeRefs: form.getAll("assignee").map(String),
    bookingRef: optional(text(form, "bookingRef")),
    itemRef: optional(text(form, "itemRef")),
    variantGroupRef: optional(text(form, "variantGroupRef")),
  }));
}
/**
 * Odhaczenie zadania: sama zmiana statusu wiersza (nie cały element), więc może to zrobić także widz
 * przy zadaniu przypisanym do siebie (RLS `tasks_update`, trigger `guard_viewer_task`).
 */
export async function setTaskStatus(tripId: string, ref: string, status: "open" | "done" | "dropped"): Promise<FormState> {
  const { supabase } = await requireUser(`/trips/${tripId}/tasks`);
  const { data, error } = await supabase.from("tasks").update({ status }).eq("trip_id", tripId).eq("ref", ref).is("deleted_at", null).select("id");
  if (error) return { error: dbErrorMessage(error) };
  // RLS po cichu pomija wiersz, którego nie wolno zmienić.
  if ((data ?? []).length === 0) return { error: "Tego zadania nie możesz odhaczyć (albo już go nie ma — odśwież stronę)." };
  refresh();
  return { ok: status === "done" ? "Zrobione." : "Zapisano." };
}

export async function removeTask(tripId: string, ref: string): Promise<FormState> {
  return change(tripId, "tasks", ref, () => null);
}

// --- Rezerwacje -----------------------------------------------------------------------------

const BOOKING_STATUSES = ["idea", "candidate", "to_book", "booked", "paid", "cancelled", "unknown", "not_required"];

/** „1200” / „1200,50” → grosze; puste = brak; śmieci = `NaN`. */
const money = (form: FormData, name: string) => (text(form, name) === "" ? undefined : (parseMoney(text(form, name)) ?? Number.NaN));
const currencyOf = (form: FormData, name: string) => text(form, name).toUpperCase();

/** Początek albo koniec rezerwacji: data, godzina, strefa (lot: inna na każdym końcu). */
function bookingTime(form: FormData, prefix: "start" | "end", fallbackTz: string): { value?: unknown; error?: string } {
  const date = text(form, `${prefix}Date`);
  const time = text(form, `${prefix}Time`);
  const tz = text(form, `${prefix}Tz`) || fallbackTz;
  if (date === "") return time === "" ? {} : { error: "Godzina bez daty — podaj datę." };
  if (!DATE.test(date) || (time !== "" && !TIME.test(time))) return { error: "Data RRRR-MM-DD, godzina GG:MM." };
  return { value: { date, ...(time ? { time } : {}), precision: "exact", tz } };
}

/** Puste pola znikają; obiekt bez pól — brak obiektu. */
function compact(value: Record<string, unknown>): Record<string, unknown> | undefined {
  const kept = Object.fromEntries(Object.entries(value).filter(([key, each]) => each !== undefined && !(key !== "amenities" && Array.isArray(each) && each.length === 0)));
  return Object.keys(kept).filter((key) => key !== "amenities").length > 0 ? kept : undefined;
}

/**
 * Rezerwacja — nowa (`ref` = null) albo zmiana: rodzaj, tytuł, status, dostawca, kod, początek
 * i koniec ze strefami, cena, zapłata, sposób i moment płatności, zwrotność, darmowe odwołanie,
 * skład zgłoszony u operatora, co w cenie, szczegóły lotu / auta / noclegu. Usuwania nie ma —
 * na rezerwację wskazują punkty, noclegi dni i budżet; zamiast tego „anulowane”.
 */
export async function saveBooking(tripId: string, ref: string | null, _prev: FormState, form: FormData): Promise<FormState> {
  // Formularz ze strony otwartej przed wdrożeniem nowej wersji nie ma pól daty i ceny — zapis
  // wyczyściłby je w rezerwacji. Bez pola `title` nie zapisujemy nic.
  if (!form.has("title")) return { error: "Ta strona jest nieaktualna (nowa wersja aplikacji) — odśwież ją (Ctrl+F5) i zapisz jeszcze raz." };
  const status = text(form, "status");
  if (!BOOKING_STATUSES.includes(status)) return { error: "Wybierz status." };
  const title = text(form, "title");
  if (title === "") return { error: "Podaj nazwę rezerwacji." };
  const paid = money(form, "paidAmount");
  const low = money(form, "priceLow");
  const high = money(form, "priceHigh");
  if ([paid, low, high].some((value) => Number.isNaN(value))) return { error: "Kwota: liczba, np. 1200 albo 1200,50." };
  if (low !== undefined && high !== undefined && high < low) return { error: "Cena „do” mniejsza niż „od”." };
  const paidCurrency = currencyOf(form, "paidCurrency");
  const priceCurrency = currencyOf(form, "priceCurrency");
  if ((paid !== undefined && !/^[A-Z]{3}$/.test(paidCurrency)) || (low !== undefined && !/^[A-Z]{3}$/.test(priceCurrency))) return { error: "Waluta: trzy litery, np. PLN, EUR." };
  const basis = PriceBasis.safeParse(text(form, "priceBasis"));
  const paidOn = text(form, "paidOn");
  const freeCancel = text(form, "freeCancellationUntil");
  for (const date of [paidOn, freeCancel]) if (date !== "" && !DATE.test(date)) return { error: "Data: RRRR-MM-DD." };
  for (const time of [text(form, "checkInFrom"), text(form, "checkOutUntil")]) if (time !== "" && !TIME.test(time)) return { error: "Godzina: GG:MM." };
  const adults = count(form, "partyAdults");
  const children = count(form, "partyChildren");
  const kmLimit = count(form, "kmLimit");
  const rooms = count(form, "rooms");
  if ([adults, children, kmLimit, rooms].some((value) => Number.isNaN(value))) return { error: "Liczby osób, pokoi i limit km — liczby całkowite." };
  if (kmLimit === 0 || rooms === 0) return { error: "Limit km i liczba pokoi — większe od zera." };
  const refundable = text(form, "refundable");

  return commit(tripId, (doc) => {
    const current = (ref === null ? undefined : doc.bookings.find((each) => each.ref === ref)) as Element | undefined;
    if (ref !== null && current === undefined) return "Tego elementu już nie ma — odśwież stronę.";
    const kind = BookingKind.safeParse(text(form, "kind") || current?.kind);
    if (!kind.success) return "Wybierz rodzaj rezerwacji.";
    const keep = (current ?? {}) as Record<string, unknown>;
    const oldTz = (part: unknown) => (part as { tz?: string } | undefined)?.tz;
    const start = bookingTime(form, "start", oldTz(keep.start) ?? doc.trip.primaryTz);
    const end = bookingTime(form, "end", oldTz(keep.end) ?? (text(form, "startTz") || doc.trip.primaryTz));
    if (start.error || end.error) return (start.error ?? end.error)!;
    // Formularz ze starej wersji strony nie ma tych pól: wtedy miejsce zostaje bez zmian.
    const place =
      kind.data === "lodging" && form.has("placeName")
        ? bookingPlace(doc, keep.startPlaceRef as string | undefined, { name: text(form, "placeName"), coordinates: text(form, "placeCoordinates"), title }, uuidv7())
        : null;
    if (typeof place === "string") return place;
    const element: Element = {
      ...(current ?? { ref: `id-${uuidv7()}`, addons: [], pros: [], cons: [], links: [], notes: [] }),
      ...(place === null ? {} : { startPlaceRef: place.placeRef }),
      kind: kind.data,
      title,
      status,
      provider: optional(text(form, "provider")),
      confirmationCode: optional(text(form, "confirmationCode")),
      start: start.value,
      end: end.value,
      price:
        low === undefined
          ? undefined
          : { ...((keep.price as object | undefined) ?? {}), currency: priceCurrency, basis: basis.success ? basis.data : "per_group", minMinor: low, maxMinor: high ?? low, from: false, approx: form.get("priceApprox") === "on" },
      paid: paid === undefined ? undefined : { amountMinor: paid, currency: paidCurrency, ...(paidOn ? { date: paidOn } : {}) },
      paymentMethod: optional(text(form, "paymentMethod")),
      payWhen: optional(text(form, "payWhen")),
      refundable: refundable === "yes" ? true : refundable === "no" ? false : undefined,
      freeCancellationUntil: optional(freeCancel),
      party: adults === undefined && children === undefined ? undefined : { adults: adults ?? 0, children: children ?? 0 },
      includes: text(form, "includes").split(/[,;\n]/).map((each) => each.trim()).filter(Boolean),
      checkInFrom: kind.data === "lodging" ? optional(text(form, "checkInFrom")) : undefined,
      checkOutUntil: kind.data === "lodging" ? optional(text(form, "checkOutUntil")) : undefined,
      // Szczegóły tylko przy pasującym rodzaju; pola spoza formularza (lotniska z importu, model auta) zostają.
      flight:
        kind.data === "flight"
          ? compact({ ...((keep.flight as object) ?? {}), number: optional(text(form, "flightNumber").toUpperCase()), baggage: optional(text(form, "baggage")), fromAirport: optional(text(form, "fromAirport").toUpperCase()), toAirport: optional(text(form, "toAirport").toUpperCase()) })
          : undefined,
      car: kind.data === "car_rental" ? compact({ ...((keep.car as object) ?? {}), carClass: optional(text(form, "carClass")), kmLimit, officeHours: optional(text(form, "officeHours")) }) : undefined,
      lodging: kind.data === "lodging" ? compact({ amenities: [], ...((keep.lodging as object) ?? {}), rooms, breakfast: optional(text(form, "breakfast")) }) : undefined,
    };
    const list = doc.bookings as unknown as Element[];
    return {
      doc: {
        ...doc,
        places: place?.places ?? doc.places,
        bookings: (current === undefined ? [...list, element] : list.map((each) => (each.ref === ref ? element : each))) as unknown as Doc["bookings"],
      },
      writes: [
        ...(place?.write === undefined ? [] : [{ collection: "places" as const, element: place.write.place as unknown as Element, op: place.write.op }]),
        { collection: "bookings" as const, element, op: current === undefined ? ("insert" as const) : ("update" as const) },
      ],
      ok: "Zapisano.",
    };
  });
}

/**
 * Punkty planu „w pakiecie” rezerwacji (pakiet Agafay: quady, wielbłądy, kolacja): wskazują
 * rezerwację i mają płatność „w cenie”. Odznaczone przestają ją wskazywać.
 */
/** Sam status rezerwacji („zapłacone”, „zarezerwowane”…) — z listy przy rezerwacji, bez otwierania formularza. */
export async function setBookingStatus(tripId: string, ref: string, status: string): Promise<FormState> {
  const parsed = BookingStatus.safeParse(status);
  if (!parsed.success) return { error: "Nieznany status." };
  return change(tripId, "bookings", ref, (_doc, current) => (current === undefined ? "Tej rezerwacji już nie ma — odśwież stronę." : { ...current, status: parsed.data }));
}

/**
 * Usuwa anulowaną rezerwację: najpierw odwołania (`removeBooking`), na końcu sam wiersz. Dokumenty z sejfu
 * tracą powiązanie, bo inaczej zniknęłyby z listy sejfu na webie; na liście są potem w „Inne dokumenty”.
 */
export async function removeCancelledBooking(tripId: string, ref: string): Promise<FormState> {
  const { supabase } = await requireUser(`/trips/${tripId}/logistics`);
  const pulled = await pullTrip(supabase, tripId);
  if (pulled.error !== undefined) return { error: pulled.error };
  const { payload } = pulled;
  const { doc } = stateFromPayload(payload);
  const booking = doc.bookings.find((each) => each.ref === ref);
  if (booking === undefined) return { error: "Tej rezerwacji już nie ma — odśwież stronę." };
  if (booking.status !== "cancelled") return { error: "Usunąć można tylko anulowaną rezerwację — najpierw zmień jej status." };
  const edit = removeBooking(doc, ref)!;
  const checked = TripDocument.safeParse(edit.doc);
  if (!checked.success) {
    return { error: validationError(checked.error) };
  }
  const ids = refIndex(payload.tables);
  const unlinked = await supabase.from("documents").update({ booking_id: null }).eq("trip_id", tripId).eq("booking_id", ids[ref]!);
  if (unlinked.error) return { error: dbErrorMessage(unlinked.error) };
  try {
    await saveElements(supabase, tripId, checked.data, edit.writes, ids);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  refresh();
  return { ok: "Usunięto." };
}

export async function setBookingItems(tripId: string, bookingRef: string, itemRefs: string[]): Promise<FormState> {
  const chosen = new Set(itemRefs);
  return commit(tripId, (doc) => {
    if (!doc.bookings.some((booking) => booking.ref === bookingRef)) return "Tej rezerwacji już nie ma — odśwież stronę.";
    const writes: ElementWrite[] = [];
    const items = doc.items.map((item) => {
      const was = item.bookingRef === bookingRef;
      const now = chosen.has(item.ref);
      if (was === now) return item;
      const next = now ? { ...item, bookingRef, payment: "included" as const } : { ...item, bookingRef: undefined, payment: item.payment === "included" ? undefined : item.payment };
      writes.push({ collection: "items", element: next, op: "update" });
      return next;
    });
    return { doc: { ...doc, items }, writes, ok: writes.length === 0 ? "Bez zmian." : `Zapisano (zmienione punkty: ${writes.length}).` };
  });
}

// --- Kontakty -------------------------------------------------------------------------------

const CONTACT_ROLES = ["host", "operator", "rental", "guide", "emergency", "venue", "other"];

/** Kontakt: imię lub nazwa, rola, telefon, e-mail, rezerwacja, notatka. */
export async function saveContact(tripId: string, ref: string | null, _prev: FormState, form: FormData): Promise<FormState> {
  const name = text(form, "name");
  if (name === "") return { error: "Podaj nazwę kontaktu." };
  const role = CONTACT_ROLES.includes(text(form, "role")) ? text(form, "role") : "other";
  const phone = text(form, "phone");
  const email = text(form, "email");
  if (phone === "" && email === "") return { error: "Podaj telefon albo e-mail." };
  return change(tripId, "contacts", ref, (_doc, current) => ({
    ...(current ?? { ref: `id-${uuidv7()}` }),
    name,
    role,
    phone: optional(phone),
    email: optional(email),
    bookingRef: optional(text(form, "bookingRef")),
    notes: optional(text(form, "notes")),
  }));
}

/** Usunięcie kontaktu (miękkie). Nic na kontakty nie wskazuje. */
export async function removeContact(tripId: string, ref: string): Promise<FormState> {
  return change(tripId, "contacts", ref, () => null);
}

// --- Zakupy ---------------------------------------------------------------------------------

/** Pozycja listy zakupów: wspólna rzecz listy pakowania w kategorii „zakupy” (odhaczana na telefonie). */
export async function saveShoppingItem(tripId: string, ref: string | null, _prev: FormState, form: FormData): Promise<FormState> {
  const title = text(form, "title");
  if (title === "") return { error: "Podaj, co kupić." };
  const quantity = Number(text(form, "quantity").replace(",", "."));
  return change(tripId, "packing", ref, (_doc, current) => ({
    ...(current ?? { ref: `id-${uuidv7()}` }),
    category: SHOPPING_CATEGORY,
    scope: "shared",
    title,
    quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : undefined,
    unit: optional(text(form, "unit")),
    note: optional(text(form, "note")),
  }));
}

export async function removeShoppingItem(tripId: string, ref: string): Promise<FormState> {
  return change(tripId, "packing", ref, () => null);
}

// --- Sprzęt ---------------------------------------------------------------------------------

/**
 * Rzecz do zabrania: osobista (każdy albo jedna osoba) lub wspólna. Wskazanie osoby przy wspólnej
 * (plan, import) zostaje, ale o tym, kto bierze, decyduje `setGearCarrier`. Rzecz, która stała się
 * osobista, traci nosicieli: inaczej ich obciążenie i blokada usunięcia uczestnika zostałyby po niej.
 */
export async function saveGearItem(tripId: string, ref: string | null, itemId: string | null, _prev: FormState, form: FormData): Promise<FormState> {
  const title = text(form, "title");
  if (title === "") return { error: "Podaj nazwę rzeczy." };
  const category = text(form, "category");
  if (category === "") return { error: "Podaj kategorię, np. biwak, ubrania." };
  if (category.toLowerCase() === SHOPPING_CATEGORY) return { error: "Zakupy dodaj na liście zakupów." };
  const scope = text(form, "scope") === "personal" ? "personal" : "shared";
  const quantityText = text(form, "quantity").replace(",", ".");
  const quantity = quantityText === "" ? undefined : Number(quantityText);
  if (quantity !== undefined && !(Number.isFinite(quantity) && quantity > 0)) return { error: "Ilość: liczba większa od zera." };
  const weightG = parseWeightKg(text(form, "weight"));
  if (weightG === null) return { error: "Waga: liczba kilogramów, np. 1,5." };

  const result = await change(tripId, "packing", ref, (_doc, current) => ({
    ...(current ?? { ref: `id-${uuidv7()}` }),
    category,
    scope,
    title,
    quantity,
    unit: optional(text(form, "unit")),
    note: optional(text(form, "note")),
    weightG,
    assigneeRef: scope === "personal" ? optional(text(form, "assignee")) : current?.scope === "shared" ? current.assigneeRef : undefined,
  }));
  if (result.error || scope === "shared" || itemId === null) return result;
  const { supabase } = await requireUser(`/trips/${tripId}/gear`);
  const { error } = await supabase.from("packing_carriers").update({ quantity: 0 }).eq("packing_item_id", itemId).gt("quantity", 0);
  return error ? { error: dbErrorMessage(error) } : result;
}

/** Usunięcie rzeczy (miękkie) razem z tym, kto ją brał. */
export async function removeGearItem(tripId: string, ref: string, itemId: string): Promise<FormState> {
  const result = await change(tripId, "packing", ref, () => null);
  if (result.error) return result;
  const { supabase } = await requireUser(`/trips/${tripId}/gear`);
  const { error } = await supabase.from("packing_carriers").update({ deleted_at: new Date().toISOString() }).eq("packing_item_id", itemId);
  return error ? { error: dbErrorMessage(error) } : result;
}

/** „Biorę” (`quantity` > 0) albo „nie biorę” (0). Prawo: RLS — za siebie i swoje dzieci, organizator i edytor za każdego. */
export async function setGearCarrier(tripId: string, itemId: string, travelerId: string, quantity: number): Promise<FormState> {
  if (!Number.isFinite(quantity) || quantity < 0) return { error: "Ilość: liczba większa od zera." };
  const { supabase } = await requireUser(`/trips/${tripId}/gear`);
  const { error } = await supabase.from("packing_carriers").upsert(carrierRow(tripId, itemId, travelerId, quantity));
  if (error) return { error: dbErrorMessage(error) };
  refresh();
  return { ok: "Zapisano." };
}

/** Posiłek „gotujemy sami” (albo nie) — tylko ta jedna flaga punktu planu. */
export async function setSelfCooked(tripId: string, ref: string, value: boolean): Promise<FormState> {
  return change(tripId, "items", ref, (_doc, current) => (current?.kind === "meal" ? { ...current, selfCooked: value || undefined } : "To nie jest posiłek."));
}

// --- Budżet z planu i kursy -----------------------------------------------------------------

/** Propozycja z `budgetSuggestions` (rezerwacja albo punkt z ceną) jako nowa pozycja budżetu. */
export async function addSuggestedBudgetLine(tripId: string, source: "booking" | "item", ref: string): Promise<FormState> {
  return change(tripId, "budgetLines", null, (doc) => {
    const suggestion = budgetSuggestions(doc).find((each) => each.source === source && each.ref === ref);
    if (suggestion === undefined) return "Ta pozycja jest już w budżecie albo nie ma ceny — odśwież stronę.";
    return { ...suggestion.line, ref: `id-${uuidv7()}` };
  });
}

/**
 * Kursy walut wyjazdu (`trip.fx`): waluta, ile waluty bazowej za jednostkę, data kursu. To wiersz
 * wyjazdu, nie kolekcja — zapis wprost do `trips` (RLS: organizator, edytor).
 */
export async function saveFx(tripId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const currencies = form.getAll("fxCurrency").map((each) => String(each).trim().toUpperCase());
  const rates = form.getAll("fxRate").map((each) => String(each).trim().replace(",", "."));
  const dates = form.getAll("fxDate").map((each) => String(each).trim());
  const fx: { currency: string; rateToBase: number; date?: string }[] = [];
  for (const [index, currency] of currencies.entries()) {
    if (currency === "" && rates[index] === "") continue;
    const rate = Number(rates[index]);
    if (!/^[A-Z]{3}$/.test(currency) || !(rate > 0)) return { error: `Kurs ${index + 1}: waluta z trzech liter i kurs większy od zera (np. MAD 0,43).` };
    const date = dates[index] ?? "";
    if (date !== "" && !DATE.test(date)) return { error: `Kurs ${currency}: data RRRR-MM-DD.` };
    if (fx.some((each) => each.currency === currency)) return { error: `Waluta ${currency} jest dwa razy.` };
    fx.push({ currency, rateToBase: rate, ...(date ? { date } : {}) });
  }
  const { supabase } = await requireUser(`/trips/${tripId}/logistics`);
  const { data: trip, error: readError } = await supabase.from("trips").select("base_currency").eq("id", tripId).maybeSingle();
  if (readError) return { error: dbErrorMessage(readError) };
  if (trip && fx.some((each) => each.currency === trip.base_currency)) return { error: `${trip.base_currency} to waluta bazowa wyjazdu — nie potrzebuje kursu.` };
  const { data, error } = await supabase.from("trips").update({ fx }).eq("id", tripId).select("id");
  if (error) return { error: dbErrorMessage(error) };
  if ((data ?? []).length === 0) return { error: "Brak uprawnień do tej zmiany." };
  refresh();
  return { ok: "Zapisano kursy." };
}

/**
 * Waluta wyjazdu, czyli ta, w której są sumy i rozliczenie. Kwoty pozycji i wydatków się nie zmieniają,
 * tylko kursy przechodzą na nową walutę; brakujący kurs nowej waluty przychodzi z Frankfurtera.
 */
export async function setTripCurrency(tripId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const to = text(form, "currency").toUpperCase();
  if (!/^[A-Z]{3}$/.test(to)) return { error: "Waluta: trzy litery, np. PLN, EUR, MAD." };
  const { supabase } = await requireUser(`/trips/${tripId}/logistics`);
  const { data: trip, error: readError } = await supabase.from("trips").select("base_currency, fx").eq("id", tripId).maybeSingle();
  if (readError) return { error: dbErrorMessage(readError) };
  if (trip === null) return { error: "Nie ma takiego wyjazdu." };
  const from = trip.base_currency as string;
  if (from === to) return { ok: `Wyjazd jest już w ${to}.` };
  let rates = (trip.fx ?? []) as FxRate[];
  if (!rates.some((rate) => rate.currency === to)) {
    try {
      rates = mergeRates(rates, await fetchRates(from, [to]));
    } catch {
      // Komunikat niżej: brak kursu wygląda tak samo, czy źródło nie odpowiedziało, czy go nie zna.
    }
  }
  const fx = rebaseRates(rates, from, to);
  if (fx === null) return { error: `Nie ma kursu ${to} i nie udało się go pobrać. Dodaj go w kursach (1 ${to} = ile ${from}) i spróbuj ponownie.` };
  const { data, error } = await supabase.from("trips").update({ base_currency: to, fx }).eq("id", tripId).select("id");
  if (error) return { error: dbErrorMessage(error) };
  if ((data ?? []).length === 0) return { error: "Brak uprawnień do tej zmiany." };
  refresh();
  return { ok: `Sumy są teraz w ${to}.` };
}

/**
 * „Pobierz aktualne kursy”: Frankfurter v2 (docs/USLUGI.md) dla walut wyjazdu — z budżetu,
 * rezerwacji, kursów w planie i wydatków. Nowe kursy zastępują stare tych walut, inne zostają.
 */
export async function fetchFx(tripId: string): Promise<FormState> {
  const { supabase } = await requireUser(`/trips/${tripId}/logistics`);
  const pulled = await pullTrip(supabase, tripId);
  if (pulled.error !== undefined) return { error: pulled.error };
  const { payload } = pulled;
  const doc = stateFromPayload(payload).doc;
  const spent = ((payload.tables.expenses ?? []) as { currency?: string; deleted_at: string | null }[]).filter((row) => row.deleted_at === null).map((row) => row.currency ?? "");
  const currencies = tripCurrencies(doc, spent.filter((currency) => /^[A-Z]{3}$/.test(currency)));
  if (currencies.length === 0) return { error: "Wyjazd nie ma walut innych niż bazowa." };
  let fresh;
  try {
    fresh = await fetchRates(doc.trip.baseCurrency, currencies);
  } catch (e) {
    return { error: `Nie pobrano kursów: ${e instanceof Error ? e.message : String(e)}` };
  }
  const fx = mergeRates(doc.trip.fx, fresh);
  const { data: saved, error: saveError } = await supabase.from("trips").update({ fx }).eq("id", tripId).select("id");
  if (saveError) return { error: dbErrorMessage(saveError) };
  if ((saved ?? []).length === 0) return { error: "Brak uprawnień do tej zmiany." };
  refresh();
  const missing = currencies.filter((currency) => !fresh.some((rate) => rate.currency === currency));
  return { ok: `Pobrano kursy z ${fresh[0]?.date ?? "dziś"}: ${fresh.map((rate) => rate.currency).join(", ")}.${missing.length > 0 ? ` Bez kursu w źródle: ${missing.join(", ")}.` : ""}` };
}
