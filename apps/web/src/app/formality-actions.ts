"use server";

import { FORMALITIES, type FormalityKey, formalityTasks, TripDocument } from "@expeditionplan/core";
import { refIndex, saveElements, stateFromPayload, uuidv7 } from "@expeditionplan/sync";
import { refresh } from "next/cache";

import type { FormState } from "@/app/actions";
import { requireUser } from "@/lib/auth";
import { pullTrip, validationError } from "@/lib/trip-snapshot";

/** Zadania formalności (EKUZ, ubezpieczenie, prawo jazdy, Odyseusz) do listy zadań wyjazdu; już dodanych nie powtarza. */
export async function addFormalityTasks(tripId: string, keys: string[]): Promise<FormState> {
  const wanted = keys.filter((key): key is FormalityKey => FORMALITIES.some((each) => each.key === key));
  if (wanted.length === 0) return { error: "Zaznacz co najmniej jedną formalność." };
  const { supabase } = await requireUser(`/trips/${tripId}/people`);
  const pulled = await pullTrip(supabase, tripId);
  if (pulled.error !== undefined) return { error: pulled.error };
  const { doc } = stateFromPayload(pulled.payload);
  const tasks = formalityTasks(doc, wanted, () => `id-${uuidv7()}`);
  if (tasks.length === 0) return { ok: "Te zadania już są na liście." };
  const checked = TripDocument.safeParse({ ...doc, tasks: [...doc.tasks, ...tasks] });
  if (!checked.success) return { error: validationError(checked.error) };
  try {
    await saveElements(supabase, tripId, checked.data, tasks.map((element) => ({ collection: "tasks" as const, element, op: "insert" as const })), refIndex(pulled.payload.tables));
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  refresh();
  return { ok: tasks.length === 1 ? "Dodano zadanie." : `Dodano zadania: ${tasks.length}.` };
}
