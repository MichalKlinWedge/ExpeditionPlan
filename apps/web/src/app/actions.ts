"use server";

import { Currency, IsoDate, parseCoordinates, TimeZone, TripBrief, TripDocument } from "@expeditionplan/core";
import type { Json } from "@expeditionplan/db";
import { countryOfTz, geoapifyLookup, groundPlaces, planTrip, routeLegs, withCoordinates } from "@expeditionplan/planner";
import { COLLECTIONS, importTrip, refIndex, rowForUpdate, saveMergeEdit, stateFromPayload, uuidv7 } from "@expeditionplan/sync";
import type { SupabaseClient } from "@supabase/supabase-js";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { plannerDeps, routeLookup } from "@/lib/ai";
import { requireUser } from "@/lib/auth";
import { SAMPLE_PLANS } from "@/lib/sample-plans";

/**
 * Akcje serwera MVP-1. Każda sprawdza zalogowanie sama (akcje omijają matcher proxy), a o prawie
 * do zapisu decyduje RLS — błąd z bazy wraca do formularza jako komunikat.
 */

export type FormState = { error?: string; ok?: string; token?: string };

const message = (error: { message: string; code?: string }) =>
  error.code === "42501" ? "Brak uprawnień do tej zmiany." : error.message;

export async function signOut() {
  const { supabase } = await requireUser();
  await supabase.auth.signOut();
  redirect("/login");
}

const NewTrip = z
  .object({
    title: z.string().trim().min(1, "Podaj nazwę wyjazdu."),
    startDate: IsoDate,
    endDate: IsoDate,
    primaryTz: TimeZone,
    baseCurrency: Currency,
  })
  .refine((trip) => trip.endDate >= trip.startDate, { message: "Koniec przed początkiem.", path: ["endDate"] });

export async function createTrip(_prev: FormState, form: FormData): Promise<FormState> {
  const parsed = NewTrip.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase } = await requireUser("/trips/new");
  const id = uuidv7();
  const { error } = await supabase.from("trips").insert({
    id,
    title: parsed.data.title,
    start_date: parsed.data.startDate,
    end_date: parsed.data.endDate,
    primary_tz: parsed.data.primaryTz,
    base_currency: parsed.data.baseCurrency,
  });
  if (error) return { error: message(error) };
  redirect(`/trips/${id}`);
}

const NewTraveler = z.object({
  name: z.string().trim().min(1, "Podaj imię."),
  nickname: z.string().trim().optional(),
  age: z.preprocess((value) => (value === "" ? undefined : Number(value)), z.number().int().min(0).max(120).optional()),
  household: z.string().trim().optional(),
  guardianId: z.string().uuid().or(z.literal("")).optional(),
  isDriver: z.literal("on").optional(),
});

export async function addTraveler(tripId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const parsed = NewTraveler.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase } = await requireUser(`/trips/${tripId}`);
  const { count } = await supabase.from("travelers").select("id", { count: "exact", head: true }).eq("trip_id", tripId);
  const { error } = await supabase.from("travelers").insert({
    id: uuidv7(),
    trip_id: tripId,
    name: parsed.data.name,
    nickname: parsed.data.nickname || null,
    age: parsed.data.age ?? null,
    household: parsed.data.household || null,
    guardian_id: parsed.data.guardianId || null,
    is_driver: parsed.data.isDriver === "on",
    // Na koniec listy; klucz porównywany jak tekst, tak jak w imporcie dokumentu.
    sort_key: String(count ?? 0).padStart(5, "0"),
  });
  if (error) return { error: message(error) };
  refresh();
  return { ok: `Dodano: ${parsed.data.name}` };
}

