"use client";

import { mealEateries, type TripDocument } from "@expeditionplan/core";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { EatOutSearch, MealEateries } from "@/components/eat-out";
import { mealAnchor } from "@/components/meal-row";

/**
 * Knajpy posiłku na karcie punktu: przypięte (jak na „Posiłkach”, nazwa prowadzi do tego posiłku
 * na stronie Posiłki z wybraną knajpą) i — w edycji — „knajpy w pobliżu”, to samo wyszukiwanie co na „Posiłkach”.
 */
export function ItemEatOut({ tripId, doc, ids, itemRef, editing }: { tripId: string; doc: TripDocument; ids: Record<string, string>; itemRef: string; editing: boolean }) {
  const router = useRouter();
  const [searching, setSearching] = useState(false);
  const [pinned, setPinned] = useState<string[] | null>(null);
  const hasEateries = mealEateries(doc, itemRef).length > 0;
  if (!editing && !hasEateries) return null;
  const selection = {
    numbers: {},
    selected: null,
    onSelect: () => {},
    href: (placeRef: string) => `/trips/${tripId}/meals?knajpa=${encodeURIComponent(placeRef)}#${encodeURIComponent(mealAnchor(itemRef))}`,
  };

  return (
    <section className="card flex flex-col gap-2 p-4 text-sm">
      <h2 className="text-lg font-semibold">Gdzie jemy</h2>
      {hasEateries ? <MealEateries tripId={tripId} doc={doc} ids={ids} itemRef={itemRef} canEdit={editing} selection={selection} /> : <p className="text-zinc-500">Nie ma jeszcze przypiętej knajpy.</p>}
      {pinned && <p className="text-xs text-emerald-700 dark:text-emerald-400">Przypięto i zapisano: {pinned.join(", ")}.</p>}
      {editing && !searching && (
        <button onClick={() => setSearching(true)} className="btn-secondary btn-sm self-start">
          Knajpy w pobliżu
        </button>
      )}
      {editing && searching && (
        <EatOutSearch
          tripId={tripId}
          doc={doc}
          ids={ids}
          itemRef={itemRef}
          onClose={() => setSearching(false)}
          onPinned={(_placeRef, names) => {
            setPinned(names);
            router.refresh();
          }}
        />
      )}
    </section>
  );
}
