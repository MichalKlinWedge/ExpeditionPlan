import { type DaySchedule, formatMinutes, legLabel, nowAndNext, transitLines, type TripDocument } from '@expeditionplan/core';
import type { DayEvent } from '@expeditionplan/sync';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Button as AppButton } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { PoolNearby } from '@/features/plan/pool-nearby';
import { useTheme } from '@/hooks/use-theme';
import { itemTarget, navigate } from '@/lib/navigate';

/**
 * „Teraz / następny” na górze dzisiejszego dnia. Przyciski zapisują zdarzenia dnia (outbox, działa
 * offline) — tylko organizator i edytor; widz widzi samą kartę. „Zostajemy dłużej” +15 / +30 / +60
 * albo własna liczba minut wydłuża trwający punkt; w przerwie „Ruszamy później” wydłuża ostatni
 * zakończony (reszta dnia przesuwa się tak samo). „Cofnij” odwraca ostatnie opóźnienie, „Zrobione”
 * albo wstawienie z puli. „Nawiguj” prowadzi do następnego punktu (tryb z przejazdu w planie),
 * pod nim przejście: linia i czas drogi. Przy wolnym czasie — „Z puli w pobliżu”. Przyciski duże
 * (`big`, ≥ 48 dp) — karta jest do obsługi jedną ręką w terenie.
 */

/** Ostatnie zdarzenie z tego ekranu, które da się cofnąć. */
export type LastEvent =
  | { itemRef: string; kind: 'delay'; minutes: number }
  | { itemRef: string; kind: 'done'; title: string }
  | { itemRef: string; kind: 'pull_from_pool'; title: string };

type Props = {
  schedule: DaySchedule;
  now: number;
  /** Plan — „Nawiguj” i przejście do następnego punktu. */
  doc: TripDocument;
  /** `null` = bez przycisków zdarzeń (widz, niezalogowany); „Nawiguj” zostaje. */
  onEvent: ((itemRef: string, event: DayEvent) => void) | null;
  lastEvent: LastEvent | null;
  /** Wstawione dziś z puli — do „Z puli w pobliżu” (bez — bez tej części). */
  pulled?: readonly string[];
};

/** Wolny czas co najmniej tyle minut — dopiero wtedy proponujemy coś z puli. */
const MIN_GAP = 30;
/** Najdłuższe opóźnienie wpisane ręcznie (8 h) — dłuższe to już inny plan dnia. */
const MAX_DELAY = 480;