/** Zmiana danych uczestnika (imię, wiek, rodzina, opiekun, kierowca). O prawie decyduje RLS. */
export async function updateTraveler(tripId: string, travelerId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const parsed = NewTraveler.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  if (parsed.data.guardianId === travelerId) return { error: "Uczestnik nie może być swoim opiekunem." };
  const { supabase } = await requireUser(`/trips/${tripId}`);
  const { data, error } = await supabase
    .from("travelers")
    .update({
      name: parsed.data.name,
      nickname: parsed.data.nickname || null,
      age: parsed.data.age ?? null,
      household: parsed.data.household || null,
      guardian_id: parsed.data.guardianId || null,
      is_driver: parsed.data.isDriver === "on",
    })
    .eq("id", travelerId)
    .eq("trip_id", tripId)
    .select("id");
  if (error) return { error: message(error) };
  // RLS odrzuca UPDATE bez błędu (0 wierszy) — widz nie edytuje.
  if (data.length === 0) return { error: "Brak uprawnień do tej zmiany." };
  refresh();
  return { ok: `Zapisano: ${parsed.data.name}` };
}

/**
 * Usunięcie uczestnika (miękkie, `deleted_at`). Zablokowane, gdy coś na niego wskazuje — inaczej
 * plan, wydatki czy pakowanie odwoływałyby się do nikogo. Komunikat mówi, co najpierw zmienić.
 */
