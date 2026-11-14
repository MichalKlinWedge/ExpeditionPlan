import type { TripDocument } from "@expeditionplan/core";

import { tripStatsView } from "@/lib/trip-stats";

/**
 * „Statystyki wyjazdu” na stronie wyjazdu: suma statystyk dni (`lib/trip-stats.ts`) z wariantami wybranymi
 * w widoku planu (ciasteczko `warianty_<wyjazd>`, bez niego — wybrane w planie), scenariusz optymistyczny.
 * Po wyjeździe liczby z terenu są na „Pamiątce z wyjazdu”.
 */
export function TripStats({ doc, chosen }: { doc: TripDocument; chosen: Record<string, string> }) {
  const view = tripStatsView(doc, { activeVariants: chosen });
  if (view === null) return null;
  return (
    <details data-remember="statystyki-wyjazdu" className="card p-4 text-sm">
      <summary className="card-title cursor-pointer">Statystyki wyjazdu</summary>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        {view.rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-zinc-500">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-xs text-zinc-500">{view.note} Statystyki pojedynczego dnia są pod jego planem.</p>
    </details>
  );
}
