"use server";

import { DatePoll, TripDocument } from "@expeditionplan/core";
import { dbErrorMessage, type ElementWrite, refIndex, saveElements, stateFromPayload, uuidv7, voteRow } from "@expeditionplan/sync";
import { refresh } from "next/cache";
import { z } from "zod";

import type { FormState } from "@/app/actions";
import { chooseCandidate } from "@/app/candidates-actions";
import { requireUser } from "@/lib/auth";
import { pullTrip, validationError } from "@/lib/trip-snapshot";

/**
 * Głosowanie (strona „Głosowanie”): głos zapisuje każdy uczestnik za siebie i swoje dzieci, organizator
 * i edytor także za osobę bez konta — pilnuje tego RLS `trip_votes`. Decyzja (wybrany wariant,
 * okno ankiety terminu) należy do organizatora i edytora. Nowy termin ustawia „Zmień termin”.
 */

const Uuid = z.uuid();
const Choice = z.union([z.object({ groupId: Uuid, variantId: Uuid.nullable() }), z.object({ day: z.iso.date(), answer: z.enum(["yes", "maybe", "no"]) })]);

/** Głos na wariant w grupie (`variantId` null = wszystko jedno); `withdrawn` cofa głos. */
export async function castVote(tripId: string, travelerId: string, choice: { groupId: string; variantId: string | null }, withdrawn = false): Promise<FormState> {
  const parsed = z.object({ trip: Uuid, traveler: Uuid, choice: Choice }).safeParse({ trip: tripId, traveler: travelerId, choice });
  if (!parsed.success) return { error: "Niepoprawny głos." };
  const { supabase } = await requireUser(`/trips/${tripId}/votes`);
  const { error } = await supabase.from("trip_votes").upsert(voteRow(tripId, travelerId, parsed.data.choice, withdrawn), { onConflict: "id" });
  if (error) return { error: dbErrorMessage(error, "Nie zapisano głosu. Spróbuj jeszcze raz.") };
  refresh();
  return { ok: withdrawn ? "Wycofano głos." : "Zapisano głos." };
}

/** Dostępność jednej osoby w dniach ankiety; `answer: null` usuwa odpowiedź z dnia. */
export async function saveAvailability(tripId: string, travelerId: string, answers: { day: string; answer: "yes" | "maybe" | "no" | null }[]): Promise<FormState> {
  const parsed = z
    .object({ trip: Uuid, traveler: Uuid, answers: z.array(z.object({ day: z.iso.date(), answer: z.enum(["yes", "maybe", "no"]).nullable() })).min(1).max(400) })
    .safeParse({ trip: tripId, traveler: travelerId, answers });
  if (!parsed.success) return { error: "Niepoprawne odpowiedzi." };
  const { supabase } = await requireUser(`/trips/${tripId}/votes`);
  // Usunięty dzień: ten sam wiersz z `deleted_at` (odpowiedź jest wymagana przez bazę, więc zostaje dawna treść).
  const rows = parsed.data.answers.map(({ day, answer }) => voteRow(tripId, travelerId, { day, answer: answer ?? "maybe" }, answer === null));
  const { error } = await supabase.from("trip_votes").upsert(rows, { onConflict: "id" });
  if (error) return { error: dbErrorMessage(error, "Nie zapisano dostępności. Spróbuj jeszcze raz.") };
  refresh();
  return { ok: "Zapisano dostępność." };
}

/**
 * „Wybieram” po głosowaniu: grupa dostaje `chosenRef`. Kandydaci rezerwacji idą drogą „Do porównania”
 * (status „do rezerwacji” dla wybranego), pozostałe grupy zmieniają tylko wybór.
 */
