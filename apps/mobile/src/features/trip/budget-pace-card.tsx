import { BUDGET_CATEGORY, budgetPace, formatMoney, localToday, type PaceExpense, type TripDocument } from '@expeditionplan/core';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Plan a wydatki w trakcie wyjazdu (`budgetPace` w core): tempo dzienne, prognoza na koniec,
 * kategorie ponad plan i — po rozwinięciu — dzień po dniu. Plan to „do wydania” (bez pozycji
 * zapłaconych przed wyjazdem); dzień dostaje swoje pozycje i równą część wspólnych.
 */

const WEEKDAY = ['nd.', 'pon.', 'wt.', 'śr.', 'czw.', 'pt.', 'sob.'];
const short = (date: string) => `${WEEKDAY[new Date(`${date}T12:00:00Z`).getUTCDay()]} ${Number(date.slice(8))}.${date.slice(5, 7)}`;
const range = (money: (minor: number) => string, low: number, high: number) => (low === high ? money(low) : `${money(low)} – ${money(high)}`);

export function BudgetPaceCard({ doc, expenses }: { doc: TripDocument; expenses: PaceExpense[] }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const today = localToday();
  const pace = budgetPace(doc, expenses, today);
  if (pace.plannedHighMinor === 0 || pace.days.length === 0) return null;
  const money = (minor: number) => formatMoney(minor, pace.currency);
  const warn = { color: theme.primary };
  const perDay = Math.round(pace.plannedHighMinor / pace.days.length);
  const inDays = pace.spentMinor - pace.outsideMinor;
  const over = pace.categories.filter((each) => each.over);
  const forecastOver = pace.forecastMinor !== null && pace.forecastMinor > pace.plannedHighMinor;

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <ThemedText type="small" themeColor="textSecondary">
        PLAN A WYDATKI
      </ThemedText>
      <Row label="Do wydania na miejscu (plan)" value={range(money, pace.plannedLowMinor, pace.plannedHighMinor)} />
      {pace.elapsedDays > 0 ? (
        <>
          <Row label={`Średnio dziennie (${pace.elapsedDays} z ${pace.days.length} dni)`} value={`${money(Math.round(inDays / pace.elapsedDays))} / plan ${money(perDay)}`} />
          {pace.forecastMinor !== null && (
            <View style={styles.row}>
              <ThemedText type="small">Prognoza na koniec</ThemedText>
              <ThemedText type="smallBold" style={forecastOver ? warn : undefined}>
                {forecastOver ? '⚠ ' : ''}
                {money(pace.forecastMinor)}
              </ThemedText>
            </View>
          )}
          {forecastOver && (
            <ThemedText type="small" style={warn}>
              Przy tym tempie wyjdzie {money(pace.forecastMinor! - pace.plannedHighMinor)} ponad wygodny plan.
            </ThemedText>
          )}
        </>
      ) : (
        <Row label="Plan na dzień (wygodnie)" value={money(perDay)} />
      )}
      {over.map((each) => (
        <ThemedText key={each.category} type="small" style={warn}>
          ⚠ {BUDGET_CATEGORY[each.category] ?? each.category}: wydane {money(each.spentMinor)} z planu {range(money, each.plannedLowMinor, each.plannedHighMinor)}
        </ThemedText>
      ))}
      <Pressable onPress={() => setOpen(!open)} hitSlop={8}>
        <ThemedText type="linkPrimary">{open ? '▾ Ukryj dni' : '▸ Dzień po dniu'}</ThemedText>
      </Pressable>
      {open &&
        pace.days.map((day) => (
          <View key={day.dayRef} style={styles.row}>
            <ThemedText type={day.date === today ? 'smallBold' : 'small'} themeColor={day.date > today ? 'textSecondary' : undefined}>
              {short(day.date)}
              {day.date === today ? ' · dziś' : ''}
            </ThemedText>
            <ThemedText type="small" style={day.over ? warn : undefined} themeColor={day.over ? undefined : day.date > today ? 'textSecondary' : undefined}>
              {day.over ? '⚠ ' : ''}
              {day.spentMinor > 0 || day.date <= today ? `${money(day.spentMinor)} / ` : 'plan '}
              {money(day.plannedHighMinor)}
            </ThemedText>
          </View>
        ))}
      {open && pace.outsideMinor > 0 && <Row label="Poza dniami planu" value={money(pace.outsideMinor)} />}
    </ThemedView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <ThemedText type="small" style={styles.label}>
        {label}
      </ThemedText>
      <ThemedText type="smallBold">{value}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: Spacing.three, borderRadius: Spacing.three, gap: Spacing.two },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.two },
  label: { flexShrink: 1 },
});
