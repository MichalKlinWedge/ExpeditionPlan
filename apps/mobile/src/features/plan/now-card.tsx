import { type DaySchedule, formatMinutes, nowAndNext, type TripDocument } from '@expeditionplan/core';
import type { DayEvent } from '@expeditionplan/sync';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { Button as AppButton } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { PoolNearby } from '@/features/plan/pool-nearby';

/**
 * „Teraz / następny” na górze dzisiejszego dnia. Przyciski zapisują zdarzenia dnia (outbox, działa
 * offline) — tylko organizator i edytor; widz widzi samą kartę. „Cofnij” odwraca ostatnie opóźnienie,
 * „Zrobione” albo wstawienie z puli. Przy wolnym czasie (przerwa przed następnym punktem albo punkt
 * „wolne”) — „Z puli w pobliżu”.
 */

/** Ostatnie zdarzenie z tego ekranu, które da się cofnąć. */
export type LastEvent =
  | { itemRef: string; kind: 'delay'; minutes: number }
  | { itemRef: string; kind: 'done'; title: string }
  | { itemRef: string; kind: 'pull_from_pool'; title: string };

type Props = {
  schedule: DaySchedule;
  now: number;
  /** `null` = bez przycisków (widz, niezalogowany). */
  onEvent: ((itemRef: string, event: DayEvent) => void) | null;
  lastEvent: LastEvent | null;
  /** Plan i wstawione dziś z puli — do „Z puli w pobliżu” (bez — bez tej części). */
  pool?: { doc: TripDocument; pulled: readonly string[] };
};

/** Wolny czas co najmniej tyle minut — dopiero wtedy proponujemy coś z puli. */
const MIN_GAP = 30;


export function NowCard({ schedule, now, onEvent, lastEvent, pool }: Props) {
  const { current, next, leftMin, untilNextMin } = nowAndNext(schedule, now);
  // Wolny czas: przerwa przed następnym punktem albo trwający punkt „wolne”. Wstawiamy za tym,
  // co trwa, a w przerwie — za ostatnim zakończonym punktem.
  const gapMin = current === null ? untilNextMin : current.kind === 'free' ? leftMin : null;
  const lastEnded = schedule.items.filter((item) => item.end <= now).at(-1);
  const afterRef = current?.ref ?? lastEnded?.ref;
  const offerPool = onEvent !== null && pool !== undefined && next !== null && gapMin !== null && gapMin >= MIN_GAP;
  const skip = (itemRef: string, title: string) =>
    Alert.alert('Pominąć punkt?', `„${title}” wypadnie z dzisiejszego planu, a reszta dnia się przeliczy.`, [
      { text: 'Anuluj', style: 'cancel' },
      { text: 'Pomiń', style: 'destructive', onPress: () => onEvent?.(itemRef, { kind: 'skip' }) },
    ]);

  if (current === null && next === null) {
    return (
      <ThemedView type="backgroundElement" style={styles.card}>
        <ThemedText type="small" themeColor="textSecondary">
          Na dziś wszystko z planu za wami.
        </ThemedText>
      </ThemedView>
    );
  }

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      {current !== null && (
        <View style={styles.block}>
          <ThemedText type="small" themeColor="textSecondary">
            TERAZ · do {current.endLocal} (zostało {formatMinutes(leftMin!)})
          </ThemedText>
          <ThemedText type="smallBold">{current.title}</ThemedText>
          {onEvent && (
            <View style={styles.buttons}>
              <Action label="+15 min" onPress={() => onEvent(current.ref, { kind: 'delay', minutes: 15 })} />
              <Action label="+30 min" onPress={() => onEvent(current.ref, { kind: 'delay', minutes: 30 })} />
              <Action label="✓ Zrobione" onPress={() => onEvent(current.ref, { kind: 'done' })} />
              <Action label="Pomiń" onPress={() => skip(current.ref, current.title)} />
            </View>
          )}
        </View>
      )}
      {next !== null && (
        <View style={styles.block}>
          <ThemedText type="small" themeColor="textSecondary">
            NASTĘPNY · {next.startLocal} (za {formatMinutes(untilNextMin!)})
          </ThemedText>
          <ThemedText type="smallBold">{next.title}</ThemedText>
          {onEvent && (
            <View style={styles.buttons}>
              <Action label="Pomiń" onPress={() => skip(next.ref, next.title)} />
            </View>
          )}
        </View>
      )}
      {offerPool && (
        <PoolNearby doc={pool!.doc} gapMin={gapMin} pulled={pool!.pulled} onPull={(itemRef) => onEvent!(itemRef, { kind: 'pull_from_pool', ...(afterRef ? { afterRef } : {}) })} />
      )}
      {onEvent && lastEvent && (
        <Pressable
          onPress={() =>
            onEvent(
              lastEvent.itemRef,
              lastEvent.kind === 'delay' ? { kind: 'delay', minutes: -lastEvent.minutes } : lastEvent.kind === 'done' ? { kind: 'done', undo: true } : { kind: 'pull_from_pool', undo: true },
            )
          }
          hitSlop={8}>
          <ThemedText type="linkPrimary">
            {lastEvent.kind === 'delay'
              ? `Cofnij +${lastEvent.minutes} min`
              : lastEvent.kind === 'done'
                ? `Cofnij „Zrobione” (${lastEvent.title})`
                : `Cofnij wstawienie z puli (${lastEvent.title})`}
          </ThemedText>
        </Pressable>
      )}
    </ThemedView>
  );
}

function Action({ label, onPress }: { label: string; onPress: () => void }) {
  return <AppButton label={label} onPress={onPress} small />;
}

const styles = StyleSheet.create({
  card: { padding: Spacing.three, borderRadius: Spacing.three, gap: Spacing.three },
  block: { gap: Spacing.one },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, paddingTop: Spacing.one },
});
