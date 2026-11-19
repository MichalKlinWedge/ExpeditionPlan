"use server";

import { dayChip, plural, reorderDays, TripDocument } from "@expeditionplan/core";
import { refIndex, saveElements, stateFromPayload } from "@expeditionplan/sync";
import { refresh } from "next/cache";

import type { FormState } from "@/app/actions";
import { requireUser } from "@/lib/auth";
import { pullTrip, validationError } from "@/lib/trip-snapshot";

/**
 * „Kolejność dni” (`components/day-order.tsx`): programy dni w nowej kolejności. Zapisują się same wiersze dni
 * (data, nocleg i baza tej daty, `reorderDays`); punkty, warianty i zadania wskazują dzień, więc jadą z programem.
 * Dzień z wpisami dziennika albo zgłoszeniami z trasy zostaje na swojej dacie — to fakty z tego dnia.
 * `known` = kolejność, którą widziało okno: gdy ktoś w międzyczasie zmienił dni, nic się nie zapisuje.
 */
export async function saveDayOrder(tripId: string, known: string[], order: string[]): Promise<FormState> {
  const { supabase } = await requireUser(`/trips/${tripId}/plan`);
  const pulled = await pullTrip(supabase, tripId);
  if (pulled.error !== undefined) return { error: pulled.error };
  const { payload } = pulled;
  const doc = stateFromPayload(payload).doc;
  const current = [...doc.days].sort((a, b) => a.date.localeCompare(b.date)).map((day) => day.ref);
  if (current.join("\n") !== known.join("\n")) return { error: "Dni wyjazdu zmieniły się w międzyczasie — odśwież stronę i ustaw kolejność jeszcze raz." };
  const edit = reorderDays(doc, order);
  if (edit === null) return { error: "Kolejność dni się nie zmieniła." };
  const ids = refIndex(payload.tables);
  const moved = new Set(edit.changed.map((day) => ids[day.ref]));
  const facts = ["journal_entries", "schedule_events"].flatMap((table) => (payload.tables[table] ?? []).filter((row) => row.deleted_at == null && moved.has(row.day_id as string)));
  if (facts.length > 0) {
    const days = doc.days.filter((day) => facts.some((row) => row.day_id === ids[day.ref])).map((day) => dayChip(day.date));
    return { error: `Nie przestawiono: ${days.join(", ")} ma wpisy z trasy (dziennik, odhaczenia) — te dni zostają na swoich datach.` };
  }
  const checked = TripDocument.safeParse(edit.doc);
  if (!checked.success) return { error: validationError(checked.error) };
  const changed = checked.data.days.filter((day) => edit.changed.some((each) => each.ref === day.ref));
  try {
    await saveElements(supabase, tripId, checked.data, changed.map((element) => ({ collection: "days" as const, element, op: "update" as const })), ids);
  } catch (e) {
    return { error: `Nie zapisano: ${e instanceof Error ? e.message : String(e)}` };
  }
  refresh();
  return { ok: `Nowa kolejność dni zapisana (${plural(changed.length, ["dzień przestawiony", "dni przestawione", "dni przestawionych"])}). Noclegi zostały przy datach.` };
}
