"use server";

import { applyBookingDraft, BOOKING_IMPORT_FIELDS, BOOKING_KIND, BookingDraft, type BookingDraftRow, bookingDraftRows, bookingWhen, matchingBooking, tripCurrencies, TripDocument } from "@expeditionplan/core";
import { BOOKING_FILE_MIME, BOOKING_TEXT_LIMIT, readBooking } from "@expeditionplan/planner";
import { type ElementWrite, refIndex, saveElements, stateFromPayload, uuidv7 } from "@expeditionplan/sync";
import { refresh } from "next/cache";
import { z } from "zod";

import type { FormState } from "@/app/actions";
import { aiAccessError, geminiClient } from "@/lib/ai";
import { requireUser } from "@/lib/auth";
import { isListedBooking } from "@/lib/booking-link";
import { pullTrip, validationError } from "@/lib/trip-snapshot";

/**
 * Import rezerwacji z potwierdzenia (strona „Rezerwacje i budżet”): PDF, zrzut ekranu albo wklejony
 * mail → szkic AI (Gemini) → podgląd pole po polu → zapis do nowej albo wskazanej rezerwacji.
 * Plik do sejfu wgrywa potem przeglądarka (`components/booking-import.tsx`), bo tam jest już sejf
 * z odczytem kodu. O prawie do zapisu decyduje RLS (organizator, edytor).
 */

/** Limit ciała akcji to 4 MB (`next.config.ts`, Vercel przyjmuje 4,5 MB) — plik z zapasem na resztę formularza. */
const MAX_FILE_BYTES = 3_800_000;

export type BookingTarget = { ref: string; label: string };
export type BookingImportState = FormState & { draft?: BookingDraft; targetRef?: string | null; rows?: BookingDraftRow[]; targets?: BookingTarget[] };

const FIELDS = z.array(z.enum(BOOKING_IMPORT_FIELDS));
const TargetRef = z.string().min(1).max(200).nullable();

async function loadTrip(tripId: string) {
  const { supabase } = await requireUser(`/trips/${tripId}/logistics`);
  const pulled = await pullTrip(supabase, tripId);
  if (pulled.error !== undefined) return { error: pulled.error };
  const { payload } = pulled;
  return { supabase, doc: stateFromPayload(payload).doc, ids: refIndex(payload.tables) };
}

/** Rezerwacje, które dokument może uzupełnić: z tabeli „Rezerwacje” i kandydaci, bez anulowanych. */
function targetsOf(doc: TripDocument): BookingTarget[] {
  return doc.bookings
    .filter((booking) => booking.status !== "cancelled")
    .sort((a, b) => Number(isListedBooking(b)) - Number(isListedBooking(a)))
    .map((booking) => ({ ref: booking.ref, label: [booking.title, BOOKING_KIND[booking.kind], bookingWhen(booking)].filter(Boolean).join(" · ") }));
}

/** Czyta plik albo wklejony tekst i zwraca szkic do podglądu; nic jeszcze nie zapisuje. */
export async function readBookingImport(tripId: string, form: FormData): Promise<BookingImportState> {
  const file = form.get("file");
  const text = String(form.get("text") ?? "").trim();
  const upload = file instanceof File && file.size > 0 ? file : null;
  if (upload === null && text === "") return { error: "Wybierz plik albo wklej treść maila z potwierdzeniem." };
  if (upload !== null) {
    if (!BOOKING_FILE_MIME.includes(upload.type)) return { error: "AI czyta PDF i zdjęcia (JPG, PNG, WebP, HEIC)." };
    if (upload.size > MAX_FILE_BYTES) return { error: "Plik jest za duży do odczytu przez AI (limit ok. 3,8 MB). Dodaj rezerwację ręcznie, a plik wgraj do sejfu." };
  } else if (text.length > BOOKING_TEXT_LIMIT) {
    return { error: `Tekst jest za długi: wklej najwyżej ${BOOKING_TEXT_LIMIT.toLocaleString("pl-PL")} znaków, samo potwierdzenie.` };
  }
  const denied = await aiAccessError();
  if (denied !== null) return { error: denied };
  const gemini = geminiClient();
  if (gemini === null) return { error: "Brak klucza GEMINI_API_KEY." };
  const loaded = await loadTrip(tripId);
  if ("error" in loaded) return { error: loaded.error };
  const { doc } = loaded;
  const context = {
    startDate: doc.trip.startDate,
    endDate: doc.trip.endDate,
    zones: [...new Set([doc.trip.primaryTz, ...doc.days.map((day) => day.tz), doc.trip.homeTz])],
    currencies: tripCurrencies(doc),
  };
  try {
    const source = upload !== null ? { file: { mimeType: upload.type, data: Buffer.from(await upload.arrayBuffer()).toString("base64") } } : { text };
    const draft = await readBooking(gemini.client, source, context, { timeoutMs: 90_000 });
    if (draft === null) return { error: "W tym dokumencie nie ma danych rezerwacji." };
    const targetRef = matchingBooking(doc, draft)?.ref ?? null;
    return { draft, targetRef, rows: bookingDraftRows(doc, draft, targetRef), targets: targetsOf(doc) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** Podgląd tego samego szkicu dla innej rezerwacji (albo nowej) — bez AI. */
export async function previewBookingImport(tripId: string, input: BookingDraft, targetRef: string | null): Promise<BookingImportState> {
  const draft = BookingDraft.safeParse(input);
  const target = TargetRef.safeParse(targetRef);
  if (!draft.success || !target.success) return { error: "Niepoprawne dane rezerwacji." };
  const loaded = await loadTrip(tripId);
  if ("error" in loaded) return { error: loaded.error };
  if (target.data !== null && !loaded.doc.bookings.some((each) => each.ref === target.data)) return { error: "Tej rezerwacji już nie ma — odśwież stronę." };
  return { draft: draft.data, targetRef: target.data, rows: bookingDraftRows(loaded.doc, draft.data, target.data) };
}

/** Zapisuje pola zaznaczone w podglądzie; `bookingId` to wiersz rezerwacji dla dokumentu w sejfie. */
export async function saveBookingImport(tripId: string, input: BookingDraft, targetRef: string | null, fields: string[]): Promise<FormState & { bookingId?: string }> {
  const draft = BookingDraft.safeParse(input);
  const picked = FIELDS.safeParse(fields);
  const target = TargetRef.safeParse(targetRef);
  if (!draft.success || !picked.success || !target.success) return { error: "Niepoprawne dane rezerwacji." };
  if (target.data !== null && picked.data.length === 0) return { error: "Zaznacz, co zapisać." };
  const loaded = await loadTrip(tripId);
  if ("error" in loaded) return { error: loaded.error };
  const edit = applyBookingDraft(loaded.doc, draft.data, target.data, picked.data, { bookingId: uuidv7(), placeId: uuidv7(), contactId: uuidv7() });
  if (edit === null) return { error: "Tej rezerwacji już nie ma — odśwież stronę." };
  const checked = TripDocument.safeParse(edit.doc);
  if (!checked.success) return { error: validationError(checked.error) };
  let bookingId: string | undefined;
  try {
    const ids = await saveElements(loaded.supabase, tripId, checked.data, edit.writes as ElementWrite[], loaded.ids);
    bookingId = ids[edit.booking.ref];
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  refresh();
  return { ok: target.data === null ? `Dodano rezerwację „${edit.booking.title}”.` : `Zapisano w rezerwacji „${edit.booking.title}”.`, ...(bookingId ? { bookingId } : {}) };
}
