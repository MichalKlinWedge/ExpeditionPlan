import { headcount, isShopping, mealList, type TripDocument } from "@expeditionplan/core";

import { ShoppingList } from "@/components/logistics-editors";

/**
 * „Jedzenie i zakupy”: posiłki z planu dzień po dniu z liczbą osób (dorośli i dzieci osobno)
 * i wspólna lista zakupów. Listę odhacza się na telefonie (offline), tu widać, co już kupione.
 */

type Row = Record<string, unknown> & { id: string; deleted_at?: string | null };

const shortDay = (date: string) => new Intl.DateTimeFormat("pl-PL", { weekday: "short", day: "numeric", month: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));

export function Meals({ tripId, doc, tables, ids, canEdit }: { tripId: string; doc: TripDocument; tables: Record<string, Row[] | undefined>; ids: Record<string, string>; canEdit: boolean }) {
  const meals = mealList(doc);
  const { adults, children } = headcount(doc);
  const bought = new Set((tables.packing_checks ?? []).filter((row) => !row.deleted_at && row.packed === true).map((row) => String(row.packing_item_id)));
  const items = doc.packing.filter(isShopping).map((item) => ({ ...item, bought: bought.has(ids[item.ref] ?? "") }));

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
              {meal.title}
              {meal.place && <span className="text-zinc-500"> · {meal.place}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-zinc-500">W planie nie ma posiłków (punktów „jedzenie”).</p>
      )}
      <h3 className="font-semibold">
        Lista zakupów ({items.filter((item) => item.bought).length}/{items.length} kupione)
      </h3>
      <ShoppingList tripId={tripId} items={items} canEdit={canEdit} />
    </div>
  );
}
