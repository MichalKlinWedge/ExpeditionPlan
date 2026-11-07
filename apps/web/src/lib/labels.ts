import { dayMonth } from "@expeditionplan/core";

/** „26–31 grudnia 2026” — daty wyjazdu bez strefy (to daty kalendarzowe). */
export const tripDates = (start: string, end: string) =>
  new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).formatRange(
    new Date(`${start}T00:00:00Z`),
    new Date(`${end}T00:00:00Z`),
  );

/** Część wyjazdu, na którą jedzie uczestnik; `null` = cały wyjazd. */
export function travelerPresence(from: string | null | undefined, to: string | null | undefined): string | null {
  if (from && to) return tripDates(from, to);
  if (from) return `od ${dayMonth(from)}`;
  return to ? `do ${dayMonth(to)}` : null;
}
