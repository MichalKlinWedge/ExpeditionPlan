"use server";

import { Currency, IsoDate, TimeZone, TripDocument } from "@expeditionplan/core";
import { importTrip, uuidv7 } from "@expeditionplan/sync";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

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

export async function createInvite(tripId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const role = form.get("role") === "editor" ? "editor" : "viewer";
  const maxUses = Math.min(Math.max(Number(form.get("maxUses") ?? 1) || 1, 1), 50);
  const { supabase } = await requireUser(`/trips/${tripId}`);
  const { data, error } = await supabase.rpc("create_invite", { p_trip: tripId, p_role: role, p_days: 14, p_max_uses: maxUses });
  if (error) return { error: message(error) };
  return { token: data };
}

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

export async function acceptInvite(token: string): Promise<FormState> {
  const { supabase } = await requireUser(`/join/${token}`);
  const { data, error } = await supabase.rpc("accept_invite", { p_token: token });
  if (error) return { error: error.code === "P0002" ? "Zaproszenie wygasło, zostało wykorzystane albo jest nieprawidłowe." : message(error) };
  redirect(`/trips/${data}`);
}