export function NowCard({ schedule, now, doc, onEvent, lastEvent, pulled }: Props) {
  const { current, next, leftMin, untilNextMin } = nowAndNext(schedule, now);
  // Wolny czas: przerwa przed następnym punktem albo trwający punkt „wolne”. Wstawiamy za tym,
  // co trwa, a w przerwie — za ostatnim zakończonym punktem.
  const gapMin = current === null ? untilNextMin : current.kind === 'free' ? leftMin : null;
  const lastEnded = schedule.items.filter((item) => item.end <= now).at(-1);
  const afterRef = current?.ref ?? lastEnded?.ref;
  const offerPool = onEvent !== null && pulled !== undefined && next !== null && gapMin !== null && gapMin >= MIN_GAP;
  const skip = (itemRef: string, title: string) =>
    Alert.alert('Pominąć punkt?', `„${title}” wypadnie z dzisiejszego planu, a reszta dnia się przeliczy.`, [
      { text: 'Anuluj', style: 'cancel' },
      { text: 'Pomiń', style: 'destructive', onPress: () => onEvent?.(itemRef, { kind: 'skip' }) },
    ]);
  // Opóźnienie: trwający punkt, a w przerwie — ostatni zakończony (ruszamy z niego później).
  const delayRef = current?.ref ?? (next !== null ? lastEnded?.ref : undefined);
  const delay = (minutes: number) => delayRef !== undefined && onEvent?.(delayRef, { kind: 'delay', minutes });

  const source = next === null ? undefined : doc.items.find((item) => item.ref === next.ref);
  const goTo = next === null ? null : itemTarget(doc, next.ref);
  const leg = source === undefined ? null : [transitLines(source), legLabel(source)].filter(Boolean).join(' · ') || null;

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
            <>
              <ThemedText type="small" themeColor="textSecondary">
                Zostajemy dłużej:
              </ThemedText>
              <DelayButtons onDelay={delay} />
              <View style={styles.buttons}>
                <AppButton big label="✓ Zrobione" onPress={() => onEvent(current.ref, { kind: 'done' })} />
                <AppButton big label="Pomiń" onPress={() => skip(current.ref, current.title)} />
              </View>
            </>
          )}
        </View>
      )}
      {next !== null && (
        <View style={styles.block}>
          <ThemedText type="small" themeColor="textSecondary">
            NASTĘPNY · {next.startLocal} (za {formatMinutes(untilNextMin!)})
          </ThemedText>
          <ThemedText type="smallBold">{next.title}</ThemedText>
          {leg && (
            <ThemedText type="small" themeColor="textSecondary">
              {leg}
            </ThemedText>
          )}
          {current === null && onEvent && delayRef !== undefined && (
            <>
              <ThemedText type="small" themeColor="textSecondary">
                Ruszamy później:
              </ThemedText>
              <DelayButtons onDelay={delay} />
            </>
          )}
          <View style={styles.buttons}>
            {goTo !== null && <AppButton big variant="primary" label={`Nawiguj: ${goTo.name}`} onPress={() => navigate(goTo, goTo.mode)} style={styles.shrink} />}
            {onEvent && <AppButton big label="Pomiń" onPress={() => skip(next.ref, next.title)} />}
          </View>
        </View>
      )}
      {offerPool && (
        <PoolNearby doc={doc} gapMin={gapMin} pulled={pulled!} onPull={(itemRef) => onEvent!(itemRef, { kind: 'pull_from_pool', ...(afterRef ? { afterRef } : {}) })} />
      )}
      {onEvent && lastEvent && (
        <Pressable
          onPress={() =>
            onEvent(
              lastEvent.itemRef,
              lastEvent.kind === 'delay' ? { kind: 'delay', minutes: -lastEvent.minutes } : lastEvent.kind === 'done' ? { kind: 'done', undo: true } : { kind: 'pull_from_pool', undo: true },
            )
          }
          hitSlop={12}
          style={styles.undo}>
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

/** +15 / +30 / +60 i „Inne…” — pole na liczbę minut (Android nie ma `Alert.prompt`). */
function DelayButtons({ onDelay }: { onDelay: (minutes: number) => void }) {
  const theme = useTheme();
  const [custom, setCustom] = useState<string | null>(null);
  const minutes = custom === null ? NaN : Number(custom.replace(',', '.'));
  const valid = Number.isInteger(minutes) && minutes > 0 && minutes <= MAX_DELAY;
  return (
    <View style={styles.block}>
      <View style={styles.buttons}>
        {[15, 30, 60].map((each) => (
          <AppButton key={each} big label={`+${each} min`} onPress={() => onDelay(each)} />
        ))}
        <AppButton big variant={custom === null ? 'secondary' : 'accent'} label="Inne…" onPress={() => setCustom(custom === null ? '' : null)} />
      </View>
      {custom !== null && (
        <View style={styles.custom}>
          <TextInput
            value={custom}
            onChangeText={setCustom}
            keyboardType="number-pad"
            autoFocus
            placeholder="minuty"
            placeholderTextColor={theme.textSecondary}
            style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
          />
          <AppButton
            big
            variant="primary"
            label={valid ? `+${minutes} min` : 'Dodaj'}
            disabled={!valid}
            onPress={() => {
              onDelay(minutes);
              setCustom(null);
            }}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: Spacing.three, borderRadius: Spacing.three, gap: Spacing.three },
  block: { gap: Spacing.two },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  custom: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  input: { borderWidth: 1.5, borderRadius: 12, minHeight: 48, minWidth: 96, paddingHorizontal: Spacing.three, fontSize: 18 },
  shrink: { flexShrink: 1 },
  undo: { paddingVertical: Spacing.two },
});
