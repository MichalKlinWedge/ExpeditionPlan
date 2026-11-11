"use client";

import { type ReactNode, useState } from "react";

type Kind = "foot" | "car";
const LABEL: Record<"all" | Kind, string> = { all: "wszystkie", foot: "🥾 pieszo", car: "🚗 autem" };

/**
 * Filtr rodzaju na liście „Trasy”: wszystkie, piesze albo autem. Grupy rysuje serwer, tu tylko się chowają;
 * przy jednym rodzaju filtra nie ma.
 */
export function RouteFilter({ groups }: { groups: { key: string; kind: Kind; node: ReactNode }[] }) {
  const [shown, setShown] = useState<"all" | Kind>("all");
  const count = (kind: Kind) => groups.filter((group) => group.kind === kind).length;
  const both = count("foot") > 0 && count("car") > 0;
  return (
    <>
      {both && (
        <div className="flex flex-wrap items-center gap-2 text-sm" role="group" aria-label="Rodzaj trasy">
          <span className="text-xs text-zinc-600 dark:text-zinc-400">Pokaż</span>
          {(["all", "foot", "car"] as const).map((each) => (
            <button key={each} type="button" onClick={() => setShown(each)} aria-pressed={shown === each} className="toggle-chip">
              {LABEL[each]} ({each === "all" ? groups.length : count(each)})
            </button>
          ))}
        </div>
      )}
      {groups.filter((group) => !both || shown === "all" || group.kind === shown).map((group) => (
        <div key={group.key} className="contents">
          {group.node}
        </div>
      ))}
    </>
  );
}
