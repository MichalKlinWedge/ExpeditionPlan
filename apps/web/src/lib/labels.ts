export const ROLE: Record<string, string> = { owner: "właściciel", editor: "edytor", viewer: "widz" };

/** „26–31 grudnia 2026” — daty wyjazdu bez strefy (to daty kalendarzowe). */
export const tripDates = (start: string, end: string) =>
  new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).formatRange(
    new Date(`${start}T00:00:00Z`),
    new Date(`${end}T00:00:00Z`),
  );
