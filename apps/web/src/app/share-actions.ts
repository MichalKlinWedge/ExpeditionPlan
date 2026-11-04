"use server";

import { createHash } from "node:crypto";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";

import type { FormState } from "@/app/actions";
import { requireUser } from "@/lib/auth";
import { travelerInviteMessage } from "@/lib/invite-message";
import { tripDates } from "@/lib/labels";
import { mailConfigured, sendMail } from "@/lib/mail";

/**
 * Publiczny link „tylko do podglądu” (`/p/<token>`): tworzy go i wyłącza właściciel. Nowy link
 * unieważnia poprzedni. Co ukryć — w `hide` (filtruje baza w `public_trip`).
 */

export type ShareState = FormState & { token?: string };

export async function createShare(tripId: string, _prev: ShareState, form: FormData): Promise<ShareState> {
  const { supabase } = await requireUser(`/trips/${tripId}`);
  const hide = { costs: form.get("costs") === "on", names: form.get("names") === "on", lodgingAddress: form.get("lodgingAddress") === "on", vault: true };
  const { data, error } = await supabase.rpc("create_public_share", { p_trip: tripId, p_hide: hide });
  if (error) return { error: error.code === "42501" ? "Publiczny link tworzy tylko właściciel wyjazdu." : error.message };
  refresh();
  return { ok: "Link gotowy — skopiuj go teraz, później już się nie pokaże.", token: data as string };
}

export async function disableShare(tripId: string): Promise<FormState> {
  const { supabase } = await requireUser(`/trips/${tripId}`);
  const { error } = await supabase.rpc("disable_public_share", { p_trip: tripId });
  if (error) return { error: error.message };
  refresh();
  return { ok: "Link wyłączony — nikt już z niego nie otworzy planu." };
}

/**
 * Przypisanie konta do uczestnika planu (`travelers.user_id`) albo odpięcie (`userId = null`) —
 * organizator, przez `link_traveler_account` (jedno konto = jeden uczestnik).
 */
export async function linkTravelerAccount(tripId: string, travelerId: string, userId: string | null): Promise<FormState> {
  if (travelerId === "") return {};
  const { supabase } = await requireUser(`/trips/${tripId}/people`);
  const { error } = await supabase.rpc("link_traveler_account", { p_trip: tripId, p_traveler: travelerId, p_user: userId as string });
  if (error) return { error: error.code === "42501" ? "Konto do uczestnika przypisuje organizator." : error.message };
  refresh();
  return { ok: "Zapisano." };
}

/**
 * Uprawnienia członka wyjazdu (organizator): widz ↔ edytor i „dodaje wydatki” dla widza. Organizatora
 * nie da się tu zmienić ani nikogo nim zrobić; o prawie decyduje RLS `members_update`.
 */
export async function setMemberAccess(tripId: string, userId: string, role: "editor" | "viewer", canAddExpenses: boolean): Promise<FormState> {
  if (role !== "editor" && role !== "viewer") return { error: "Nieznana rola." };
  const { supabase } = await requireUser(`/trips/${tripId}/people`);
  const { data, error } = await supabase
    .from("trip_members")
    .update({ role, can_add_expenses: role === "editor" || canAddExpenses })
    .eq("trip_id", tripId)
    .eq("user_id", userId)
    .neq("role", "owner")
    .select("user_id");
  if (error) return { error: error.message };
  if ((data ?? []).length === 0) return { error: "Tego dostępu nie możesz zmienić (zmienia organizator; jego roli się nie zmienia)." };
  refresh();
  return { ok: "Zapisano." };
}

/** Odebranie dostępu do wyjazdu (organizator; organizatora nie da się usunąć — RLS `members_delete`). */
export async function removeMember(tripId: string, userId: string): Promise<FormState> {
  const { supabase } = await requireUser(`/trips/${tripId}/people`);
  const { data, error } = await supabase.from("trip_members").delete().eq("trip_id", tripId).eq("user_id", userId).neq("role", "owner").select("user_id");
  if (error) return { error: error.message };
  if ((data ?? []).length === 0) return { error: "Tego dostępu nie możesz odebrać." };
  refresh();
  return { ok: "Dostęp odebrany." };
}

