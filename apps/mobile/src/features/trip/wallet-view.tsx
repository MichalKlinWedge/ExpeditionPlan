import { BUDGET_CATEGORY, budgetSummary, formatMoney, parseMoney, walletSummary } from '@expeditionplan/core';
import { type CachedTrip, saveExpense } from '@expeditionplan/sync';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Chip } from '@/components/chip';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { localDb } from '@/lib/local-db';

/**
 * Budżet i portfel wyjazdu na telefonie: „zapłacone / do wydania” z planu, wydatki z trasy
 * i szybkie „Dodaj wydatek” — zapis do outboxa, więc działa bez sieci.
 */

type Props = {
  trip: CachedTrip;
  tripId: string;
  /** Prawo dodawania wydatków (`trip_members.can_add_expenses`, organizator zawsze). */
  canAdd: boolean;
  /** Po zapisie: odświeżenie stanu z telefonu i wysyłka. */
  onChanged: () => void;
};

type ExpenseRow = { id: string; amount_minor: number; currency: string; category: string; note: string | null; paid_at: string; payer_traveler_id: string | null };

const when = (iso: string) => new Date(iso).toLocaleString('pl-PL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function WalletView({ trip, tripId, canAdd, onChanged }: Props) {
  const doc = trip.state.doc;
  const budget = budgetSummary(doc);
  const expenses = [...(trip.live.expenses as unknown as ExpenseRow[])].sort((a, b) => b.paid_at.localeCompare(a.paid_at));
  const wallet = walletSummary(
    doc,
    expenses.map((each) => ({ amountMinor: Number(each.amount_minor), currency: each.currency, category: each.category })),
  );
  const money = (minor: number) => formatMoney(minor, budget.currency);
  const names = new Map(trip.live.travelers.map((row) => [row.id, row.name as string]));
  const [adding, setAdding] = useState(false);

  return (
    <View style={styles.stack}>
      <ThemedView type="backgroundElement" style={styles.card}>
        <ThemedText type="small" themeColor="textSecondary">
          BUDŻET Z PLANU
        </ThemedText>
        {doc.budgetLines.length === 0 ? (
          <ThemedText type="small">Plan nie ma pozycji budżetu — dodaj je na webie.</ThemedText>
        ) : (
          <>
            <Row label="Zapłacone" value={money(budget.paidMinor)} />
            <Row label="Do wydania" value={range(money, budget.toSpendLowMinor, budget.toSpendHighMinor)} />
            <Row label="Razem" value={range(money, budget.totalLowMinor, budget.totalHighMinor)} />
            {budget.perPersonLowMinor !== null && <Row label="Na osobę" value={range(money, budget.perPersonLowMinor, budget.perPersonHighMinor!)} />}
          </>
        )}
      </ThemedView>

      <ThemedView type="backgroundElement" style={styles.card}>
        <ThemedText type="small" themeColor="textSecondary">
          PORTFEL — WYDANE NA MIEJSCU
        </ThemedText>
        <Row label={`Wydane (${wallet.count})`} value={money(wallet.spentMinor)} />
        {doc.budgetLines.length > 0 && (
          <Row
            label="Zostało z „do wydania”"
            value={range(money, budget.toSpendLowMinor - wallet.spentMinor, budget.toSpendHighMinor - wallet.spentMinor)}
          />
        )}
        {Object.entries(wallet.unconverted).map(([currency, minor]) => (
          <Row key={currency} label="Bez kursu w planie" value={formatMoney(minor, currency)} />
        ))}
        {Object.entries(wallet.byCategory)
          .sort((a, b) => b[1] - a[1])
          .map(([category, minor]) => (
            <ThemedText key={category} type="small" themeColor="textSecondary">
              {BUDGET_CATEGORY[category] ?? category}: {money(minor)}
            </ThemedText>
          ))}
      </ThemedView>

      {canAdd && !adding && (
        <Pressable onPress={() => setAdding(true)} hitSlop={8}>
          <ThemedText type="linkPrimary">+ Dodaj wydatek</ThemedText>
        </Pressable>
      )}
      {canAdd && adding && (
        <ExpenseForm
          trip={trip}
          onCancel={() => setAdding(false)}
          onSave={(expense) => {
            saveExpense(localDb, { tripId, ...expense });
            setAdding(false);
            onChanged();
          }}
        />
      )}

      {expenses.map((expense) => (
        <ThemedView key={expense.id} type="backgroundElement" style={styles.expense}>
          <View style={styles.row}>
            <ThemedText type="smallBold">{formatMoney(Number(expense.amount_minor), expense.currency)}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {when(expense.paid_at)}
            </ThemedText>
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            {BUDGET_CATEGORY[expense.category] ?? expense.category}
            {expense.payer_traveler_id ? ` · płacił(a): ${names.get(expense.payer_traveler_id) ?? '?'}` : ''}
            {expense.note ? ` · ${expense.note}` : ''}
          </ThemedText>
        </ThemedView>
      ))}
    </View>
  );
}