export async function removeTraveler(tripId: string, travelerId: string): Promise<FormState> {
  const { supabase } = await requireUser(`/trips/${tripId}`);
  // Tabele po nazwie z listy — bez typów wygenerowanych dla każdej z osobna.
  const db = supabase as unknown as SupabaseClient;
  type Counted = PromiseLike<{ count: number | null; error: { message: string } | null }> & {
    eq(column: string, value: unknown): Counted;
    contains(column: string, value: unknown[]): Counted;
    or(filters: string): Counted;
  };
  const count = async (table: string, filter: (query: Counted) => Counted) => {
    const query = db.from(table).select("id", { count: "exact", head: true }).eq("trip_id", tripId).is("deleted_at", null) as unknown as Counted;
    const { count: found, error } = await filter(query);
    if (error) throw new Error(error.message);
    return found ?? 0;
  };
  const { data: person, error } = await supabase.from("travelers").select("name, user_id").eq("id", travelerId).eq("trip_id", tripId).maybeSingle();
  if (error) return { error: message(error) };
  if (person === null) return { error: "Nie ma takiego uczestnika." };
  if (person.user_id !== null) return { error: `${person.name} jest połączony z kontem członka wyjazdu — tego uczestnika nie usuwamy.` };
  let uses: string[];
  try {
    const checks: [string, number][] = [
      ["opiekun innego uczestnika", await count("travelers", (q) => q.eq("guardian_id", travelerId))],
      ["punkty planu (uczestnicy punktu)", await count("items", (q) => q.contains("participant_ids", [travelerId]))],
      ["wydatki (płacący)", await count("expenses", (q) => q.eq("payer_traveler_id", travelerId))],
      ["podziały wydatków", await count("expense_splits", (q) => q.eq("traveler_id", travelerId))],
      ["rozliczenia", await count("settlements", (q) => q.or(`from_traveler_id.eq.${travelerId},to_traveler_id.eq.${travelerId}`))],
      ["zadania", await count("tasks", (q) => q.contains("assignee_ids", [travelerId]))],
      ["lista pakowania", await count("packing_items", (q) => q.eq("assignee_traveler_id", travelerId))],
      ["odhaczenia pakowania", await count("packing_checks", (q) => q.eq("traveler_id", travelerId).eq("packed", true))],
      ["rezerwacje (płacący)", await count("bookings", (q) => q.eq("paid_by_traveler_id", travelerId))],
      ["auto (kierowca)", await count("vehicles", (q) => q.eq("driver_traveler_id", travelerId))],
    ];
    uses = checks.filter(([, found]) => found > 0).map(([what, found]) => `${what}: ${found}`);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  if (uses.length > 0) return { error: `Nie usunięto „${person.name}” — jest powiązany z: ${uses.join(", ")}. Zmień to najpierw.` };
  const { data, error: removeError } = await supabase.from("travelers").update({ deleted_at: new Date().toISOString() }).eq("id", travelerId).select("id");
  if (removeError) return { error: message(removeError) };
  if (data.length === 0) return { error: "Brak uprawnień do tej zmiany." };
  refresh();
  return { ok: `Usunięto: ${person.name}` };
}

export async function createInvite(tripId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const role = form.get("role") === "editor" ? "editor" : "viewer";
  const maxUses = Math.min(Math.max(Number(form.get("maxUses") ?? 1) || 1, 1), 50);
  const { supabase } = await requireUser(`/trips/${tripId}`);
  const { data, error } = await supabase.rpc("create_invite", { p_trip: tripId, p_role: role, p_days: 14, p_max_uses: maxUses });
  if (error) return { error: message(error) };
  return { token: data };
}

/**
 * Brief wyjazdu z kreatora (SPECYFIKACJA M2). Daty i uczestnicy pochodzą z wyjazdu — kreator ich
 * nie dubluje — a całość przechodzi przez `TripBrief` z packages/core, ten sam, który dostanie AI.
 */
export async function saveBrief(tripId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const { supabase } = await requireUser(`/trips/${tripId}/brief`);
  const [trip, travelers, existing] = await Promise.all([
    supabase.from("trips").select("title, start_date, end_date, home_tz, base_currency").eq("id", tripId).single(),
    supabase.from("travelers").select("name, nickname, age, household, is_driver, notes").eq("trip_id", tripId).is("deleted_at", null).order("sort_key"),
    supabase.from("trip_brief").select("id").eq("trip_id", tripId).maybeSingle(),
  ]);
  if (trip.error) return { error: message(trip.error) };
  let draft: Record<string, unknown>;
  try {
    draft = JSON.parse(String(form.get("brief") ?? "{}"));
  } catch {
    return { error: "Nie udało się odczytać formularza." };
  }
  const people = travelers.data ?? [];
  const parsed = TripBrief.safeParse({
    ...draft,
    title: trip.data.title,
    dates: { kind: "fixed", start: trip.data.start_date, end: trip.data.end_date },
    homeTz: trip.data.home_tz,
    travelers: people.map((person) => ({
      name: person.name,
      nickname: person.nickname ?? undefined,
      age: person.age ?? undefined,
      household: person.household ?? undefined,
      isDriver: person.is_driver ?? undefined,
      notes: person.notes ?? undefined,
    })),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    if (issue.path[0] === "travelers") return { error: "Dodaj najpierw uczestników wyjazdu (na stronie wyjazdu)." };
    return { error: `${BRIEF_FIELDS[String(issue.path[0])] ?? issue.path.join(".")}: ${issue.message}` };
  }
  const row = { trip_id: tripId, brief: parsed.data as unknown as NonNullable<Json> };
  const { error } = existing.data
    ? await supabase.from("trip_brief").update(row).eq("id", existing.data.id)
    : await supabase.from("trip_brief").insert({ id: uuidv7(), ...row });
  if (error) return { error: message(error) };
  refresh();
  return { ok: "Zapisano brief wyjazdu." };
}

/** Nazwy pól briefu w komunikatach walidacji. */
const BRIEF_FIELDS: Record<string, string> = {
  goal: "Cel wyjazdu",
  location: "Miejsce",
  profiles: "Charakter wyjazdu",
  transport: "Transport",
  budget: "Budżet",
  constraints: "Ograniczenia",
  fixed: "Już ustalone",
};

/** Pięć planów wzorcowych na moje konto; pomija te, które już mam (po tytule). */
export async function importSamples(): Promise<FormState> {
  const { supabase } = await requireUser("/");
  const { data: mine, error } = await supabase.from("my_trips").select("title").eq("role", "owner");
  if (error) return { error: message(error) };
  const titles = new Set(mine.map((trip) => trip.title));
  const added: string[] = [];
  for (const plan of SAMPLE_PLANS) {
    const doc = TripDocument.parse(plan);
    if (titles.has(doc.trip.title)) continue;
    try {
      await importTrip(supabase, doc);
      added.push(doc.trip.title);
    } catch (e) {
      return { error: `${doc.trip.title}: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
  refresh();
  return { ok: added.length === 0 ? "Wszystkie przykładowe wyjazdy już są na liście." : `Dodano: ${added.join(", ")}.` };
}

/** Plik JSON z „Pobierz JSON” (albo inny `TripDocument`) jako NOWY wyjazd na moim koncie. */
export async function importTripFile(_prev: FormState, form: FormData): Promise<FormState> {
  const { supabase } = await requireUser("/trips/new");
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Wybierz plik JSON." };
  if (file.size > 1_000_000) return { error: "Plik jest za duży (najwyżej 1 MB — limit akcji serwera)." };
  let raw: unknown;
  try {
    raw = JSON.parse(await file.text());
  } catch {
    return { error: "To nie jest poprawny plik JSON." };
  }
  const parsed = TripDocument.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { error: `Plik nie jest planem wyjazdu: ${issue?.path.join(".") ?? ""} ${issue?.message ?? ""}`.trim() };
  }
  let tripId: string;
  try {
    tripId = (await importTrip(supabase, parsed.data)).tripId;
  } catch (e) {
    return { error: `Nie zapisano: ${e instanceof Error ? e.message : String(e)}` };
  }
  redirect(`/trips/${tripId}`);
}

export async function acceptInvite(token: string): Promise<FormState> {
  const { supabase } = await requireUser(`/join/${token}`);
  const { data, error } = await supabase.rpc("accept_invite", { p_token: token });
  if (error) return { error: error.code === "P0002" ? "Zaproszenie wygasło, zostało wykorzystane albo jest nieprawidłowe." : message(error) };
  redirect(`/trips/${data}`);
}

/**
 * Właściciel usuwa wyjazd (miękko — znika u wszystkich, także z telefonów), edytor i widz
 * z niego wychodzą. O roli decyduje baza (`delete_trip` / `leave_trip`), tu tylko wybór RPC.
 */
export async function removeTrip(tripId: string): Promise<FormState> {
  const { supabase } = await requireUser(`/trips/${tripId}`);
  const { data: trip } = await supabase.from("my_trips").select("role").eq("id", tripId).maybeSingle();
  if (trip === null) return { error: "Nie ma takiego wyjazdu albo nie masz do niego dostępu." };
  const { error } = await supabase.rpc(trip.role === "owner" ? "delete_trip" : "leave_trip", { p_trip: tripId });
  if (error) return { error: error.message };
  redirect("/");
}

/**
 * „Zaplanuj z AI” (MVP-2): brief tego wyjazdu → łańcuch z packages/planner (Gemini + Geoapify)
 * → NOWY wyjazd „Szkic AI: …” zapisany jedną transakcją (`import_trip`). AI daje szkic, nie
 * nadpisuje planu (SPECYFIKACJA §4) — porównanie i przenoszenie punktów robi człowiek.
 * Trwa zwykle 30–90 s; `maxDuration` ustawia strona briefu.
 */
export async function planWithAi(tripId: string): Promise<FormState & { tripId?: string }> {
  const { supabase } = await requireUser(`/trips/${tripId}/brief`);
  const [trip, brief] = await Promise.all([
    supabase.from("my_trips").select("title, role, primary_tz").eq("id", tripId).maybeSingle(),
    supabase.from("trip_brief").select("brief").eq("trip_id", tripId).maybeSingle(),
  ]);
  if (trip.error || brief.error) return { error: message((trip.error ?? brief.error)!) };
  if (trip.data === null) return { error: "Nie ma takiego wyjazdu." };
  if (trip.data.role !== "owner" && trip.data.role !== "editor") return { error: "Planować z AI może organizator albo edytor." };
  if (brief.data === null) return { error: "Najpierw uzupełnij brief wyjazdu." };
  const parsed = TripBrief.safeParse(brief.data.brief);
  if (!parsed.success) return { error: `Brief nie przechodzi walidacji: ${parsed.error.issues[0]?.message ?? ""}` };

  const setup = plannerDeps();
  if ("missing" in setup) return { error: `Serwer nie ma kluczy: ${setup.missing.join(", ")}.` };

  const usage = { inputTokens: 0, outputTokens: 0 };
  const started = Date.now();
  let planned: Awaited<ReturnType<typeof planTrip>>;
  try {
    planned = await planTrip(parsed.data, {
      ...setup.deps,
      primaryTz: trip.data.primary_tz ?? undefined,
      onUsage: (each) => {
        usage.inputTokens += each.inputTokens;
        usage.outputTokens += each.outputTokens;
      },
    });
  } catch (e) {
    return { error: `AI nie ułożyło planu: ${e instanceof Error ? e.message : String(e)}` };
  }

  const doc = TripDocument.parse({ ...planned.doc, trip: { ...planned.doc.trip, title: `Szkic AI: ${trip.data.title}` } });
  let newTripId: string;
  try {
    newTripId = (await importTrip(supabase, doc)).tripId;
  } catch (e) {
    return { error: `Nie zapisano szkicu: ${e instanceof Error ? e.message : String(e)}` };
  }
  // Ślad wywołania (audyt kosztów); jego brak nie unieważnia szkicu.
  await supabase.from("ai_runs").insert({
    id: uuidv7(),
    trip_id: newTripId,
    stage: "plan",
    provider: "GEMINI",
    model: setup.model,
    input: { sourceTripId: tripId } as Json,
    status: "ok",
    tokens_in: usage.inputTokens,
    tokens_out: usage.outputTokens,
    duration_ms: Date.now() - started,
  });
  return { ok: `Szkic gotowy: ${doc.days.length} dni, ${doc.items.length} punktów.`, tripId: newTripId };
}

/**
 * „Przelicz przejazdy”: czasy i dystanse przejazdów autem, pieszo i rowerem z OpenRouteService
 * zamiast szacunków (z AI albo z dokumentu). Punkty zmienione ręcznie (`user_locked`) zostają.
 * Do 60 tras na raz, 1,6 s na trasę (limit ORS 40/min) — `maxDuration` ustawia strona planu.
 */
export async function routeTrip(tripId: string): Promise<FormState> {
  const { supabase } = await requireUser(`/trips/${tripId}/plan`);
  const route = routeLookup();
  if (route === null) return { error: "Serwer nie ma klucza OPENROUTESERVICE_API_KEY." };
  const [{ data, error }, membership] = await Promise.all([
    supabase.rpc("pull_changes", { p_trip: tripId, p_since: 0 }),
    supabase.from("my_trips").select("role").eq("id", tripId).maybeSingle(),
  ]);
  if (error) return { error: message(error) };
  if (data === null) return { error: "Nie ma takiego wyjazdu." };
  if (membership.data?.role !== "owner" && membership.data?.role !== "editor") return { error: "Przeliczać może organizator albo edytor." };
  const payload = data as Parameters<typeof stateFromPayload>[0];
  const { doc } = stateFromPayload(payload);
  const rows = (payload.tables.items ?? []) as unknown as { id: string; ref: string | null; user_locked?: boolean; deleted_at: string | null }[];
  const locked = new Set(rows.filter((row) => row.user_locked && row.deleted_at === null).map((row) => row.ref ?? `id-${row.id}`));
  const refs = new Set(doc.items.filter((item) => item.kind === "transport" && !locked.has(item.ref)).map((item) => item.ref));

  const { doc: routed, results } = await routeLegs(doc, route, refs);
  const done = new Set(results.filter((result) => result.status === "routed").map((result) => result.ref));
  const changed = routed.items.filter((item) => done.has(item.ref));
  if (changed.length > 0) {
    try {
      await saveMergeEdit(supabase, tripId, { doc: TripDocument.parse(routed), created: [], changed, others: [], removed: [], kept: [], copied: {} }, refIndex(payload.tables));
    } catch (e) {
      return { error: `Nie zapisano tras: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
  const count = (status: string) => results.filter((result) => result.status === status).length;
  // Największe różnice wobec szacunku — żeby było widać, co się zmieniło.
  const diffs = results
    .filter((result) => result.status === "routed" && result.before?.durationMin !== undefined)
    .map((result) => ({ title: result.title, from: result.before!.durationMin!, to: result.after!.durationMin }))
    .sort((a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from))
    .slice(0, 3)
    .filter((each) => each.from !== each.to)
    .map((each) => `„${each.title}” ${each.from} → ${each.to} min`);
  const skipped = [
    count("no_coordinates") > 0 ? `${count("no_coordinates")} bez współrzędnych` : null,
    count("not_found") > 0 ? `${count("not_found")} bez trasy w OSM` : null,
    count("failed") > 0 ? `${count("failed")} z błędem usługi` : null,
    count("skipped_limit") > 0 ? `${count("skipped_limit")} ponad limit na raz` : null,
    locked.size > 0 && doc.items.some((item) => item.kind === "transport" && locked.has(item.ref)) ? "zmienione ręcznie pominięte" : null,
  ].filter((each) => each !== null);
  return {
    ok: `Przeliczono ${changed.length} przejazdów.${diffs.length > 0 ? ` Największe zmiany: ${diffs.join("; ")}.` : ""}${skipped.length > 0 ? ` Pominięte: ${skipped.join(", ")}.` : ""}`,
  };
}

/**
 * „Uzupełnij współrzędne miejsc”: miejsca planu bez współrzędnych szukane w Geoapify (dane OSM)
 * tą samą logiką co w „Zaplanuj z AI” — kraj z briefu albo ze strefy wyjazdu, trafienia daleko
 * od reszty planu odrzucone. Pinezek (`provider: user`) i miejsc ze współrzędnymi nie rusza.
 * Bez współrzędnych nie ma tras (ORS), słońca dla bazy ani punktów na mapie w telefonie.
 */
export async function groundTrip(tripId: string): Promise<FormState> {
  const { supabase } = await requireUser(`/trips/${tripId}/plan`);
  const key = process.env.GEOAPIFY_API_KEY ?? "";
  if (key === "") return { error: "Serwer nie ma klucza GEOAPIFY_API_KEY." };
  const [{ data, error }, membership, briefRow] = await Promise.all([
    supabase.rpc("pull_changes", { p_trip: tripId, p_since: 0 }),
    supabase.from("my_trips").select("role").eq("id", tripId).maybeSingle(),
    supabase.from("trip_brief").select("brief").eq("trip_id", tripId).maybeSingle(),
  ]);
  if (error) return { error: message(error) };
  if (data === null) return { error: "Nie ma takiego wyjazdu." };
  if (membership.data?.role !== "owner" && membership.data?.role !== "editor") return { error: "Uzupełniać może organizator albo edytor." };
  const payload = data as Parameters<typeof stateFromPayload>[0];
  const { doc } = stateFromPayload(payload);
  const brief = TripBrief.safeParse(briefRow.data?.brief);
  const countries = countriesFor(brief.success ? brief.data : null, doc.trip.primaryTz);
  if (countries.length === 0) return { error: `Nie wiem, w jakim kraju szukać (strefa ${doc.trip.primaryTz}) — podaj kraj w briefie wyjazdu.` };

  const missing = doc.places.filter((place) => place.lat === undefined && place.provider !== "user");
  if (missing.length === 0) return { ok: "Wszystkie miejsca mają już współrzędne." };
  const anchors = doc.places.flatMap((place) => (place.lat !== undefined && place.lng !== undefined ? [{ lat: place.lat, lng: place.lng }] : []));
  const results = await groundPlaces(
    missing.map((place) => ({ ref: place.ref, name: place.name, ...(place.searchName ? { searchName: place.searchName } : {}), ...(place.category ? { category: place.category } : {}) })),
    { countries, kind: brief.success ? brief.data.location.kind : "region", lookup: geoapifyLookup(key), anchors },
  );

  const ids = refIndex(payload.tables);
  const owner = new Map(COLLECTIONS.flatMap((collection) => (doc[collection] as { ref?: string }[]).flatMap((element) => (element.ref ? [[element.ref, collection] as const] : []))));
  const index = { idOf: (ref: string) => ids[ref]!, collectionOf: (ref: string) => owner.get(ref) };
  const filled: string[] = [];
  for (const result of results) {
    if (result.status !== "found") continue;
    const place = missing.find((each) => each.ref === result.ref)!;
    const next = withCoordinates(place, result.hit, { openingHours: true });
    const { error: saveError } = await supabase.from("places").update(rowForUpdate("places", next, index) as never).eq("id", index.idOf(place.ref));
    if (saveError) return { error: `Zapisano ${filled.length} miejsc, potem błąd: ${message(saveError)}` };
    filled.push(place.name);
  }
  const named = (status: string) => results.flatMap((result, i) => (result.status === status ? [missing[i]!.name] : []));
  const list = (names: string[]) => names.slice(0, 5).map((name) => `„${name}”`).join(", ") + (names.length > 5 ? ` i ${names.length - 5} innych` : "");
  const notFound = named("not_found");
  const rejected = named("rejected");
  const skipped = named("skipped");
  return {
    ok: [
      `Uzupełniono ${filled.length} z ${missing.length} miejsc.`,
      notFound.length > 0 ? `Nie znaleziono: ${list(notFound)}.` : "",
      rejected.length > 0 ? `Odrzucone (za daleko od reszty planu): ${list(rejected)}.` : "",
      skipped.length > 0 ? `Pominięte (opisowe albo prywatne): ${skipped.length}.` : "",
    ].filter((each) => each !== "").join(" "),
  };
}

/** Kraje wyjazdu do szukania miejsc: z briefu, a bez niego ze strefy wyjazdu. */
function countriesFor(brief: TripBrief | null, primaryTz: string): string[] {
  if (brief !== null) return brief.location.countries;
  const fromTz = countryOfTz(primaryTz);
  return fromTz === undefined ? [] : [fromTz];
}

/**
 * Ręczne przypięcie miejsca: wklejone współrzędne albo link z mapy (`parseCoordinates`). Miejsce
 * dostaje `provider: user` — „Uzupełnij współrzędne” już go nie ruszy. O prawie decyduje RLS.
 */
export async function pinPlace(tripId: string, placeId: string, text: string): Promise<FormState> {
  const point = parseCoordinates(text);
  if (point === null) return { error: "Nie widzę tu współrzędnych. Wklej np. „31.6295, -7.9811” albo pełny link z Google Maps lub OpenStreetMap (krótki link maps.app.goo.gl trzeba najpierw otworzyć)." };
  const { supabase } = await requireUser(`/trips/${tripId}/plan`);
  const { data, error } = await supabase
    .from("places")
    .update({ lat: Math.round(point.lat * 1e5) / 1e5, lng: Math.round(point.lng * 1e5) / 1e5, provider: "user" })
    .eq("id", placeId)
    .eq("trip_id", tripId)
    .select("name");
  if (error) return { error: message(error) };
  if (data.length === 0) return { error: "Brak uprawnień do tej zmiany." };
  refresh();
  return { ok: `Przypięto „${data[0]!.name}”: ${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}.` };
}

/** Szukanie miejsca pod inną nazwą (np. nazwą z OpenStreetMap); trafienie zapisuje się z tą nazwą jako `searchName`. */
export async function searchPlace(tripId: string, placeId: string, query: string): Promise<FormState> {
  const text = query.trim();
  if (text === "") return { error: "Wpisz nazwę do wyszukania." };
  const key = process.env.GEOAPIFY_API_KEY ?? "";
  if (key === "") return { error: "Serwer nie ma klucza GEOAPIFY_API_KEY." };
  const { supabase } = await requireUser(`/trips/${tripId}/plan`);
  const [trip, briefRow] = await Promise.all([
    supabase.from("my_trips").select("primary_tz").eq("id", tripId).maybeSingle(),
    supabase.from("trip_brief").select("brief").eq("trip_id", tripId).maybeSingle(),
  ]);
  const brief = TripBrief.safeParse(briefRow.data?.brief);
  const countries = countriesFor(brief.success ? brief.data : null, trip.data?.primary_tz ?? "");
  if (countries.length === 0) return { error: "Nie wiem, w jakim kraju szukać — podaj kraj w briefie wyjazdu." };
  let hit;
  try {
    hit = await geoapifyLookup(key)(text, countries);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  if (hit === null) return { error: `Nie znaleziono „${text}”. Spróbuj nazwy z OpenStreetMap albo wklej współrzędne.` };
  const { data, error } = await supabase
    .from("places")
    .update({ lat: Math.round(hit.lat * 1e5) / 1e5, lng: Math.round(hit.lng * 1e5) / 1e5, provider: "osm", search_name: text })
    .eq("id", placeId)
    .eq("trip_id", tripId)
    .select("name");
  if (error) return { error: message(error) };
  if (data.length === 0) return { error: "Brak uprawnień do tej zmiany." };
  refresh();
  return { ok: `„${data[0]!.name}” → ${hit.displayName}. Jeśli to nie to miejsce, wklej współrzędne.` };
}
