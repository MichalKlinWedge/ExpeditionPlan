"use server";

import { dbErrorMessage } from "@expeditionplan/sync";
import { refresh } from "next/cache";
import { z } from "zod";

import type { FormState } from "@/app/actions";
import { requireUser } from "@/lib/auth";

/**
 * Pamięć miejsc (strona „Wszystkie miejsca”): ocena „warto / nie warto” i notatka na przyszłość, po jednym wpisie
 * na osobę i miejsce. Każdy uczestnik pisze za siebie; RPC `set_place_memory` sprawdza, że miejsce jest w jego
 * wyjeździe, i łączy wpis z tym samym miejscem z innych wyjazdów. Pusta ocena i notatka usuwa wpis.
 */

const Input = z.object({
  placeId: z.uuid(),
  verdict: z.enum(["worth", "not_worth"]).nullable(),
  note: z.string().max(1000, "Notatka może mieć najwyżej 1000 znaków."),
});

export async function savePlaceMemory(placeId: string, verdict: "worth" | "not_worth" | null, note: string): Promise<FormState> {
  const parsed = Input.safeParse({ placeId, verdict, note });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Niepoprawny wpis." };
  const { supabase } = await requireUser("/places");
  const { error } = await supabase.rpc("set_place_memory", { p_place: parsed.data.placeId, p_verdict: parsed.data.verdict as string, p_note: parsed.data.note });
  if (error) return { error: dbErrorMessage(error, "Nie zapisano. Spróbuj jeszcze raz.") };
  refresh();
  return { ok: "Zapisano." };
}
