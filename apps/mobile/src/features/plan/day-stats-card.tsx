import { type DaySchedule, dayStatistics, formatMinutes, MOVE_LABEL, moveLine, plural, STAY_LABEL, stayLine, type TripDocument } from '@expeditionplan/core';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

/**
 * „Statystyki dnia” pod planem dnia (jak na webie, `core/day-stats.ts`): godziny dnia, droga i czas pieszo,
 * autem, komunikacją, czas na zwiedzanie, posiłki, wolny czas. Z tego samego przeliczenia co plan nad nią
 * (scenariusz, warianty, zgłoszenia z terenu), offline.
 */
export function DayStatsCard({ doc, schedule }: { doc: TripDocument; schedule: DaySchedule | null }) {
  const [open, setOpen] = useState(false);
  const stats = schedule === null ? null : dayStatistics(doc, schedule);
  if (stats === null || schedule === null) return null;
  const nextDay = stats.endDate !== schedule.date ? ' (następnego dnia)' : '';
  const rows: [string, string][] = [
    ['Dzień', `${stats.start} → ${stats.end}${nextDay} · ${formatMinutes(stats.spanMin)} · ${plural(stats.points, ['punkt', 'punkty', 'punktów'])}`],
    ...stats.moves.map((move): [string, string] => [MOVE_LABEL[move.kind], moveLine(move)]),
    ...stats.stays.map((stay): [string, string] => [STAY_LABEL[stay.kind], stayLine(stay)]),
    ...(stats.freeMin > 0 ? [['Wolny czas', `${formatMinutes(stats.freeMin)} · ${plural(stats.freeCount, ['przerwa', 'przerwy', 'przerw'])} od 15 min`] as [string, string]] : []),
    ...(stats.bufferMin > 0 ? [['Zapasy po punktach', formatMinutes(stats.bufferMin)] as [string, string]] : []),
  ];
  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <Pressable onPress={() => setOpen(!open)} hitSlop={8}>
        <ThemedText type="linkPrimary">{open ? '▾' : '▸'} Statystyki dnia</ThemedText>
      </Pressable>
      {open && (
        <>
          {rows.map(([label, value]) => (
            <View key={label} style={styles.row}>
              <ThemedText type="smallBold">{label}</ThemedText>
              <ThemedText type="small">{value}</ThemedText>
            </View>
          ))}
          <ThemedText type="small" themeColor="textSecondary">
            Czasy jak w planie powyżej ({schedule.scenario === 'pessimistic' ? 'scenariusz pesymistyczny' : 'scenariusz optymistyczny'}, wybrane warianty, zgłoszenia z terenu). Odcinek „bez km” nie ma dystansu w planie.
          </ThemedText>
        </>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  card: { padding: Spacing.three, borderRadius: 14, gap: Spacing.two },
  row: { gap: 2 },
});
