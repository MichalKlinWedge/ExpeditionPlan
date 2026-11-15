"use client";

import { type DayMap, mergeRouteMaps } from "@expeditionplan/core";
import type { ReactNode } from "react";

import { MemoriesMap } from "@/components/memories-map";
import { type RouteFilterState, setRouteFilter, useRouteFilter } from "@/lib/route-filter-state";

type Kind = "foot" | "car";
const LABEL: Record<"all" | Kind, string> = { all: "wszystkie", foot: "🥾 pieszo", car: "🚗 autem" };
type Sort = RouteFilterState["sort"];
const SORT: Record<Sort, string> = { day: "dzień planu", name: "nazwa" };

/** Mapa tras widocznych po filtrze; trasy bez linii i bez końców ze współrzędnymi jej nie mają. */
function RoutesMapCard({ groups, all }: { groups: { map: DayMap }[]; all: number }) {
  const map = mergeRouteMaps(groups.map((group) => group.map));
  if (map.lines.length === 0 && map.pins.length === 0) return null;
  return (
    <section className="card flex flex-col gap-2 p-4 text-sm">
      <h2 className="card-title">Mapa tras</h2>
      <p className="text-zinc-600 dark:text-zinc-400">{groups.length === all ? `Wszystkie trasy wyjazdu (${all}).` : `Trasy zostawione przez filtr: ${groups.length} z ${all}.`}</p>
      <MemoriesMap map={map} fitLines />
    </section>
  );
}

/**
 * Filtr rodzaju na liście „Trasy” (wszystkie, piesze albo autem; przy jednym rodzaju go nie ma), „bez planu” (trasy
 * niepodpięte do żadnego punktu dnia: nieużywane albo tylko przy punktach z puli) i kolejność: po pierwszym
 * dniu planu, w którym trasa jest użyta (pula i nieużywane na końcu), albo po nazwie. Grupy rysuje serwer, tu się
 * tylko chowają i ustawiają. Pod listą mapa tych tras, które filtr zostawił (`mergeRouteMaps`).
 * Ustawienie trzyma się karty przeglądarki (`route-filter-state.ts`), więc wejście w trasę i powrót
 * zastaje listę taką, jaka była.
 */
export function RouteFilter({ tripId, groups }: { tripId: string; groups: { key: string; kind: Kind; day: number; title: string; planned: boolean; map: DayMap; node: ReactNode }[] }) {
  const filter = useRouteFilter(tripId);
  const { shown, unplanned, sort } = filter;
  const set = (patch: Partial<RouteFilterState>) => setRouteFilter(tripId, { ...filter, ...patch });
  const count = (kind: Kind) => groups.filter((group) => group.kind === kind).length;
  const both = count("foot") > 0 && count("car") > 0;
  const outside = groups.filter((group) => !group.planned).length;
  // Filtr „bez planu” ma sens, gdy są trasy z planem i bez niego.
  const canFilterPlan = outside > 0 && outside < groups.length;
  const fits = (group: (typeof groups)[number]) => (!both || shown === "all" || group.kind === shown) && (!canFilterPlan || !unplanned || !group.planned);
  // Grupy przychodzą w kolejności planu (dzień, potem pozycja w dniu); „nazwa” ustawia je alfabetycznie.
  const order = (a: (typeof groups)[number], b: (typeof groups)[number]) => (sort === "day" ? a.day - b.day : a.title.localeCompare(b.title, "pl"));
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        {(both || canFilterPlan) && (
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Rodzaj trasy">
            <span className="text-xs text-zinc-600 dark:text-zinc-400">Pokaż</span>
            {both &&
              (["all", "foot", "car"] as const).map((each) => (
                <button key={each} type="button" onClick={() => set({ shown: each })} aria-pressed={shown === each} className="toggle-chip">
                  {LABEL[each]} ({each === "all" ? groups.length : count(each)})
                </button>
              ))}
            {canFilterPlan && (
              <button type="button" onClick={() => set({ unplanned: !unplanned })} aria-pressed={unplanned} className="toggle-chip">
                tylko bez planu ({outside})
              </button>
            )}
          </div>
        )}
        {groups.length > 1 && (
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Kolejność tras">
            <span className="text-xs text-zinc-600 dark:text-zinc-400">Sortuj</span>
            {(["day", "name"] as const).map((each) => (
              <button key={each} type="button" onClick={() => set({ sort: each })} aria-pressed={sort === each} className="toggle-chip">
                {SORT[each]}
              </button>
            ))}
          </div>
        )}
      </div>
      {[...groups].sort(order).filter(fits).map((group) => (
        <div key={group.key} className="contents">
          {group.node}
        </div>
      ))}
      <RoutesMapCard groups={[...groups].sort(order).filter(fits)} all={groups.length} />
    </>
  );
}
