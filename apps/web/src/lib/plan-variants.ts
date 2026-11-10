import type { TripDocument } from "@expeditionplan/core";

/**
 * Warianty wybrane w widoku planu, pamiętane na czas karty przeglądarki — plan i karta punktu czytają to samo.
 * Kopia idzie do ciasteczka sesji (`variantsCookie`), żeby serwer budował z nimi film i zapowiedź (`lib/plan-variants-server.ts`).
 */
const variantsKey = (tripId: string) => `plan-variants:${tripId}`;

/** Nazwa ciasteczka sesji z wyborem wariantów tego wyjazdu. */
export const variantsCookie = (tripId: string) => `warianty_${tripId}`;

/** Wybór z widoku planu do ciasteczka sesji (bez daty ważności: znika z zamknięciem przeglądarki). */
export function shareChosenVariants(tripId: string, chosen: Record<string, string>) {
  try {
    document.cookie = `${variantsCookie(tripId)}=${encodeURIComponent(JSON.stringify(chosen))}; path=/; SameSite=Lax`;
  } catch {
    // Bez ciasteczka film bierze warianty wybrane w planie.
  }
}

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
  shareChosenVariants(tripId, chosen);
  try {
    sessionStorage.setItem(variantsKey(tripId), JSON.stringify(chosen));
  } catch {
    // Bez pamięci wybór działa do odświeżenia widoku.
  }
}
