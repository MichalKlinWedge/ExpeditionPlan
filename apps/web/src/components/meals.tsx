import { headcount, isShopping, mealList, selfCookedTotals, type TripDocument } from "@expeditionplan/core";

import { SelfCookedToggle, ShoppingList } from "@/components/logistics-editors";

/**
 * Posiłki z planu dzień po dniu z liczbą osób (dorośli i dzieci osobno, porcje przy gotowaniu
 * samemu) i wspólna lista zakupów — dwie osobne strony wyjazdu. Listę odhacza się na telefonie
 * (offline), tu widać, co już kupione.
 */

type Row = Record<string, unknown> & { id: string; deleted_at?: string | null };

const shortDay = (date: string) => new Intl.DateTimeFormat("pl-PL", { weekday: "short", day: "numeric", month: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));

/** Pozycje listy zakupów z tym, co już kupione (odhaczenia z telefonu). */
export function shoppingItems(doc: TripDocument, tables: Record<string, Row[] | undefined>, ids: Record<string, string>) {
  const bought = new Set((tables.packing_checks ?? []).filter((row) => !row.deleted_at && row.packed === true).map((row) => String(row.packing_item_id)));
  return doc.packing.filter(isShopping).map((item) => ({ ...item, bought: bought.has(ids[item.ref] ?? "") }));
}

export function Meals({ tripId, doc, canEdit }: { tripId: string; doc: TripDocument; canEdit: boolean }) {
  const meals = mealList(doc);
  const { adults, children } = headcount(doc);
  const own = selfCookedTotals(meals);
  const people = (each: { adults: number; children: number }) => `${each.adults} dor.${each.children > 0 ? ` + ${each.children} dz.` : ""}`;

  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-zinc-600 dark:text-zinc-400">
        {doc.travelers.length > 0 ? (
          <>
            Na posiłek: <strong>{adults} dorosłych</strong>
            {children > 0 && (
              <>
                {" "}
                + <strong>{children} dzieci</strong>
              </>
            )}
            .
          </>
        ) : (
          "Brak uczestników — dodaj ich w „Uczestnicy i dostęp”."
        )}
      </p>
      {meals.length > 0 ? (
        <ul className="flex flex-col gap-0.5">
          {meals.map((meal) => (
            <li key={meal.itemRef}>
              <span className="text-zinc-500">
                Dzień {meal.dayNo} · {shortDay(meal.date)}:
              </span>{" "}
              {meal.selfCooked && <span aria-hidden="true">🍳 </span>}
              {meal.title}
              {meal.place && <span className="text-zinc-500"> · {meal.place}</span>}
              {meal.selfCooked && <span className="text-zinc-500"> · porcje: {people(meal.people)}</span>}
              {canEdit && (
                <>
                  {" "}
                  <SelfCookedToggle tripId={tripId} itemRef={meal.itemRef} value={meal.selfCooked === true} />
                </>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-zinc-500">W planie nie ma posiłków (punktów „jedzenie”).</p>
      )}
      {own.meals > 0 && (
        <p>
          🍳 Gotujecie sami: <strong>{own.meals}</strong> {own.meals === 1 ? "posiłek" : own.meals < 5 ? "posiłki" : "posiłków"} — razem porcji: <strong>{people(own)}</strong>
        </p>
      )}
      {own.meals === 0 && meals.length > 0 && canEdit && <p className="text-xs text-zinc-500">Zaznacz „gotujemy sami” przy posiłkach z własnej kuchni (chatka, ognisko) — policzymy porcje.</p>}
    </div>
  );
}

export function Shopping({ tripId, doc, tables, ids, canEdit }: { tripId: string; doc: TripDocument; tables: Record<string, Row[] | undefined>; ids: Record<string, string>; canEdit: boolean }) {
  const items = shoppingItems(doc, tables, ids);
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-zinc-600 dark:text-zinc-400">
        Kupione: <strong>{items.filter((item) => item.bought).length}</strong> z {items.length}. Odhacza się na telefonie (zakładka Pakowanie), także bez internetu.
      </p>
      <ShoppingList tripId={tripId} items={items} canEdit={canEdit} />
    </div>
  );
}
