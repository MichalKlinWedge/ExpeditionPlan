"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/app/actions";
import { requireUser } from "@/lib/auth";

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
