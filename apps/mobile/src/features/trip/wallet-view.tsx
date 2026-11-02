import { BUDGET_CATEGORY, budgetSummary, formatMoney, parseMoney, walletSummary } from '@expeditionplan/core';
import { type CachedTrip, type NewExpense, removeExpense, saveExpense } from '@expeditionplan/sync';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '@/components/button';
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
  /** Organizator i edytor poprawiają każdy wydatek; pozostali tylko własne (RLS `expenses_update`). */
  canEditAll: boolean;
  userId: string | null;
  /** Po zapisie: odświeżenie stanu z telefonu i wysyłka. */
  onChanged: () => void;
};

type ExpenseRow = {
  id: string;
  amount_minor: number;
  currency: string;
  category: string;
  note: string | null;
  paid_at: string;
  payer_traveler_id: string | null;
  item_id?: string | null;
  created_by?: string | null;
};

const asExpense = (tripId: string, row: ExpenseRow): NewExpense & { id: string } => ({
  tripId,
  id: row.id,
  amountMinor: Number(row.amount_minor),
  currency: row.currency,
  category: row.category,
  payerTravelerId: row.payer_traveler_id,
  itemId: row.item_id ?? null,
  note: row.note,
  paidAt: row.paid_at,
});

const when = (iso: string) => new Date(iso).toLocaleString('pl-PL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function WalletView({ trip, tripId, canAdd, canEditAll, userId, onChanged }: Props) {
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
  const [editing, setEditing] = useState<string | null>(null);
  // Wydatek bez `created_by` dodano na tym telefonie i jeszcze nie wrócił z serwera — jest „mój”.
  const mine = (row: ExpenseRow) => row.created_by === undefined || row.created_by === null || row.created_by === userId;
  const canChange = (row: ExpenseRow) => canEditAll || (canAdd && mine(row));

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

      {expenses.map((expense) =>
        editing === expense.id ? (
          <ExpenseForm
            key={expense.id}
            trip={trip}
            initial={expense}
            onCancel={() => setEditing(null)}
            onSave={(changed) => {
              saveExpense(localDb, { ...asExpense(tripId, expense), ...changed, id: expense.id });
              setEditing(null);
              onChanged();
            }}
            onRemove={() =>
              Alert.alert('Usunąć wydatek?', `${formatMoney(Number(expense.amount_minor), expense.currency)}${expense.note ? ` — ${expense.note}` : ''}`, [
                { text: 'Anuluj', style: 'cancel' },
                {
                  text: 'Usuń',
                  style: 'destructive',
                  onPress: () => {
                    removeExpense(localDb, asExpense(tripId, expense));
                    setEditing(null);
                    onChanged();
                  },
                },
              ])
            }
          />
        ) : (
          <Pressable key={expense.id} disabled={!canChange(expense)} onPress={() => setEditing(expense.id)}>
            <ThemedView type="backgroundElement" style={styles.expense}>
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
              {canChange(expense) && (
                <ThemedText type="small" themeColor="accent">
                  Dotknij, żeby poprawić albo usunąć
                </ThemedText>
              )}
            </ThemedView>
          </Pressable>
        ),
      )}
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


type ExpenseFields = { amountMinor: number; currency: string; category: string; payerTravelerId: string | null; note: string | null };

/** Nowy wydatek albo poprawka (`initial`) — wtedy także „Usuń”. */
function ExpenseForm({
  trip,
  initial,
  onCancel,
  onSave,
  onRemove,
}: {
  trip: CachedTrip;
  initial?: ExpenseRow;
  onCancel: () => void;
  onSave: (expense: ExpenseFields) => void;
  onRemove?: () => void;
}) {
  const theme = useTheme();
  const doc = trip.state.doc;
  const currencies = [...new Set([doc.trip.baseCurrency, ...doc.trip.fx.map((each) => each.currency), ...(initial ? [initial.currency] : [])])];
  const [amount, setAmount] = useState(initial ? (Number(initial.amount_minor) / 100).toFixed(2).replace('.', ',') : '');
  const [currency, setCurrency] = useState(initial?.currency ?? currencies[0]!);
  const [category, setCategory] = useState(initial?.category ?? 'food');
  const [payer, setPayer] = useState<string | null>(initial?.payer_traveler_id ?? null);
  const [note, setNote] = useState(initial?.note ?? '');
  const input = [styles.input, { color: theme.text, borderColor: theme.backgroundSelected }];

  const save = () => {
    const minor = parseMoney(amount);
    if (minor === null || minor === 0) return Alert.alert('Kwota', 'Podaj kwotę, np. 45 albo 12,50.');
    onSave({ amountMinor: minor, currency, category, payerTravelerId: payer, note: note.trim() || null });
  };

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <ThemedText type="smallBold">{initial ? 'Popraw wydatek' : 'Nowy wydatek'}</ThemedText>
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
      <View style={styles.actions}>
        <Button label={initial ? 'Zapisz zmiany' : 'Zapisz wydatek'} variant="primary" onPress={save} />
        <Button label="Anuluj" onPress={onCancel} />
        {onRemove && <Button label="Usuń" onPress={onRemove} small style={styles.remove} />}
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
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  remove: { marginLeft: 'auto' },
  input: { borderWidth: 1, borderRadius: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, fontSize: 16 },
});
