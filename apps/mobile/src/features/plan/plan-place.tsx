import { dayLabel, itemInPlan, type PlanItem as Item, type Scenario, variantsForItem } from '@expeditionplan/core';
import type { CachedTrip } from '@expeditionplan/sync';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

/** Wybór z planu: scenariusz i warianty — szczegóły punktu liczą godziny i sąsiadów tak samo. */
export type PlanChoice = { scenario?: Scenario; variants?: Record<string, string> };

/**
 * Punkt w planie (szczegóły punktu): dzień i godziny z silnika — te same co w planie, dla wybranego
 * wariantu (punkt innego wariantu liczy się z jego wariantem) — ostrzeżenia i przejście do
 * poprzedniego i następnego punktu w kolejności planu, także przez dni (`core/item-plan.ts`).
 */
export function PlanPlace({ trip, item, plan, onJump }: { trip: CachedTrip; item: Item; plan?: PlanChoice; onJump: (ref: string) => void }) {
  const { doc, inputs } = trip.state;
  const day = doc.days.find((each) => each.ref === item.dayRef);
  const forItem = variantsForItem(doc, item, { ...inputs.activeVariants, ...plan?.variants });
  const at = itemInPlan(doc, item.ref, { scenario: plan?.scenario, activeVariants: forItem.variants, delays: inputs.delays, skipRefs: inputs.skipRefs, done: inputs.done, pulled: inputs.pulled });
  const scheduled = at.scheduled;
  const switched = forItem.switched === undefined ? undefined : doc.variants.find((each) => each.ref === forItem.switched!.variantRef)?.label;
  const dayNumber = (dayRef: string) => doc.days.findIndex((each) => each.ref === dayRef) + 1;
  const other = (dayRef: string) => (dayRef === item.dayRef ? '' : `Dzień ${dayNumber(dayRef)}: `);
  if (day === undefined && at.previous === undefined && at.next === undefined) return null;
  const time =
    scheduled === undefined
      ? null
      : scheduled.routeStop
        ? `postój ${scheduled.durationMin} min w trakcie przejazdu`
        : `${scheduled.startLocal}–${scheduled.endLocal}${scheduled.endDate !== day?.date ? ' (+1)' : ''}`;

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      {day !== undefined && (
        <ThemedText type="small" themeColor="textSecondary">
          Dzień {dayNumber(day.ref)}, {dayLabel(day.date)}
        </ThemedText>
      )}
      {time !== null && <ThemedText type="smallBold">{time}</ThemedText>}
      {scheduled?.statedLocal !== undefined && scheduled.driftMin > 15 && (
        <ThemedText type="small" themeColor="textSecondary">
          plan mówi {scheduled.statedLocal}, wychodzi +{scheduled.driftMin} min
        </ThemedText>
      )}
      {day !== undefined && scheduled === undefined && (
        <ThemedText type="small" themeColor="textSecondary">
          Punkt nie wchodzi do wyliczeń dnia (pominięty albo wyłączony przez wybrany wariant).
        </ThemedText>
      )}
      {switched !== undefined && (
        <ThemedText type="small" themeColor="textSecondary">
          Wybrany jest inny wariant — godziny i kolejność wg wariantu „{switched}”, do którego należy ten punkt.
        </ThemedText>
      )}
      {at.warnings.map((warning, i) => (
        <ThemedText key={i} type="small" style={warning.severity === 'hard' ? styles.hard : styles.soft}>
          {warning.severity === 'hard' ? '⚠ ' : '· '}
          {warning.message}
        </ThemedText>
      ))}
      {(at.previous !== undefined || at.next !== undefined) && (
        <View style={styles.steps}>
          {at.previous ? <Button small label={`‹ ${other(at.previous.dayRef)}${at.previous.title}`} onPress={() => onJump(at.previous!.ref)} style={styles.step} /> : <View style={styles.step} />}
          {at.next ? <Button small label={`${other(at.next.dayRef)}${at.next.title} ›`} onPress={() => onJump(at.next!.ref)} style={styles.step} /> : <View style={styles.step} />}
        </View>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, padding: Spacing.three, gap: Spacing.one },
  steps: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.one },
  step: { flex: 1 },
  hard: { color: '#dc2626' },
  soft: { color: '#d97706' },
});
