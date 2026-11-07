import type { TripDocument } from "@expeditionplan/core";

/** Warianty wybrane w widoku planu, pamiętane na czas karty przeglądarki — plan i karta punktu czytają to samo. */
const variantsKey = (tripId: string) => `plan-variants:${tripId}`;

/** Warianty wybrane w tej karcie przeglądarki; pomija te, których plan już nie ma. Bez dostępu do pamięci — domyślne. */
export function readChosenVariants(tripId: string, doc: TripDocument): Record<string, string> {
  try {
    const saved = JSON.parse(sessionStorage.getItem(variantsKey(tripId)) ?? "{}") as Record<string, string>;
    return Object.fromEntries(Object.entries(saved).filter(([group, ref]) => doc.variants.some((variant) => variant.ref === ref && variant.groupRef === group)));
  } catch {
    return {};
  }
}

export function saveChosenVariants(tripId: string, chosen: Record<string, string>) {
  try {
    sessionStorage.setItem(variantsKey(tripId), JSON.stringify(chosen));
  } catch {
    // Bez pamięci wybór działa do odświeżenia widoku.
  }
}
