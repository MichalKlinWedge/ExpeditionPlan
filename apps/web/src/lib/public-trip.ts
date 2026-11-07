import { guideFor, type GuideRow } from "@expeditionplan/core";
import { refIndex, stateFromPayload } from "@expeditionplan/sync";

import { createClient } from "@/lib/supabase/server";

/** Wyjazd z publicznego linku (`public_trip`); `null`, gdy link wygasł albo został wyłączony. Dane prywatne odfiltrowuje baza. */
export async function loadPublicTrip(token: string) {
  const { data, error } = await (await createClient()).rpc("public_trip", { p_token: token });
  if (error || data === null) return null;
  const payload = data as Parameters<typeof stateFromPayload>[0] & { trip: { id: string }; hide?: { costs?: boolean; names?: boolean } | null; tentative?: number };
  const state = stateFromPayload(payload);
  const ids = refIndex(payload.tables);
  const guides = (payload.tables as unknown as { audio_guides?: GuideRow[] }).audio_guides ?? [];
  const guideOf = (item: (typeof state.doc.items)[number]) => {
    const placeRef = item.leg?.toPlaceRef ?? item.placeRef;
    return item.kind === "lodging" ? null : guideFor(guides, ids[item.ref], placeRef === undefined ? undefined : ids[placeRef]);
  };
  return { tripId: payload.trip.id, state, ids, guideOf, hide: { costs: payload.hide?.costs ?? true, names: payload.hide?.names ?? false }, tentative: payload.tentative ?? 0 };
}

export const EXPIRED_LINK = "Ten link do planu wygasł albo organizator go wyłączył.";
