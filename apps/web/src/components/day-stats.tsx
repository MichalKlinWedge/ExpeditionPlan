import { type DaySchedule, dayStatistics, formatMinutes, MOVE_LABEL, moveLine, plural, STAY_LABEL, stayLine, type TripDocument } from "@expeditionplan/core";

/**
 * „Statystyki” pod planem dnia (`core/day-stats.ts`): godziny dnia, droga i czas pieszo, autem, komunikacją,
 * czas na zwiedzanie, posiłki i inne punkty, wolny czas. Ten sam scenariusz i warianty co plan nad nią.
 */
export function DayStats({ doc, dayRef, schedule }: { doc: TripDocument; dayRef: string; schedule: DaySchedule | null }) {
  const stats = schedule === null ? null : dayStatistics(doc, schedule);
  if (stats === null) return null;
  const nextDay = stats.endDate !== schedule!.date ? " (następnego dnia)" : "";
  const rows: [string, string][] = [
    ["Dzień", `${stats.start} → ${stats.end}${nextDay} · ${formatMinutes(stats.spanMin)} · ${plural(stats.points, ["punkt", "punkty", "punktów"])}`],
    ...stats.moves.map((move): [string, string] => [MOVE_LABEL[move.kind], moveLine(move)]),
    ...stats.stays.map((stay): [string, string] => [STAY_LABEL[stay.kind], stayLine(stay)]),
    ...(stats.freeMin > 0 ? [["Wolny czas", `${formatMinutes(stats.freeMin)} · ${plural(stats.freeCount, ["przerwa", "przerwy", "przerw"])} od 15 min`] as [string, string]] : []),
    ...(stats.bufferMin > 0 ? [["Zapasy po punktach", formatMinutes(stats.bufferMin)] as [string, string]] : []),
  ];
  return (
    <details id={`stats-${dayRef}`} open data-remember="statystyki-dnia" className="card p-4 text-sm">
      <summary className="card-title cursor-pointer">Statystyki dnia</summary>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-zinc-500">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-xs text-zinc-500">
        Czasy z planu ({schedule!.scenario === "pessimistic" ? "scenariusz pesymistyczny" : "scenariusz optymistyczny"}, wybrane warianty), kilometry i przewyższenia z przejazdów, wędrówek i ich śladów. Odcinek „bez km” nie ma dystansu w planie i liczy się tylko do czasu.
      </p>
    </details>
  );
}
