import type { RulesEdit } from '@expeditionplan/core';
import type { SupabaseClient } from '@supabase/supabase-js';

import { saveElements, savePlanEdit } from './plan-save.ts';

/**
 * Zapis zmiany wariantów i ograniczeń z edytora (`plan-rules` w packages/core): najpierw nowe
 * i zmienione grupy, warianty, ograniczenia (punkty wskazują warianty przez id), potem punkty
 * zmienione przy okazji — z `user_locked`, jak każda ręczna edycja — a usunięcia na końcu.
 */
export async function saveRulesEdit(client: SupabaseClient, tripId: string, edit: RulesEdit, ids: Record<string, string>): Promise<Record<string, string>> {
  const upserts = edit.writes.filter((write) => write.op !== 'remove');
  const removes = edit.writes.filter((write) => write.op === 'remove');
  let known = upserts.length > 0 ? await saveElements(client, tripId, edit.doc, upserts, ids) : ids;
  if (edit.changed.length > 0) known = await savePlanEdit(client, tripId, { doc: edit.doc, changed: edit.changed }, known);
  if (removes.length > 0) known = await saveElements(client, tripId, edit.doc, removes, known);
  return known;
}
