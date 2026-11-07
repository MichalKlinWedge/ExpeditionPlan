"use client";

import { addMeal, dayChip, documentProblem, ItemInUseError, mealDays, mealList, mealPoints, type PlanEdit, removeItemClosingGap, type TripDocument, updateItem } from "@expeditionplan/core";
import { savePlanEdit, uuidv7 } from "@expeditionplan/sync";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { EatOutSearch, MealEateries } from "@/components/eat-out";
import { ItemEditor } from "@/components/item-editor";
import { SelfCookedToggle } from "@/components/logistics-editors";
import { MealLink, PointOptions } from "@/components/meal-link";
import { MealDaySection, MealHead, mealRowClass, mealRowId, type MealSelection } from "@/components/meal-row";
import { createClient } from "@/lib/supabase/client";

/**
 * Posiłki w trybie edycji: nowy posiłek w wybranym dniu (śniadanie, obiad, kolacja…) z godziną
 * „ok.” — wchodzi do planu dnia na swoje miejsce (\`addMeal\` w core), zmiana nazwy, godziny i czasu
 * (formularz jak w planie), spięcie z punktem planu (`MealLink`), usunięcie i — przy jedzeniu na mieście — knajpy w pobliżu (`EatOutSearch`). Zapis tą samą drogą co edytor planu (\`savePlanEdit\`).
 */

const SUGGESTIONS = ["Śniadanie", "Drugie śniadanie", "Lunch", "Obiad", "Podwieczorek", "Kolacja", "Przekąska"];


const input = "field min-w-0 px-2 py-1 text-sm";

