import {
  dayLabel,
  headcount,
  mealDays,
  mealEateries,
  mealList,
  mealTime,
  pluralForm,
  selfCookedTotals,
} from "@expeditionplan/core";
import type { CachedTrip } from "@expeditionplan/sync";
import { Pressable, StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";
import { PlacePin } from "@/features/plan/place-pin";

/**
 * Posiłki na telefonie, offline: dzień po dniu, z przypiętymi knajpami (✓ = wybrana w „gdzie jemy?”), jak lista na
 * webowych „Posiłkach”, ale bez mapy. Dotknięcie posiłku otwiera jego szczegóły. Posiłki z niewybranych wariantów są
 * na liście, ale nie liczą się do porcji (`selfCookedTotals`). Pinezka przy knajpie (i miejscu posiłku bez knajp)
 * otwiera je w Mapach Google.
 */

const people = (each: { adults: number; children: number }) =>
  `${each.adults} dor.${each.children > 0 ? ` + ${each.children} dz.` : ""}`;

/** `focusRef` + `onFocusAt`: przejście ze szczegółów posiłku, lista przewija się do niego. */
export function MealsView({
  trip,
  focusRef,
  onFocusAt,
  onOpenItem,
}: {
  trip: CachedTrip;
  focusRef?: string | null;
  onFocusAt?: (y: number) => void;
  onOpenItem: (itemRef: string) => void;
}) {
  const doc = trip.state.doc;
  const placeOf = (ref: string | undefined) =>
    ref === undefined
      ? undefined
      : doc.places.find((place) => place.ref === ref);
  const meals = mealList(doc, { allVariants: true });
  const days = mealDays(doc, meals);
  const own = selfCookedTotals(meals);

  if (meals.length === 0) {
    return (
      <ThemedText themeColor="textSecondary">
        Plan nie ma jeszcze posiłków. Na webie: „Posiłki” → „Edytuj”.
      </ThemedText>
    );
  }

  return (
    <View style={styles.list}>
      <ThemedText type="small" themeColor="textSecondary">
        {doc.travelers.length > 0
          ? `Na posiłek: ${people(headcount(doc))}.`
          : "Brak uczestników."}
        {own.meals > 0
          ? ` Gotujemy sami: ${own.meals} ${pluralForm(own.meals, ["posiłek", "posiłki", "posiłków"])}, porcje ${people(own)}.`
          : ""}
      </ThemedText>
      {days.flatMap((day) => [
        <ThemedText key={day.dayRef} type="smallBold" style={styles.day}>
          Dzień {day.dayNo}{" "}
          <ThemedText type="small" themeColor="textSecondary">
            · {dayLabel(day.date)}
          </ThemedText>
        </ThemedText>,
        ...(day.meals.length === 0
          ? [
              <ThemedText
                key={`${day.dayRef}-empty`}
                type="small"
                themeColor="textSecondary"
              >
                Bez posiłków w planie.
              </ThemedText>,
            ]
          : []),
        ...day.meals.map((meal) => {
          const time = mealTime(doc, meal);
          const eateries = mealEateries(doc, meal.itemRef);
          const spot =
            eateries.length === 0 ? placeOf(meal.placeRef) : undefined;
          const details = [
            eateries.length === 0 && meal.place,
            meal.at &&
              `${meal.at.stop ? "postój w trasie" : "przy punkcie"}: ${meal.at.title}`,
          ]
            .filter(Boolean)
            .join(" · ");
          const variants = meal.variants ?? [];
          return (
            <Pressable
              key={meal.itemRef}
              onPress={() => onOpenItem(meal.itemRef)}
              // Dni i posiłki leżą obok siebie w jednej liście, więc `y` to położenie w całym widoku.
              onLayout={
                focusRef === meal.itemRef
                  ? (event) => onFocusAt?.(event.nativeEvent.layout.y)
                  : undefined
              }
            >
              <ThemedView type="backgroundElement" style={styles.card}>
                <ThemedText type="smallBold">
                  {meal.selfCooked ? "🍳 " : ""}
                  {meal.title}
                  {time ? (
                    <ThemedText type="small" themeColor="textSecondary">
                      {" "}
                      · {time}
                    </ThemedText>
                  ) : null}
                </ThemedText>
                {details !== "" && (
                  <View style={styles.place}>
                    <ThemedText type="small" style={styles.grow}>
                      {details}
                    </ThemedText>
                    {spot && <PlacePin place={spot} />}
                  </View>
                )}
                {eateries.map((eatery) => {
                  const place = placeOf(eatery.placeRef);
                  return (
                    <View key={eatery.placeRef} style={styles.place}>
                      <ThemedText
                        type="small"
                        style={styles.grow}
                        themeColor={
                          eatery.active || eateries.length === 1
                            ? "text"
                            : "textSecondary"
                        }
                      >
                        {eateries.length > 1 && eatery.active ? "✓ " : "· "}
                        {eatery.name}
                        {eatery.summary ? ` · ${eatery.summary}` : ""}
                      </ThemedText>
                      {place && <PlacePin place={place} />}
                    </View>
                  );
                })}
                {variants.length > 0 && (
                  <ThemedText type="small" themeColor="textSecondary">
                    {variants.length === 1 ? "Wariant" : "Warianty"}:{" "}
                    {variants.map((variant) => variant.label).join(", ")}
                    {!variants.some((variant) => variant.active) &&
                      " (niewybrany, nie liczy się do porcji)"}
                  </ThemedText>
                )}
              </ThemedView>
            </Pressable>
          );
        }),
      ])}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: Spacing.two },
  day: { marginTop: Spacing.two },
  card: { borderRadius: 12, padding: Spacing.three, gap: Spacing.half },
  place: { flexDirection: "row", alignItems: "center", gap: Spacing.two },
  grow: { flex: 1 },
});
