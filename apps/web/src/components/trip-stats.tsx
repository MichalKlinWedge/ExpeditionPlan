import { activeVariants, type DaySchedule, dayVariantLabels, formatKm, formatMinutes, MOVE_LABEL, moveLine, plural, scheduleDay, shortDate, STAY_LABEL, stayLine, tripStatistics, type TripDocument } from "@expeditionplan/core";

/**
 * „Statystyki wyjazdu” na stronie wyjazdu: suma statystyk dni (`core/day-stats.ts` `tripStatistics`) z wariantami
 * wybranymi w widoku planu (ciasteczko `warianty_<wyjazd>`, bez niego — wybrane w planie), scenariusz optymistyczny.
 * Po wyjeździe liczby z terenu są na „Pamiątce z wyjazdu”.
 */
export function TripStats({ doc, chosen }: { doc: TripDocument; chosen: Record<string, string> }) {
  const schedules = doc.days.flatMap((day): DaySchedule[] => {
    try {
      return [scheduleDay(doc, day.ref, { activeVariants: chosen })];
    } catch {
      return [];
    }
  });
  const stats = tripStatistics(doc, schedules);
  if (stats === null) return null;
  const active = activeVariants(doc, chosen);
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
  return (
    <details data-remember="statystyki-wyjazdu" className="card p-4 text-sm">
      <summary className="card-title cursor-pointer">Statystyki wyjazdu</summary>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-zinc-500">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-xs text-zinc-500">
        Suma statystyk dni z planu (scenariusz optymistyczny){variants > 0 ? `, z wariantami wybranymi w planie (${plural(variants, ["wybór", "wybory", "wyborów"])})` : ""}. Odcinek „bez km” nie ma dystansu w planie i liczy się tylko do czasu. Statystyki pojedynczego dnia są pod jego planem.
      </p>
    </details>
  );
}
