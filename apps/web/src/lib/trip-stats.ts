import { activeVariants, type DaySchedule, dayVariantLabels, formatKm, formatMinutes, MOVE_LABEL, moveLine, plural, scheduleDay, type ScheduleOptions, shortDate, STAY_LABEL, stayLine, tripStatistics, type TripDocument } from "@expeditionplan/core";

/**
 * Wiersze „Statystyk wyjazdu” (`core/day-stats.ts` `tripStatistics`) wspólne dla strony wyjazdu i wydruku:
 * etykieta → wartość oraz dopisek, z czego liczone. `null`, gdy plan nie ma dni z punktami.
 */
export function tripStatsView(doc: TripDocument, options: ScheduleOptions): { rows: [string, string][]; note: string } | null {
  const schedules = doc.days.flatMap((day): DaySchedule[] => {
    try {
      return [scheduleDay(doc, day.ref, options)];
    } catch {
      return [];
    }
  });
  const stats = tripStatistics(doc, schedules);
  if (stats === null) return null;
  const active = activeVariants(doc, options.activeVariants);
  const variants = doc.days.reduce((sum, day) => sum + dayVariantLabels(doc, day.ref, active).length, 0);
  const rows: [string, string][] = [
    ["Wyjazd", `${plural(stats.days, ["dzień", "dni", "dni"])} · ${plural(stats.points, ["punkt", "punkty", "punktów"])}${stats.movingMin > 0 ? ` · w drodze ${formatMinutes(stats.movingMin)}` : ""}`],
    ...stats.moves.map((move): [string, string] => [MOVE_LABEL[move.kind], moveLine(move)]),
    ...stats.stays.map((stay): [string, string] => [STAY_LABEL[stay.kind], stayLine(stay)]),
    ...(stats.freeMin > 0 ? [["Wolny czas", formatMinutes(stats.freeMin)] as [string, string]] : []),
    ...(stats.longestDay ? [["Najdłuższy dzień", `${shortDate(stats.longestDay.date)} · ${formatMinutes(stats.longestDay.spanMin)}`] as [string, string]] : []),
    ...(stats.mostFoot ? [["Najwięcej pieszo", `${shortDate(stats.mostFoot.date)} · ${formatKm(stats.mostFoot.km)}`] as [string, string]] : []),
    ...(stats.mostAscent ? [["Największe podejście", `${shortDate(stats.mostAscent.date)} · ↑ ${stats.mostAscent.ascentM} m`] as [string, string]] : []),
  ];
  const scenario = options.scenario === "pessimistic" ? "scenariusz pesymistyczny" : "scenariusz optymistyczny";
  const chosen = variants > 0 ? `, z wariantami wybranymi w planie (${plural(variants, ["wybór", "wybory", "wyborów"])})` : "";
  return { rows, note: `Suma statystyk dni z planu (${scenario})${chosen}. Odcinek „bez km” nie ma dystansu w planie i liczy się tylko do czasu; loty liczone po łuku między lotniskami.` };
}
