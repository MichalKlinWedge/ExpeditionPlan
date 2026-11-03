import { formatMoney, itemIcon, type PlanItem, priceForGroup } from '@expeditionplan/core';
import type { CachedTrip } from '@expeditionplan/sync';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { itemGuide } from '@/features/plan/item-details';
import { DayPicker, KIND } from '@/features/plan/item-editor';

/**
 * Pula w Planie na telefonie: punkty poza dniami — opcje, do których można wrócić. Każdy z opisem,
 * miejscem, czasem i ceną dla grupy; dotknięcie = szczegóły z przewodnikiem (offline). Organizator
 * i edytor wstawiają punkt do dnia („Wstaw do dnia…”, online — jak inne zmiany planu z telefonu).
 */

const duration = (min: number, max?: number) => {
  const text = (value: number) => (value < 60 ? `${value} min` : `${Math.floor(value / 60)} h${value % 60 ? ` ${value % 60} min` : ''}`);
  return max !== undefined && max !== min ? `${text(min)}–${text(max)}` : text(min);
};

type Props = {
  trip: CachedTrip;
  /** `null` — podgląd (widz albo bez trybu edycji). */
  onMove: ((ref: string, dayRef: string) => void) | null;
  onOpen: (item: PlanItem) => void;
};

export function PoolView({ trip, onMove, onOpen }: Props) {
  const theme = useTheme();
  const doc = trip.state.doc;
  const [moving, setMoving] = useState<string | null>(null);
  const pool = doc.items.filter((item) => item.dayRef === undefined && item.parentRef === undefined);
  const places = new Map(doc.places.map((place) => [place.ref, place]));
  const travelers = doc.travelers.map((each) => ({ ref: each.ref, age: each.age }));
  // Obszary w kolejności pierwszego punktu (bez `Object.groupBy` — Hermes).
  const areas = new Map<string, PlanItem[]>();
  for (const item of pool) areas.set(item.area ?? '', [...(areas.get(item.area ?? '') ?? []), item]);

  return (
    <View style={styles.stack}>
      <ThemedText type="small" themeColor="textSecondary">
        Opcje spoza dni planu — można do nich wrócić i zmienić plan.{onMove ? ' „Wstaw do dnia…” przenosi punkt do wybranego dnia (wymaga internetu).' : ''}
      </ThemedText>
      {pool.length === 0 && <ThemedText type="small">Pula jest pusta — wszystkie punkty są w dniach.</ThemedText>}
      {[...areas].map(([area, items]) => (
        <View key={area} style={styles.stack}>
          {area !== '' && (
            <ThemedText type="smallBold" themeColor="textSecondary">
              {area.toUpperCase()}
            </ThemedText>
          )}
          {items.map((item) => {
            const place = places.get(item.leg?.toPlaceRef ?? item.placeRef ?? '');
            const price = item.price === undefined ? null : priceForGroup(item.price, travelers);
            const facts = [
              KIND[item.kind],
              place && place.name !== item.title ? place.name : null,
              item.durationMin !== undefined ? duration(item.durationMin, item.durationMaxMin) : null,
              price === null ? null : `${price.approx ? 'ok. ' : ''}${price.minMinor === price.maxMinor ? formatMoney(price.minMinor, price.currency) : `${formatMoney(price.minMinor, price.currency)}–${formatMoney(price.maxMinor, price.currency)}`} dla grupy`,
            ].filter(Boolean);
            return (
              <ThemedView key={item.ref} type="backgroundElement" style={styles.card}>
                <Pressable onPress={() => onOpen(item)} hitSlop={4} style={styles.body}>
                  <ThemedText type="smallBold">
                    {itemIcon(doc, item)} {item.title}
                    {itemGuide(trip, item) !== null ? <ThemedText type="small" themeColor="accent">{'  '}📖 opis</ThemedText> : null}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {facts.join(' · ')}
                  </ThemedText>
                  {item.description && (
                    <ThemedText type="small" numberOfLines={4}>
                      {item.description}
                    </ThemedText>
                  )}
                  {item.notes.slice(0, 2).map((note, i) => (
                    <ThemedText key={i} type="small" themeColor="textSecondary" numberOfLines={2}>
                      • {note}
                    </ThemedText>
                  ))}
                </Pressable>
                <View style={[styles.actions, { borderTopColor: theme.backgroundSelected }]}>
                  <Button small label="Szczegóły" onPress={() => onOpen(item)} />
                  {onMove && <Button small variant="primary" label="Wstaw do dnia…" onPress={() => setMoving(item.ref)} />}
                </View>
              </ThemedView>
            );
          })}
        </View>
      ))}
      {onMove && (
        <DayPicker
          doc={doc}
          current=""
          visible={moving !== null}
          onCancel={() => setMoving(null)}
          onPick={(dayRef) => {
            if (moving !== null && dayRef !== null) onMove(moving, dayRef);
            setMoving(null);
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: Spacing.two },
  card: { padding: Spacing.three, borderRadius: Spacing.three, gap: Spacing.two },
  body: { gap: Spacing.half },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: Spacing.two },
});