export type TravelerInviteState = FormState & { token?: string; apkUrl?: string; canEmail?: boolean };

/**
 * Zaproszenie dla jednej osoby z planu (jednorazowe, 14 dni): po dołączeniu konto samo zostaje
 * przypisane do tego uczestnika. Link do APK dla znajomych z `FRIENDS_APK_URL` (adres strony EAS, nie sekret).
 */
export async function inviteTraveler(tripId: string, travelerId: string, role: "editor" | "viewer"): Promise<TravelerInviteState> {
  const { supabase } = await requireUser(`/trips/${tripId}/people`);
  const { data, error } = await supabase.rpc("create_invite", { p_trip: tripId, p_role: role === "editor" ? "editor" : "viewer", p_days: 14, p_max_uses: 1, p_traveler: travelerId });
  if (error) return { error: error.code === "42501" ? "Zaprasza tylko organizator." : error.message };
  refresh();
  const apkUrl = process.env.FRIENDS_APK_URL;
  return { token: data, canEmail: mailConfigured(), ...(apkUrl ? { apkUrl } : {}) };
}

/**
 * Wysyła gotowe zaproszenie e-mailem (SMTP z `lib/mail.ts`). Token musi pasować do zaproszenia tej
 * osoby, a RLS pokazuje zaproszenia tylko organizatorowi, więc nikt inny nie wyśle nic z serwisu.
 * Treść składa serwer z danych planu; odpowiedź na wiadomość trafia do organizatora.
 */
export async function emailTravelerInvite(tripId: string, travelerId: string, token: string, to: string): Promise<FormState> {
  const address = z.email().max(254).safeParse(to.trim());
  if (!address.success) return { error: "Podaj poprawny adres e-mail." };
  if (!mailConfigured()) return { error: "Wysyłka e-maili nie jest skonfigurowana." };
  const { supabase, email } = await requireUser(`/trips/${tripId}/people`);
  const invite = await supabase
    .from("trip_invites")
    .select("id")
    .eq("trip_id", tripId)
    .eq("traveler_id", travelerId)
    .eq("token_hash", createHash("sha256").update(token, "utf8").digest("hex"))
    .is("revoked_at", null)
    .maybeSingle();
  if (invite.data === null) return { error: "Tego zaproszenia już nie ma — utwórz nowe." };
  const [trip, traveler, requestHeaders] = await Promise.all([
    supabase.from("trips").select("title, start_date, end_date").eq("id", tripId).single(),
    supabase.from("travelers").select("name").eq("id", travelerId).single(),
    headers(),
  ]);
  if (trip.data === null || traveler.data === null) return { error: "Nie ma takiego wyjazdu albo osoby." };
  const dates = trip.data.start_date && trip.data.end_date ? tripDates(trip.data.start_date, trip.data.end_date) : "termin do ustalenia";
  try {
    await sendMail({
      to: address.data,
      subject: `Zaproszenie na wyjazd „${trip.data.title}”`,
      text: travelerInviteMessage({
        name: traveler.data.name,
        tripTitle: trip.data.title,
        dates,
        // Akcje serwera przyjmują tylko żądania z tego samego adresu co strona.
        origin: requestHeaders.get("origin") ?? "",
        token,
        apkUrl: process.env.FRIENDS_APK_URL,
      }),
      ...(email ? { replyTo: email } : {}),
    });
  } catch (e) {
    console.error("Wysyłka zaproszenia", e);
    return { error: "Nie udało się wysłać wiadomości. Skopiuj ją i wyślij sam." };
  }
  return { ok: `Wysłano na ${address.data}.` };
}
