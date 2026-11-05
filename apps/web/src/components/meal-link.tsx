"use client";

import { linkMeal, mealPoints, mealPointsFor, type PlanEdit, type ScheduleOptions, scheduleDay, type TripDocument } from "@expeditionplan/core";

/** Wybór punktu planu, przy którym jest posiłek (`linkMeal`): strona „Posiłki” i edytor planu. */
export function MealLink({ doc, itemRef, options, disabled, onEdit }: { doc: TripDocument; itemRef: string; options?: ScheduleOptions; disabled?: boolean; onEdit: (edit: PlanEdit | null) => void }) {
  const meal = doc.items.find((item) => item.ref === itemRef);
  const points = mealPointsFor(doc, itemRef, options);
  if (meal?.dayRef === undefined || points.length === 0) return null;
  return (
    <label className="ml-1 inline-flex items-center gap-1 text-xs text-zinc-500" title="Spięty posiłek stoi pod punktem i przenosi się razem z nim, a kolejny punkt czeka, aż skończycie jeść. Przy przejeździe to postój w trasie.">
      przy punkcie:
      <select value={meal.parentRef ?? ""} disabled={disabled} onChange={(event) => onEdit(linkMeal(doc, itemRef, event.target.value || null, options))} className="field max-w-56 min-w-0 px-1 py-0.5 text-xs">
        <option value="">osobny punkt</option>
        <PointOptions doc={doc} dayRef={meal.dayRef} itemRef={itemRef} options={options} />
      </select>
    </label>
  );
}

/** Opcje listy: godzina z harmonogramu i nazwa punktu. */
export function PointOptions({ doc, dayRef, itemRef, options }: { doc: TripDocument; dayRef: string; itemRef?: string; options?: ScheduleOptions }) {
  const schedule = scheduleDay(doc, dayRef, options).items;
  return (itemRef === undefined ? mealPoints(doc, dayRef, options) : mealPointsFor(doc, itemRef, options)).map((point) => {
    const start = schedule.find((each) => each.ref === point.ref)?.startLocal;
    return (
      <option key={point.ref} value={point.ref}>
        {start ? `${start} ` : ""}
        {point.title}
        {point.kind === "transport" ? " (postój w trasie)" : ""}
      </option>
    );
  });
}
