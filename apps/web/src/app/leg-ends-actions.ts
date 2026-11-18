"use server";

import { applyLegEnds, checkLegEnds, plural, TripDocument } from "@expeditionplan/core";
import { refIndex, saveElements, saveMergeEdit, stateFromPayload, uuidv7 } from "@expeditionplan/sync";
import { refresh } from "next/cache";

import type { FormState } from "@/app/actions";
import { requireUser } from "@/lib/auth";
import { pullTrip, validationError } from "@/lib/trip-snapshot";

/**
 * „Sprawdź skąd i dokąd”: zapis końców przejazdów wybranych w oknie (`components/leg-ends-check.tsx`).
 * Propozycje liczą się od nowa na aktualnym planie (`checkLegEnds`), a zapisują tylko te o kluczach z okna —
 * gdy ktoś w międzyczasie coś zmienił, nieaktualna propozycja po prostu się nie zapisze. Punkty nie dostają
 * `user_locked`, więc „Przelicz przejazdy” policzy potem ich trasy. O prawie do zapisu decyduje RLS.
 */
export async function saveLegEnds(tripId: string, keys: string[]): Promise<FormState> {
  const { supabase } = await requireUser(`/trips/${tripId}/plan`);
  const pulled = await pullTrip(supabase, tripId);
  if (pulled.error !== undefined) return { error: pulled.error };
  const { payload } = pulled;
  const doc = stateFromPayload(payload).doc;
  const wanted = new Set(keys);
  const chosen = checkLegEnds(doc, uuidv7).proposals.filter((each) => wanted.has(each.key));
  if (chosen.length === 0) return { error: "Te propozycje są już nieaktualne — odśwież stronę i sprawdź jeszcze raz." };
  const edit = applyLegEnds(doc, chosen);
  const checked = TripDocument.safeParse(edit.doc);
  if (!checked.success) return { error: validationError(checked.error) };
  const changed = checked.data.items.filter((item) => edit.changed.some((each) => each.ref === item.ref));
  const created = checked.data.places.filter((place) => edit.created.some((each) => each.ref === place.ref));
  const pinned = checked.data.places.filter((place) => edit.pinned.some((each) => each.ref === place.ref));
  try {
    const ids = await saveElements(supabase, tripId, checked.data, [...created.map((element) => ({ collection: "places" as const, element, op: "insert" as const })), ...pinned.map((element) => ({ collection: "places" as const, element, op: "update" as const }))], refIndex(payload.tables));
    await saveMergeEdit(supabase, tripId, { doc: checked.data, created: [], changed, others: [], removed: [], kept: [], copied: {} }, ids);
  } catch (e) {
    return { error: `Nie zapisano: ${e instanceof Error ? e.message : String(e)}` };
  }
  refresh();
  const skipped = keys.length - chosen.length;
  return {
    ok: [
      `Uzupełniono ${plural(chosen.length, ["koniec", "końce", "końców"])} w ${plural(changed.length, ["przejeździe", "przejazdach", "przejazdach"])}.`,
      created.length > 0 ? `Nowe miejsca: ${created.map((place) => `„${place.name}”`).join(", ")}.` : "",
      skipped > 0 ? `Nieaktualne pominięte: ${skipped}.` : "",
      "Czasy przejazdów policzy „Przelicz przejazdy”.",
    ]
      .filter((each) => each !== "")
      .join(" "),
  };
}
