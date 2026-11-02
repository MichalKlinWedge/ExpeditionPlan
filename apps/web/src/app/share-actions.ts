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
