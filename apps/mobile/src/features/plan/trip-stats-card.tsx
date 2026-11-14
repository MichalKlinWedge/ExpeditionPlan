import { activeVariants, type DaySchedule, dayVariantLabels, formatKm, formatMinutes, MOVE_LABEL, moveLine, plural, scheduleDay, type Scenario, shortDate, STAY_LABEL, stayLine, tripStatistics } from '@expeditionplan/core';
import type { TripState } from '@expeditionplan/sync';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

/**
 * „Statystyki wyjazdu” na telefonie (jak na stronie wyjazdu na webie, `core/day-stats.ts` `tripStatistics`):
 * suma statystyk dni z wariantami i scenariuszem wybranymi na ekranie planu, ze zgłoszeniami z terenu. Offline.
 */
export function TripStatsCard({ state, variants, scenario }: { state: TripState; variants: Record<string, string>; scenario: Scenario }) {
  const [open, setOpen] = useState(false);
  const { doc, inputs } = state;
  const stats = useMemo(() => {
    if (!open) return null;
    const options = { scenario, activeVariants: variants, delays: inputs.delays, skipRefs: inputs.skipRefs, done: inputs.done, pulled: inputs.pulled };
    const schedules = doc.days.flatMap((day): DaySchedule[] => {
      try {
        return [scheduleDay(doc, day.ref, options)];
      } catch {
        return [];
      }
    });
    return tripStatistics(doc, schedules);
  }, [open, doc, inputs, variants, scenario]);
  if (doc.days.length === 0) return null;
  const active = activeVariants(doc, variants);
  const chosen = doc.days.reduce((sum, day) => sum + dayVariantLabels(doc, day.ref, active).length, 0);
  const rows: [string, string][] =
    stats === null
      ? []
      : [
          ['Wyjazd', `${plural(stats.days, ['dzień', 'dni', 'dni'])} · ${plural(stats.points, ['punkt', 'punkty', 'punktów'])}${stats.movingMin > 0 ? ` · w drodze ${formatMinutes(stats.movingMin)}` : ''}`],
          ...stats.moves.map((move): [string, string] => [MOVE_LABEL[move.kind], moveLine(move)]),
          ...stats.stays.map((stay): [string, string] => [STAY_LABEL[stay.kind], stayLine(stay)]),
          ...(stats.freeMin > 0 ? [['Wolny czas', formatMinutes(stats.freeMin)] as [string, string]] : []),
          ...(stats.longestDay ? [['Najdłuższy dzień', `${shortDate(stats.longestDay.date)} · ${formatMinutes(stats.longestDay.spanMin)}`] as [string, string]] : []),
          ...(stats.mostFoot ? [['Najwięcej pieszo', `${shortDate(stats.mostFoot.date)} · ${formatKm(stats.mostFoot.km)}`] as [string, string]] : []),
          ...(stats.mostAscent ? [['Największe podejście', `${shortDate(stats.mostAscent.date)} · ↑ ${stats.mostAscent.ascentM} m`] as [string, string]] : []),
        ];
  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <Pressable onPress={() => setOpen(!open)} hitSlop={8}>
        <ThemedText type="linkPrimary">{open ? '▾' : '▸'} Statystyki wyjazdu</ThemedText>
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
            Suma statystyk dni ({scenario === 'pessimistic' ? 'scenariusz pesymistyczny' : 'scenariusz optymistyczny'}, zgłoszenia z terenu){chosen > 0 ? `, z wariantami wybranymi w planie (${plural(chosen, ['wybór', 'wybory', 'wyborów'])})` : ''}. Odcinek „bez km” nie ma dystansu w planie. Statystyki dnia są pod jego planem.
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