const range = (money: (minor: number) => string, low: number, high: number) => (low === high ? money(low) : `${money(low)} – ${money(high)}`);

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <ThemedText type="small">{label}</ThemedText>
      <ThemedText type="smallBold">{value}</ThemedText>
    </View>
  );
}

type NewExpense = { amountMinor: number; currency: string; category: string; payerTravelerId: string | null; note: string | null };

function ExpenseForm({ trip, onCancel, onSave }: { trip: CachedTrip; onCancel: () => void; onSave: (expense: NewExpense) => void }) {
  const theme = useTheme();
  const doc = trip.state.doc;
  const currencies = [doc.trip.baseCurrency, ...doc.trip.fx.map((each) => each.currency)];
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState(currencies[0]!);
  const [category, setCategory] = useState('food');
  const [payer, setPayer] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const input = [styles.input, { color: theme.text, borderColor: theme.backgroundSelected }];

  const save = () => {
    const minor = parseMoney(amount);
    if (minor === null || minor === 0) return Alert.alert('Kwota', 'Podaj kwotę, np. 45 albo 12,50.');
    onSave({ amountMinor: minor, currency, category, payerTravelerId: payer, note: note.trim() || null });
  };

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <ThemedText type="smallBold">Nowy wydatek</ThemedText>
      <TextInput value={amount} onChangeText={setAmount} style={input} placeholder="Kwota" placeholderTextColor={theme.textSecondary} keyboardType="decimal-pad" autoFocus />
      <View style={styles.wrap}>
        {currencies.map((each) => (
          <Chip key={each} active={currency === each} label={each} onPress={() => setCurrency(each)} />
        ))}
      </View>
      <View style={styles.wrap}>
        {Object.entries(BUDGET_CATEGORY).map(([key, name]) => (
          <Chip key={key} active={category === key} label={name} onPress={() => setCategory(key)} />
        ))}
      </View>
      {trip.live.travelers.length > 0 && (
        <>
          <ThemedText type="small" themeColor="textSecondary">
            Kto płacił
          </ThemedText>
          <View style={styles.wrap}>
            <Chip active={payer === null} label="nie wiem" onPress={() => setPayer(null)} />
            {trip.live.travelers.map((row) => (
              <Chip key={row.id} active={payer === row.id} label={row.name as string} onPress={() => setPayer(row.id)} />
            ))}
          </View>
        </>
      )}
      <TextInput value={note} onChangeText={setNote} style={input} placeholder="Notatka (opcjonalnie)" placeholderTextColor={theme.textSecondary} />
      <View style={styles.row}>
        <Pressable onPress={onCancel} hitSlop={8}>
          <ThemedText type="linkPrimary">Anuluj</ThemedText>
        </Pressable>
        <Pressable onPress={save} hitSlop={8}>
          <ThemedText type="linkPrimary">Zapisz wydatek</ThemedText>
        </Pressable>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  stack: { gap: Spacing.three },
  card: { padding: Spacing.three, borderRadius: Spacing.three, gap: Spacing.two },
  expense: { padding: Spacing.three, borderRadius: Spacing.two, gap: Spacing.half },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.two },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  input: { borderWidth: 1, borderRadius: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, fontSize: 16 },
});
