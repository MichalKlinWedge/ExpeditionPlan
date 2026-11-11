"use client";

import { type ReactNode, useState } from "react";

type Kind = "foot" | "car";
const LABEL: Record<"all" | Kind, string> = { all: "wszystkie", foot: "🥾 pieszo", car: "🚗 autem" };
type Sort = "day" | "name";
const SORT: Record<Sort, string> = { day: "dzień planu", name: "nazwa" };

/**
 * Filtr rodzaju na liście „Trasy” (wszystkie, piesze albo autem; przy jednym rodzaju go nie ma) i kolejność: po pierwszym
 * dniu planu, w którym trasa jest użyta (pula i nieużywane na końcu), albo po nazwie. Grupy rysuje serwer, tu się
 * tylko chowają i ustawiają.
 */
export function RouteFilter({ groups }: { groups: { key: string; kind: Kind; day: number; title: string; node: ReactNode }[] }) {
  const [shown, setShown] = useState<"all" | Kind>("all");
  const [sort, setSort] = useState<Sort>("day");
  const count = (kind: Kind) => groups.filter((group) => group.kind === kind).length;
  const both = count("foot") > 0 && count("car") > 0;
  // Grupy przychodzą w kolejności planu (dzień, potem pozycja w dniu); „nazwa” ustawia je alfabetycznie.
  const order = (a: (typeof groups)[number], b: (typeof groups)[number]) => (sort === "day" ? a.day - b.day : a.title.localeCompare(b.title, "pl"));
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        {both && (
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Rodzaj trasy">
            <span className="text-xs text-zinc-600 dark:text-zinc-400">Pokaż</span>
            {(["all", "foot", "car"] as const).map((each) => (
              <button key={each} type="button" onClick={() => setShown(each)} aria-pressed={shown === each} className="toggle-chip">
                {LABEL[each]} ({each === "all" ? groups.length : count(each)})
              </button>
            ))}
          </div>
        )}
        {groups.length > 1 && (
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Kolejność tras">
            <span className="text-xs text-zinc-600 dark:text-zinc-400">Sortuj</span>
            {(["day", "name"] as const).map((each) => (
              <button key={each} type="button" onClick={() => setSort(each)} aria-pressed={sort === each} className="toggle-chip">
                {SORT[each]}
              </button>
            ))}
          </div>
        )}
      </div>
      {[...groups].sort(order).filter((group) => !both || shown === "all" || group.kind === shown).map((group) => (
        <div key={group.key} className="contents">
          {group.node}
        </div>
      ))}
    </>
  );
}
