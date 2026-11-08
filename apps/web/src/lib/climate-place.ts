import { type ClimatePlace, weatherPoints } from "@expeditionplan/core";
import { type PullPayload, stateFromPayload } from "@expeditionplan/sync";

export type ClimateSource = { place: ClimatePlace | null; query: { name: string; countryCode?: string } | null };

/**
 * Miejsce do klimatu terminu: pierwszy dzień planu z miejscem ze współrzędnymi (jak przy prognozie),
 * a bez takiego — pierwsze miejsce z briefu (nazwa i kod kraju do geokodera w przeglądarce).
 */
export function climateSource(payload: PullPayload): ClimateSource {
  try {
    const { doc } = stateFromPayload(payload);
    const first = weatherPoints(doc)[0];
    if (first !== undefined) {
      const named = doc.places.find((place) => place.lat === first.lat && place.lng === first.lng);
      return { place: { lat: first.lat, lng: first.lng, name: named?.name ?? doc.trip.title }, query: null };
    }
  } catch {
    // Plan nie przechodzi schematu — zostaje brief.
  }
  const brief = (payload.tables.trip_brief ?? [])[0]?.brief as { location?: { places?: string[]; countries?: string[] } } | undefined;
  const name = brief?.location?.places?.[0];
  return { place: null, query: name ? { name, countryCode: brief?.location?.countries?.[0] } : null };
}
