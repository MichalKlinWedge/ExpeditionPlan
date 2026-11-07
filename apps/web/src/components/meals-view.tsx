"use client";

import { headcount, isEateryPlace, mealDays, mealList, mealMap, mealPlaceRefs, pluralForm, selfCookedTotals, type TripDocument } from "@expeditionplan/core";
import { useEffect, useMemo, useRef, useState } from "react";

import { MealEateries } from "@/components/eat-out";
import { MealEditor } from "@/components/meal-editor";
import { MealDaySection, MealHead, mealRowClass, mealRowId, type MealSelection } from "@/components/meal-row";
import { PlanMap } from "@/components/plan-map";
import { VenueCard } from "@/components/venue-card";

/**
 * Posiłki jak Miejsca: po lewej dzień po dniu z przypiętymi knajpami, po prawej mapa i dane wybranej knajpy. Posiłki i knajpy
 * ze współrzędnymi mają numer miejsca; numer albo nazwa wyróżnia pinezkę, pinezka przewija listę do pierwszego posiłku w tym miejscu.
 * Dodawanie, zmiana, usuwanie i przypinanie są po „Edytuj” (`MealEditor`), a opis knajpy organizator i edytor dodają od razu.
 */

const people = (each: { adults: number; children: number }) => `${each.adults} dor.${each.children > 0 ? ` + ${each.children} dz.` : ""}`;

export function MealsView({ tripId, doc, ids, mayEdit, editing, initialPlace }: { tripId: string; doc: TripDocument; ids: Record<string, string>; mayEdit: boolean; editing: boolean; initialPlace?: string }) {
  const [selected, setSelected] = useState<string | null>(initialPlace ?? null);
  const mapBox = useRef<HTMLDivElement>(null);
  const meals = useMemo(() => mealList(doc, { allVariants: true }), [doc]);
  const { numbers, map } = useMemo(() => mealMap(doc, meals), [doc, meals]);
  const days = mealDays(doc, meals);
  const { adults, children } = headcount(doc);
  const own = selfCookedTotals(meals);
  const chosen = doc.places.find((place) => place.ref === selected);

  // Z karty punktu (`#posilek-<ref>`): lista przewija się do tego posiłku, także po przejściu w aplikacji.
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (id !== "") document.getElementById(id)?.scrollIntoView({ block: "center" });
  }, []);

  // Nowe miejsce: kolumna wraca na górę, żeby mapa z pinezką była widoczna po czytaniu długiego opisu.
  useEffect(() => {
    if (selected !== null) mapBox.current?.scrollTo({ top: 0 });
  }, [selected]);

  const selection: MealSelection = {
    numbers,
    selected,
    // Na telefonie mapa jest nad listą, więc wyróżniona pinezka musi wrócić na ekran.
    onSelect: (placeRef) => {
      setSelected(placeRef);
      mapBox.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    },
  };
  const fromMap = (placeRef: string) => {
    setSelected(placeRef);
    const first = meals.find((meal) => mealPlaceRefs(doc, meal).includes(placeRef));
    if (first !== undefined) document.getElementById(mealRowId(first))?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <aside ref={mapBox} className="flex scroll-mt-4 flex-col gap-2 lg:sticky lg:top-6 lg:order-last lg:max-h-[calc(100vh-3rem)] lg:self-start lg:overflow-y-auto lg:[overflow-anchor:none] lg:[scrollbar-gutter:stable]">
        <PlanMap map={map} fitKey="posilki" square selected={selected} onSelect={fromMap} emptyText="Żaden posiłek nie ma jeszcze miejsca ze współrzędnymi." />
        <p className="text-xs text-zinc-500">Numery na mapie odpowiadają numerom przy posiłkach i knajpach. To samo miejsce ma zawsze ten sam numer. Kliknięcie numeru albo nazwy pokazuje je na mapie, a przy knajpie także jej dane.</p>
        {chosen && <VenueCard key={chosen.ref} tripId={tripId} place={chosen} isEatery={isEateryPlace(chosen)} canEdit={mayEdit} editing={editing} />}
      </aside>

      <section className="flex min-w-0 flex-col gap-4">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
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
          {own.meals > 0 && (
            <>
              {" "}
              🍳 Gotujecie sami: <strong>{own.meals}</strong> {pluralForm(own.meals, ["posiłek", "posiłki", "posiłków"])}, razem porcji: <strong>{people(own)}</strong>.
            </>
          )}
        </p>
        {editing ? (
          <MealEditor tripId={tripId} doc={doc} ids={ids} selection={selection} />
        ) : meals.length === 0 ? (
          <p className="text-sm text-zinc-500">W planie nie ma posiłków (punktów „jedzenie”).</p>
        ) : (
          days.map((day) => (
            <MealDaySection key={day.dayRef} day={day}>
              {day.meals.map((meal) => (
                <li key={meal.itemRef} id={mealRowId(meal)} className={mealRowClass(doc, meal, selected)}>
                  <MealHead doc={doc} meal={meal} selection={selection} />
                  {meal.selfCooked && <p className="text-xs text-zinc-500">Porcje: {people(meal.people)}</p>}
                  <MealEateries tripId={tripId} doc={doc} ids={{}} itemRef={meal.itemRef} canEdit={false} selection={selection} />
                </li>
              ))}
            </MealDaySection>
          ))
        )}
      </section>
    </div>
  );
}
