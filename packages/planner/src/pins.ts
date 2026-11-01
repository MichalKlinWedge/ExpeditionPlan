import type { TripDocument } from '@expeditionplan/core';

/**
 * Pinezki z briefu (punkt „nie na każdej mapie”, parking) mają pierwszeństwo przed geokoderem.
 * Dopasowanie po słowach: każde znaczące słowo nazwy miejsca (rdzeń 5 liter) występuje w nazwie
 * pinezki — „Przełęcz Spalona” pasuje do „Parking na Przełęczy Spalonej (…)”.
 */
export function applyPins(doc: TripDocument, pins: { name: string; lat: number; lng: number }[] = []): TripDocument {
  const stems = (text: string) =>
    new Set(
      text
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((word) => word.length >= 4)
        .map((word) => word.slice(0, 5)),
    );
  return {
    ...doc,
    places: doc.places.map((place) => {
      if (place.lat !== undefined) return place;
      const own = stems(place.name);
      const pin = pins.find((each) => {
        const theirs = stems(each.name);
        return own.size >= 2 && [...own].every((stem) => theirs.has(stem));
      });
      return pin === undefined ? place : { ...place, lat: pin.lat, lng: pin.lng, provider: 'user' as const };
    }),
  };
}
