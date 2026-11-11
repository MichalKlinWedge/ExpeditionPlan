"use server";

import { applyExtraPicks, corridorTowns, dayCorridor, dayLodging, extraCandidates, type ExtraRequest, localToday, type OsmFeature, plural, scheduleDay, TripDocument } from "@expeditionplan/core";
import { z } from "zod";
import { fetchDayAttractions, OVERPASS_URL, pickDayExtras } from "@expeditionplan/planner";
import { refIndex, saveElements, stateFromPayload } from "@expeditionplan/sync";
import { refresh } from "next/cache";

import type { FormState } from "@/app/actions";
import { aiAccessError, geminiClient } from "@/lib/ai";
import { requireUser } from "@/lib/auth";
import { chosenVariantsFromCookie } from "@/lib/plan-variants-server";
import { pullTrip, validationError } from "@/lib/trip-snapshot";

/**
 * „Po drodze i w pobliżu” (plan dnia): jedno zapytanie Overpass wokół trasy i miejsc dnia w wariantach
 * oglądanych w planie, kandydaci z kodu (`core/day-extras.ts`), wybór i opis z AI (Gemini), zapis w dniu
 * (`days.extras`) — telefon ma listę offline. Odrzucone i wstawione zostają, reszta listy się odświeża; szukanie
 * zawężone (trasa przejazdu, miasto, własna prośba) dopisuje do listy. Długi przejazd autem (też z domu) daje
 * miasta po drodze, a w nich atrakcje na przerwę.
 */
const RequestInput = z.object({
  scope: z.enum(["day", "route", "city"]).default("day"),
  city: z.string().trim().max(80).optional(),
  hint: z.string().trim().max(300).optional(),
});

export async function findDayExtras(tripId: string, dayRef: string, input: Partial<ExtraRequest> = {}): Promise<FormState> {
  const parsed = RequestInput.safeParse(input);
  if (!parsed.success) return { error: "Doprecyzowanie jest za długie (miasto do 80 znaków, prośba do 300)." };
  const request: ExtraRequest = { scope: parsed.data.scope, ...(parsed.data.city ? { city: parsed.data.city } : {}), ...(parsed.data.hint ? { hint: parsed.data.hint } : {}) };
  if (request.scope === "city" && !request.city) return { error: "Wpisz miasto, w którym szukać." };
  if (!process.env.CONTACT_EMAIL) return { error: "Nie szukam: serwer nie ma ustawionego CONTACT_EMAIL (warunek serwera OpenStreetMap Overpass)." };
  const { supabase } = await requireUser(`/trips/${tripId}/plan?day=${encodeURIComponent(dayRef)}`);
  const denied = await aiAccessError();
  if (denied !== null) return { error: denied };
  const gemini = geminiClient();
  if (gemini === null) return { error: "Brak klucza GEMINI_API_KEY." };
  const role = await supabase.from("my_trips").select("role").eq("id", tripId).maybeSingle();
  if (role.data?.role !== "owner" && role.data?.role !== "editor") return { error: "Szukać atrakcji może organizator albo edytor wyjazdu." };
  const pulled = await pullTrip(supabase, tripId);
  if (pulled.error !== undefined) return { error: pulled.error };
  const state = stateFromPayload(pulled.payload);
  const doc = state.doc;
  const day = doc.days.find((each) => each.ref === dayRef);
  if (day === undefined) return { error: "Tego dnia już nie ma — odśwież stronę." };

  const options = { activeVariants: { ...state.inputs.activeVariants, ...(await chosenVariantsFromCookie(tripId)) } };
  let refs: string[];
  try {
    refs = scheduleDay(doc, dayRef, options).items.map((item) => item.ref);
  } catch (e) {
    return { error: `Nie udało się policzyć dnia: ${e instanceof Error ? e.message : String(e)}` };
  }
  const corridor = dayCorridor(doc, refs, dayLodging(doc, dayRef)?.placeRef);
  if (corridor.spots.length === 0 && corridor.paths.length === 0) return { error: "Żaden punkt tego dnia nie ma miejsca na mapie — najpierw uzupełnij współrzędne." };
  if (request.scope === "route" && !corridor.paths.some((path) => path.mode === "car")) {
    return { error: "Ten dzień nie ma przejazdu autem z trasą po drogach — „Przelicz trasę” przy przejeździe albo szukaj w całym dniu." };
  }

  let features: OsmFeature[];
  try {
    features = await fetchDayAttractions(corridor, { url: process.env.OVERPASS_URL || OVERPASS_URL, request });
  } catch (e) {
    return { error: `Nie pobrano z OpenStreetMap: ${e instanceof Error ? e.message : String(e)}` };
  }
  const towns = corridorTowns(corridor, features);
  if (request.scope === "city" && towns.length === 0) return { error: `Nie znalazłem w OpenStreetMap miasta „${request.city}” w okolicy trasy tego dnia (do 60 km). Sprawdź pisownię.` };
  // Szukanie zawężone dopisuje do listy: wcześniejsze otwarte zostają i nie wracają jako kandydaci.
  const merge = request.scope !== "day" || request.hint !== undefined;
  const skip = new Set((day.extras?.items ?? []).filter((each) => merge || each.status !== undefined).map((each) => each.id));
  const candidates = extraCandidates(doc, corridor, features, skip, { towns, scope: request.scope });
  if (candidates.length === 0) {
    return { ok: request.scope === "city" ? `W OpenStreetMap nie ma atrakcji spoza planu w mieście „${request.city}”.` : "W pobliżu trasy i punktów tego dnia nie ma w OpenStreetMap atrakcji spoza planu." };
  }

  let picks;
  try {
    picks = await pickDayExtras(doc, dayRef, options, candidates, { client: gemini.client, towns, request });
  } catch (e) {
    return { error: `AI nie wybrało atrakcji: ${e instanceof Error ? e.message : String(e)}` };
  }
  const before = new Set((day.extras?.items ?? []).map((each) => each.id));
  const next = applyExtraPicks(doc, dayRef, candidates, picks, localToday(), merge);
  if (next === null) return { error: "Tego dnia już nie ma — odśwież stronę." };
  const nextDoc = { ...doc, days: doc.days.map((each) => (each.ref === dayRef ? next : each)) };
  const checked = TripDocument.safeParse(nextDoc);
  if (!checked.success) return { error: validationError(checked.error) };
  try {
    await saveElements(supabase, tripId, checked.data, [{ collection: "days", element: checked.data.days.find((each) => each.ref === dayRef)!, op: "update" }], refIndex(pulled.payload.tables));
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  refresh();
  const found = next.extras!.items.filter((each) => each.status === undefined && (!merge || !before.has(each.id))).length;
  if (found === 0) return { ok: merge ? "AI nie znalazło niczego nowego do dopisania." : "AI nie znalazło niczego wartego dorzucenia do tego dnia." };
  const where = request.scope === "city" ? ` w mieście ${request.city}` : request.scope === "route" ? " na trasie przejazdu" : " po drodze i w pobliżu";
  return { ok: `${merge ? "Dopisano" : "Znaleziono"} ${plural(found, ["atrakcję", "atrakcje", "atrakcji"])}${where}.` };
}
