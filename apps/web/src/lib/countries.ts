import type { TripBrief } from "@expeditionplan/core";
import { countryOfTz } from "@expeditionplan/planner";

/** Kraje wyjazdu do szukania miejsc: z briefu, a bez niego ze strefy wyjazdu. */
export function countriesFor(brief: TripBrief | null, primaryTz: string): string[] {
  if (brief !== null) return brief.location.countries;
  const fromTz = countryOfTz(primaryTz);
  return fromTz === undefined ? [] : [fromTz];
}