export async function chooseVariant(tripId: string, groupRef: string, variantRef: string): Promise<FormState> {
  const { supabase } = await requireUser(`/trips/${tripId}/votes`);
  const pulled = await pullTrip(supabase, tripId);
  if (pulled.error !== undefined) return { error: pulled.error };
  const { doc } = stateFromPayload(pulled.payload);
  const group = doc.variantGroups.find((each) => each.ref === groupRef);
  if (group === undefined) return { error: "Tego głosowania już nie ma — odśwież stronę." };
  if (!doc.variants.some((each) => each.ref === variantRef && each.groupRef === groupRef)) return { error: "Tego wariantu już nie ma — odśwież stronę." };
  if (group.scope === "booking") return chooseCandidate(tripId, groupRef, variantRef);
  const next = { ...group, chosenRef: variantRef };
  const checked = TripDocument.safeParse({ ...doc, variantGroups: doc.variantGroups.map((each) => (each.ref === groupRef ? next : each)) });
  if (!checked.success) return { error: validationError(checked.error) };
  try {
    await saveElements(supabase, tripId, checked.data, [{ collection: "variantGroups", element: next, op: "update" }], refIndex(pulled.payload.tables));
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  refresh();
  return { ok: "Wybrano wariant." };
}

/** Otwiera albo zamyka głosowanie uczestników nad grupą wariantów (głosy zostają). */
export async function setVotingOpen(tripId: string, groupRef: string, open: boolean): Promise<FormState> {
  const { supabase } = await requireUser(`/trips/${tripId}/votes`);
  const pulled = await pullTrip(supabase, tripId);
  if (pulled.error !== undefined) return { error: pulled.error };
  const { doc } = stateFromPayload(pulled.payload);
  const group = doc.variantGroups.find((each) => each.ref === groupRef);
  if (group === undefined) return { error: "Tego wyboru już nie ma — odśwież stronę." };
  const next = { ...group, votingOpen: true };
  if (!open) delete (next as Partial<typeof next>).votingOpen;
  try {
    await saveElements(supabase, tripId, doc, [{ collection: "variantGroups", element: next, op: "update" }], refIndex(pulled.payload.tables));
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  refresh();
  return { ok: open ? "Otwarto głosowanie." : "Zamknięto głosowanie." };
}

/**
 * Nowa ankieta ogólna (grupa `scope: 'poll'`): pytanie, opcje (po jednej w wierszu, 2–12), opcjonalny opis;
 * „otwarta” od razu widoczna dla uczestników. Głosy jak przy wariantach planu.
 */
export async function createPoll(tripId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const title = String(form.get("title") ?? "").trim();
  const note = String(form.get("note") ?? "").trim();
  const options = [...new Set(String(form.get("options") ?? "").split("\n").map((line) => line.trim()).filter((line) => line !== ""))];
  if (title === "") return { error: "Wpisz pytanie ankiety." };
  if (options.length < 2) return { error: "Podaj co najmniej dwie opcje, każdą w osobnym wierszu." };
  if (options.length > 12) return { error: "Najwyżej 12 opcji." };
  const { supabase } = await requireUser(`/trips/${tripId}/votes`);
  const pulled = await pullTrip(supabase, tripId);
  if (pulled.error !== undefined) return { error: pulled.error };
  const { doc } = stateFromPayload(pulled.payload);
  const group = {
    ref: `id-${uuidv7()}`,
    scope: "poll" as const,
    title,
    conditionKind: "choice" as const,
    ...(note ? { conditionText: note } : {}),
    ...(form.get("open") === "on" ? { votingOpen: true } : {}),
  };
  const variants = options.map((label) => ({ ref: `id-${uuidv7()}`, groupRef: group.ref, label, pros: [], cons: [] }));
  const checked = TripDocument.safeParse({ ...doc, variantGroups: [...doc.variantGroups, group], variants: [...doc.variants, ...variants] });
  if (!checked.success) return { error: validationError(checked.error) };
  const writes: ElementWrite[] = [
    { collection: "variantGroups", element: group, op: "insert" },
    ...variants.map((element) => ({ collection: "variants" as const, element, op: "insert" as const })),
  ];
  try {
    await saveElements(supabase, tripId, checked.data, writes, refIndex(pulled.payload.tables));
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  refresh();
  return { ok: "Dodano ankietę." };
}

/** Usuwa ankietę ogólną z jej opcjami (głosy zostają w bazie, bez grupy nikt ich nie liczy). */
export async function removePoll(tripId: string, groupRef: string): Promise<FormState> {
  const { supabase } = await requireUser(`/trips/${tripId}/votes`);
  const pulled = await pullTrip(supabase, tripId);
  if (pulled.error !== undefined) return { error: pulled.error };
  const { doc } = stateFromPayload(pulled.payload);
  const group = doc.variantGroups.find((each) => each.ref === groupRef && each.scope === "poll");
  if (group === undefined) return { error: "Tej ankiety już nie ma — odśwież stronę." };
  const variants = doc.variants.filter((each) => each.groupRef === groupRef);
  const next = { ...doc, variantGroups: doc.variantGroups.filter((each) => each.ref !== groupRef), variants: doc.variants.filter((each) => each.groupRef !== groupRef) };
  const writes: ElementWrite[] = [
    ...variants.map((element) => ({ collection: "variants" as const, element, op: "remove" as const })),
    { collection: "variantGroups", element: group, op: "remove" },
  ];
  try {
    await saveElements(supabase, tripId, next, writes, refIndex(pulled.payload.tables));
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  refresh();
  return { ok: "Usunięto ankietę." };
}

/** Okno ankiety terminu; puste „od” usuwa ankietę (głosy zostają w bazie). */
export async function saveDatePoll(tripId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const from = String(form.get("from") ?? "").trim();
  const to = String(form.get("to") ?? "").trim();
  const closesOn = String(form.get("closesOn") ?? "").trim();
  let poll: DatePoll | null = null;
  if (from !== "" || to !== "") {
    const parsed = DatePoll.safeParse({ from, to, ...(closesOn ? { closesOn } : {}) });
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Podaj daty okna RRRR-MM-DD." };
    poll = parsed.data;
  }
  const { supabase } = await requireUser(`/trips/${tripId}/votes`);
  const { data, error } = await supabase.from("trips").update({ date_poll: poll }).eq("id", tripId).select("id");
  if (error) return { error: dbErrorMessage(error) };
  if ((data ?? []).length === 0) return { error: "Ankietę terminu zmienia organizator albo edytor." };
  refresh();
  return { ok: poll === null ? "Zamknięto ankietę terminu." : "Zapisano ankietę terminu." };
}
