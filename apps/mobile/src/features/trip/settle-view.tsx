import { formatMoney, type FxRate, settle, settleInputFromRows, toBase } from '@expeditionplan/core';
import { type CachedTrip, recordSettlement } from '@expeditionplan/sync';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Chip } from '@/components/chip';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { localDb } from '@/lib/local-db';

/**
 * Rozliczenie „kto komu ile” w portfelu (offline, `settle` z packages/core): salda osób albo
 * rodzin i najmniej przelewów do wyrównania. „Oddane” zapisuje przelew (outbox) — organizator
 * i edytor. Podziały i przelewy wprost z bazy telefonu (tabele `expense_splits`, `settlements`).
 */

type Row = Record<string, unknown> & { id: string; deleted_at?: string | null };
const rowsOf = (tripId: string, table: string): Row[] =>
  localDb
    .all<{ data: string }>('select data from rows where tbl = ? and trip_id = ?', [table, tripId])
    .map((row) => JSON.parse(row.data) as Row)
    .filter((row) => row.deleted_at === null || row.deleted_at === undefined);

export function SettleView({ trip, tripId, canEdit, fx, onChanged }: { trip: CachedTrip; tripId: string; canEdit: boolean; fx: FxRate[]; onChanged: () => void }) {
  const theme = useTheme();
  const [households, setHouseholds] = useState(false);
  const doc = { ...trip.state.doc, trip: { ...trip.state.doc.trip, fx } };
  const input = settleInputFromRows({ travelers: trip.live.travelers, expenses: trip.live.expenses as Row[], splits: rowsOf(tripId, 'expense_splits'), payments: rowsOf(tripId, 'settlements') });
  const { travelers, expenses } = input;
  if (travelers.length < 2) return null;
  if (expenses.length === 0) return null;
  const result = settle({ ...input, toBase: (amount, currency) => toBase(doc, amount, currency), households });
  const money = (minor: number) => formatMoney(minor, doc.trip.baseCurrency);
  const hasHouseholds = travelers.some((each) => each.household);
  // Przelew zapisuje się między dorosłymi: pierwszy członek strony bez opiekuna.
  const adultOf = (members: string[]) => members.find((id) => !travelers.find((each) => each.id === id)?.guardianId) ?? members[0]!;
  const noPayer = result.skipped.filter((each) => each.reason === 'no_payer').length;
  const noRate = result.skipped.filter((each) => each.reason === 'no_rate').length;

  return (
    <ThemedView type="backgroundElement" style={[styles.card, { borderColor: theme.backgroundSelected }]}>
      <ThemedText type="small" themeColor="textSecondary">
        ROZLICZENIE — KTO KOMU ILE
      </ThemedText>
      {hasHouseholds && (
        <View style={styles.wrap}>
          <Chip active={!households} label="osobno" onPress={() => setHouseholds(false)} />
          <Chip active={households} label="rodzinami" onPress={() => setHouseholds(true)} />
        </View>
      )}
      {result.parties.map((party) => (
        <View key={party.key} style={styles.row}>
          <ThemedText type="small" style={styles.grow}>
            {party.name}
            <ThemedText type="small" themeColor="textSecondary">
              {' '}
              · zapłacił(a) {money(party.paidMinor)} · udział {money(party.shareMinor)}
            </ThemedText>
          </ThemedText>
          <ThemedText type="smallBold" style={{ color: party.balanceMinor >= 0 ? theme.accent : theme.primary }}>
            {party.balanceMinor >= 0 ? '+' : ''}
            {money(party.balanceMinor)}
          </ThemedText>
        </View>
      ))}
      {result.transfers.length === 0 ? (
        <ThemedText type="smallBold" themeColor="accent">
          Wszystko wyrównane.
        </ThemedText>
      ) : (
        result.transfers.map((transfer) => (
          <View key={`${transfer.from.key}>${transfer.to.key}`} style={styles.row}>
            <ThemedText type="smallBold" style={styles.grow}>
              {transfer.from.name} → {transfer.to.name}: {money(transfer.amountMinor)}
            </ThemedText>
            {canEdit && (
              <Button
                label="Oddane"
                small
                onPress={() =>
                  Alert.alert('Zapisać przelew?', `${transfer.from.name} oddał(a) ${transfer.to.name} ${money(transfer.amountMinor)}.`, [
                    { text: 'Anuluj', style: 'cancel' },
                    {
                      text: 'Zapisz',
                      onPress: () => {
                        recordSettlement(localDb, { tripId, fromId: adultOf(transfer.from.members), toId: adultOf(transfer.to.members), amountMinor: transfer.amountMinor, currency: doc.trip.baseCurrency });
                        onChanged();
                      },
                    },
                  ])
                }
              />
            )}
          </View>
        ))
      )}
      {(noPayer > 0 || noRate > 0) && (
        <ThemedText type="small" themeColor="textSecondary">
          Poza rozliczeniem: {[noPayer > 0 ? `${noPayer} bez płacącego (dotknij wydatku, żeby uzupełnić)` : null, noRate > 0 ? `${noRate} bez kursu waluty` : null].filter(Boolean).join(' · ')}
        </ThemedText>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  card: { padding: Spacing.three, borderRadius: 16, gap: Spacing.two, borderWidth: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  grow: { flex: 1 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
});
