import { type Meal, type MealDay, mealTime, type TripDocument } from "@expeditionplan/core";
import type { ReactNode } from "react";

/** Wspólne dla podglądu i edycji „Posiłków”: nagłówek dnia oraz numer i nazwa posiłku, które wybierają jego miejsce. */

const longDay = (date: string) => new Intl.DateTimeFormat("pl-PL", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));

export type MealSelection = {
  /** Numery miejsc na mapie (`mealMap`). */
  numbers: Record<string, number>;
  selected: string | null;
  onSelect: (placeRef: string) => void;
};

export function MealDaySection({ day, children }: { day: MealDay; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold">
        Dzień {day.dayNo} <span className="font-normal text-zinc-500">· {longDay(day.date)}</span>
      </h2>
      {day.meals.length === 0 ? <p className="text-xs text-zinc-500">Bez posiłków w planie.</p> : <ul className="flex flex-col gap-2">{children}</ul>}
    </section>
  );
}

/** Klasy wiersza posiłku: wszystkie posiłki w wybranym miejscu mają obwódkę, a pinezka przewija do pierwszego z nich. */
export const mealRowClass = (meal: Meal, selected: string | null) => `card flex scroll-mt-4 flex-col gap-1 p-3 text-sm ${meal.placeRef !== undefined && meal.placeRef === selected ? "ring-2 ring-sea" : ""}`;

export const mealRowId = (meal: Meal) => `posilek-${meal.itemRef}`;

export function MealHead({ doc, meal, selection }: { doc: TripDocument; meal: Meal; selection: MealSelection }) {
  const time = mealTime(doc, meal);
  const n = meal.placeRef === undefined ? undefined : selection.numbers[meal.placeRef];
  const details = [meal.place, meal.at && `${meal.at.stop ? "postój w trasie" : "przy punkcie"}: ${meal.at.title}`].filter(Boolean).join(" · ");
  const name = (
    <>
      {n !== undefined && <span className="flex h-5 min-w-5 items-center justify-center self-center rounded-full bg-sea px-1 text-xs font-semibold text-white">{n}</span>}
      <strong>
        {meal.selfCooked && <span aria-hidden="true">🍳 </span>}
        {meal.title}
      </strong>
    </>
  );
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        {meal.placeRef === undefined ? (
          <span className="flex items-baseline gap-x-2">{name}</span>
        ) : (
          <button type="button" onClick={() => selection.onSelect(meal.placeRef!)} aria-pressed={selection.selected === meal.placeRef} title={n === undefined ? "Pokaż opis miejsca" : "Pokaż na mapie i opis miejsca"} className="flex items-baseline gap-x-2 text-left hover:text-sea">
            {name}
          </button>
        )}
        {time && <span className="text-xs text-zinc-500">{time}</span>}
      </div>
      {details && <p className="text-xs text-zinc-600 dark:text-zinc-400">{details}</p>}
    </div>
  );
}