export function MealEditor({ tripId, doc, ids, selection }: { tripId: string; doc: TripDocument; ids: Record<string, string>; selection: MealSelection }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [searching, setSearching] = useState<string | null>(null);
  const [pinned, setPinned] = useState<{ itemRef: string; names: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const days = mealDays(doc, mealList(doc, { allVariants: true }));
  const byRef = new Map(doc.items.map((item) => [item.ref, item]));

  const save = (edit: PlanEdit | null, done?: () => void) => {
    if (edit === null) return;
    const invalid = documentProblem(edit.doc);
    if (invalid !== null) return setError(`Nie zapisano: ${invalid}`);
    start(async () => {
      try {
        await savePlanEdit(createClient(), tripId, edit, ids);
        setError(null);
        done?.();
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  return (
    <div className="flex flex-col gap-3 text-sm">
      {days.every((day) => day.meals.length === 0) && <p className="text-zinc-500">W planie nie ma jeszcze posiłków — dodaj pierwszy niżej.</p>}
      {days.map((day) => (
        <MealDaySection key={day.dayRef} day={day}>
          {day.meals.map((meal) => {
            const item = byRef.get(meal.itemRef);
            return (
              <li key={meal.itemRef} id={mealRowId(meal)} className={mealRowClass(doc, meal, selection.selected)}>
                <MealHead doc={doc} meal={meal} selection={selection} />
                <div>
                  <SelfCookedToggle tripId={tripId} itemRef={meal.itemRef} value={meal.selfCooked === true} />
                  <MealLink doc={doc} itemRef={meal.itemRef} disabled={pending} onEdit={(edit) => save(edit)} />
                  <span className="ml-1 text-xs text-zinc-500">
                    <button disabled={pending} onClick={() => setEditing(editing === meal.itemRef ? null : meal.itemRef)} className="btn-mini">
                      {editing === meal.itemRef ? "zamknij" : "zmień"}
                    </button>
                    {!meal.selfCooked && (
                      <button disabled={pending} onClick={() => setSearching(searching === meal.itemRef ? null : meal.itemRef)} className="btn-mini">
                        knajpy w pobliżu
                      </button>
                    )}
                    <button
                      disabled={pending}
                      onClick={() => {
                        if (!window.confirm(`Usunąć posiłek „${meal.title}” z planu?`)) return;
                        try {
                          save(removeItemClosingGap(doc, meal.itemRef));
                        } catch (e) {
                          setError(e instanceof ItemInUseError ? e.message : String(e));
                        }
                      }}
                      className="btn-mini btn-mini-danger">
                      usuń
                    </button>
                  </span>
                </div>
                <MealEateries tripId={tripId} doc={doc} ids={ids} itemRef={meal.itemRef} canEdit selection={selection} />
                {pinned?.itemRef === meal.itemRef && <p className="text-xs text-emerald-700 dark:text-emerald-400">Przypięto i zapisano: {pinned.names.join(", ")}.</p>}
                {searching === meal.itemRef && (
                  <EatOutSearch
                    tripId={tripId}
                    doc={doc}
                    ids={ids}
                    itemRef={meal.itemRef}
                    onClose={() => setSearching(null)}
                    onPinned={(placeRef, names) => {
                      setPinned({ itemRef: meal.itemRef, names });
                      selection.onSelect(placeRef);
                    }}
                  />
                )}
                {editing === meal.itemRef && item && (
                  <ItemEditor item={item} onCancel={() => setEditing(null)} onSave={(patch) => save(updateItem(doc, meal.itemRef, patch), () => setEditing(null))} />
                )}
              </li>
            );
          })}
        </MealDaySection>
      ))}
      {doc.days.length > 0 && (
        <section className="mt-3 flex flex-col gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <h3 className="font-semibold">Nowy posiłek</h3>
          <AddMeal doc={doc} disabled={pending} onAdd={(dayRef, meal) => save(addMeal(doc, dayRef, uuidv7(), meal))} />
        </section>
      )}
      {pending && <p className="text-xs text-zinc-500">Zapisuję…</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

function AddMeal({ doc, disabled, onAdd }: { doc: TripDocument; disabled: boolean; onAdd: (dayRef: string, meal: { title: string; time?: string; selfCooked?: boolean; atRef?: string }) => void }) {
  const [dayRef, setDayRef] = useState(doc.days[0]!.ref);
  const [title, setTitle] = useState("");
  const [time, setTime] = useState("");
  const [selfCooked, setSelfCooked] = useState(false);
  const [atRef, setAtRef] = useState("");
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (title.trim() === "") return;
        onAdd(dayRef, { title: title.trim(), ...(time ? { time } : {}), ...(selfCooked ? { selfCooked } : {}), ...(atRef ? { atRef } : {}) });
        setTitle("");
        setTime("");
        setAtRef("");
      }}>
      <label className="flex flex-col gap-1 text-xs text-zinc-500">
        Dzień
        <select
          value={dayRef}
          onChange={(event) => {
            setDayRef(event.target.value);
            setAtRef("");
          }}
          className={input}>
          {doc.days.map((day, index) => (
            <option key={day.ref} value={day.ref}>
              {index + 1}. {dayChip(day.date)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-zinc-500">
        Posiłek
        <input value={title} onChange={(event) => setTitle(event.target.value)} list="meal-suggestions" placeholder="np. Śniadanie" className={input} />
        <datalist id="meal-suggestions">
          {SUGGESTIONS.map((each) => (
            <option key={each} value={each} />
          ))}
        </datalist>
      </label>
      <label className="flex flex-col gap-1 text-xs text-zinc-500">
        Godzina (ok.)
        <input type="time" value={time} onChange={(event) => setTime(event.target.value)} className={input} />
      </label>
      {mealPoints(doc, dayRef).length > 0 && (
        <label className="flex min-w-40 flex-col gap-1 text-xs text-zinc-500">
          Przy punkcie (opcjonalnie)
          <select value={atRef} onChange={(event) => setAtRef(event.target.value)} className={input}>
            <option value="">osobny punkt</option>
            <PointOptions doc={doc} dayRef={dayRef} />
          </select>
        </label>
      )}
      <label className="flex items-center gap-1 pb-1 text-xs">
        <input type="checkbox" checked={selfCooked} onChange={(event) => setSelfCooked(event.target.checked)} />
        gotujemy sami
      </label>
      <button disabled={disabled} className="btn-primary btn-sm">
        Dodaj posiłek
      </button>
    </form>
  );
}
