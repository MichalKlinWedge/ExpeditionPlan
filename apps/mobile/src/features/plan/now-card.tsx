import { type DaySchedule, nowAndNext } from '@expeditionplan/core';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { Button as AppButton } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

/**
 * „Teraz / następny” na górze dzisiejszego dnia. Przyciski zapisują zdarzenia dnia (outbox, działa
 * offline) — tylko organizator i edytor; widz widzi samą kartę. „Cofnij” odwraca ostatnie opóźnienie.
 */

export type DayEvent = { kind: 'delay'; minutes: number } | { kind: 'skip' };

type Props = {
  schedule: DaySchedule;
  now: number;
  /** `null` = bez przycisków (widz, niezalogowany). */
  onEvent: ((itemRef: string, event: DayEvent) => void) | null;
  /** Ostatnie opóźnienie z tego ekranu — do cofnięcia. */
  lastDelay: { itemRef: string; minutes: number } | null;
};

const duration = (value: number) => (value < 60 ? `${value} min` : `${Math.floor(value / 60)} h ${value % 60} min`);

export function NowCard({ schedule, now, onEvent, lastDelay }: Props) {
  const { current, next, leftMin, untilNextMin } = nowAndNext(schedule, now);
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
            TERAZ · do {current.endLocal} (zostało {duration(leftMin!)})
          </ThemedText>
          <ThemedText type="smallBold">{current.title}</ThemedText>
          {onEvent && (
            <View style={styles.buttons}>
              <Action label="+15 min" onPress={() => onEvent(current.ref, { kind: 'delay', minutes: 15 })} />
              <Action label="+30 min" onPress={() => onEvent(current.ref, { kind: 'delay', minutes: 30 })} />
              <Action label="Pomiń" onPress={() => skip(current.ref, current.title)} />
            </View>
          )}
        </View>
      )}
      {next !== null && (
        <View style={styles.block}>
          <ThemedText type="small" themeColor="textSecondary">
            NASTĘPNY · {next.startLocal} (za {duration(untilNextMin!)})
          </ThemedText>
          <ThemedText type="smallBold">{next.title}</ThemedText>
          {onEvent && (
            <View style={styles.buttons}>
              <Action label="Pomiń" onPress={() => skip(next.ref, next.title)} />
            </View>
          )}
        </View>
      )}
      {onEvent && lastDelay && (
        <Pressable onPress={() => onEvent(lastDelay.itemRef, { kind: 'delay', minutes: -lastDelay.minutes })} hitSlop={8}>
          <ThemedText type="linkPrimary">Cofnij +{lastDelay.minutes} min</ThemedText>
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
