import { BUDGET_CATEGORY, budgetSummary, formatMoney, lineTravelerNames, lineTravelers, parseMoney, walletSummary } from '@expeditionplan/core';
import { type CachedTrip, type NewExpense, removeExpense, saveExpense, saveExpenseSplits, uuidv7 } from '@expeditionplan/sync';
import { launchCameraAsync, launchImageLibraryAsync, requestCameraPermissionsAsync } from 'expo-image-picker';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '@/components/button';
import { Chip } from '@/components/chip';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { BudgetPaceCard } from '@/features/trip/budget-pace-card';
import { keepPhoto, uploadPhotos } from '@/features/trip/journal-photos';
import { ReceiptThumb } from '@/features/trip/receipt-thumb';
import { useLiveRates } from '@/features/trip/live-rates';
import { SettleView } from '@/features/trip/settle-view';
import { localDb } from '@/lib/local-db';
import { readReceiptPhoto } from '@/lib/web-api';

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
  receipt_path?: string | null;
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
  receiptPath: row.receipt_path ?? null,
});

/** Podziały wydatków z bazy telefonu (aktywne wiersze `expense_splits`); wydatek bez wierszy dzieli się na wszystkich. */
const activeSplits = () =>
  localDb
    .all<{ data: string }>("select data from rows where tbl = 'expense_splits'")
    .map((row) => JSON.parse(row.data) as { expense_id: string; traveler_id: string; deleted_at: string | null })
    .filter((row) => row.deleted_at === null);

const when = (iso: string) => new Date(iso).toLocaleString('pl-PL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function WalletView({ trip, tripId, canAdd, canEditAll, userId, onChanged }: Props) {
  const planned = trip.state.doc;
  const expenses = [...(trip.live.expenses as unknown as ExpenseRow[])].sort((a, b) => b.paid_at.localeCompare(a.paid_at));
  const spentIn = useMemo(() => [...new Set(expenses.map((each) => each.currency))], [expenses]);
  const fx = useLiveRates(tripId, planned, spentIn);
  // Przeliczenia na kursach z planu uzupełnionych pobranymi (offline — zapisanymi).
  const doc = { ...planned, trip: { ...planned.trip, fx } };
  const budget = budgetSummary(doc);
  const wallet = walletSummary(
    doc,
    expenses.map((each) => ({ amountMinor: Number(each.amount_minor), currency: each.currency, category: each.category })),
  );
  const money = (minor: number) => formatMoney(minor, budget.currency);
  const names = new Map(trip.live.travelers.map((row) => [row.id, row.name as string]));
  // Wydatek przypięty do punktu liczy się w dniu tego punktu (id z bazy → ref z planu).
  const refOf = new Map(Object.entries(trip.ids).map(([ref, id]) => [id, ref]));
  const paceExpenses = expenses.map((each) => ({
    amountMinor: Number(each.amount_minor),
    currency: each.currency,
    category: each.category,
    paidAt: each.paid_at,
    ...(each.item_id && refOf.has(each.item_id) ? { itemRef: refOf.get(each.item_id)! } : {}),
  }));
  const [adding, setAdding] = useState(false);
  // Zdjęcia paragonów czekające na sieć (wspólna kolejka z dziennikiem).
  useEffect(() => {
    void uploadPhotos().catch(() => undefined);
  }, []);
  const [editing, setEditing] = useState<string | null>(null);
  // Wydatek bez `created_by` dodano na tym telefonie i jeszcze nie wrócił z serwera — jest „mój”.
  const mine = (row: ExpenseRow) => row.created_by === undefined || row.created_by === null || row.created_by === userId;
  const canChange = (row: ExpenseRow) => canEditAll || (canAdd && mine(row));
  const splits = activeSplits();
  const splitsOf = (expenseId: string) => splits.filter((row) => row.expense_id === expenseId).map((row) => row.traveler_id);

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
            {budget.perPersonLowMinor === null && budget.perTraveler.map((each) => <Row key={each.ref} label={`Na osobę: ${each.name}`} value={range(money, each.lowMinor, each.highMinor)} />)}
            <BudgetDetails doc={doc} budget={budget} spent={wallet.byCategory} money={money} />
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
          <Row key={currency} label="Bez kursu (brak sieci?)" value={formatMoney(minor, currency)} />
        ))}
        {fx.length > 0 && (
          <ThemedText type="small" themeColor="textSecondary">
            Kursy: {fx.map((rate) => `1 ${rate.currency} = ${rate.rateToBase.toLocaleString('pl-PL', { maximumFractionDigits: 4 })} ${budget.currency}${rate.date ? ` (${rate.date})` : ''}`).join(' · ')}
          </ThemedText>
        )}
        {Object.entries(wallet.byCategory)
          .sort((a, b) => b[1] - a[1])
          .map(([category, minor]) => (
            <ThemedText key={category} type="small" themeColor="textSecondary">
              {BUDGET_CATEGORY[category] ?? category}: {money(minor)}
            </ThemedText>
          ))}
      </ThemedView>

      <BudgetPaceCard doc={doc} expenses={paceExpenses} />

      {canAdd && !adding && (
        <Pressable onPress={() => setAdding(true)} hitSlop={8}>
          <ThemedText type="linkPrimary">+ Dodaj wydatek</ThemedText>
        </Pressable>
      )}
      {canAdd && adding && (
        <ExpenseForm
          trip={trip}
          tripId={tripId}
          onCancel={() => setAdding(false)}
          onSave={({ splitIds, receipt, ...expense }) => {
            const id = uuidv7();
            saveExpense(localDb, { tripId, id, ...expense, receiptPath: keepReceipt(tripId, id, receipt) });
            saveExpenseSplits(localDb, tripId, id, splitIds, trip.live.travelers.map((row) => row.id));
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
            onSave={({ splitIds, receipt, ...changed }) => {
              const receiptPath = receipt ? keepReceipt(tripId, expense.id, receipt) : (expense.receipt_path ?? null);
              saveExpense(localDb, { ...asExpense(tripId, expense), ...changed, id: expense.id, receiptPath });
              saveExpenseSplits(localDb, tripId, expense.id, splitIds, trip.live.travelers.map((row) => row.id));
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
              {expense.receipt_path && <ReceiptThumb path={expense.receipt_path} />}
              <ThemedText type="small" themeColor="textSecondary">
                {BUDGET_CATEGORY[expense.category] ?? expense.category}
                {expense.payer_traveler_id ? ` · płacił(a): ${names.get(expense.payer_traveler_id) ?? '?'}` : ''}
                {splitsOf(expense.id).length > 0 ? ` · na: ${splitsOf(expense.id).map((id) => names.get(id) ?? '?').join(', ')}` : ''}
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

      <SettleView trip={trip} tripId={tripId} canEdit={canEditAll} fx={fx} onChanged={onChanged} />
    </View>
  );
}

const range = (money: (minor: number) => string, low: number, high: number) => (low === high ? money(low) : `${money(low)} – ${money(high)}`);

const LINE_STATUS: Record<string, string> = { estimate: 'szacunek', committed: 'zobowiązanie', paid: 'zapłacone' };

/**
 * Szczegóły budżetu: kategorie z planem (oszczędnie – wygodnie), zapłaconym i wydanym na miejscu,
 * a po dotknięciu kategorii — jej pozycje (status, kwota, rezerwacja, notatka). Kwoty kategorii
 * w walucie wyjazdu, pozycje w swojej walucie.
 */
function BudgetDetails({ doc, budget, spent, money }: { doc: CachedTrip['state']['doc']; budget: ReturnType<typeof budgetSummary>; spent: Record<string, number>; money: (minor: number) => string }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<string | null>(null);
  const bookings = new Map(doc.bookings.map((booking) => [booking.ref, booking.title]));
  // Kategorie z planu i te, w których tylko wydano na miejscu (np. jedzenie bez pozycji w budżecie).
  const categories = [
    ...budget.byCategory,
    ...Object.keys(spent)
      .filter((key) => !budget.byCategory.some((each) => each.category === key))
      .map((key) => ({ category: key, paidMinor: 0, lowMinor: 0, highMinor: 0 })),
  ];
  return (
    <View style={styles.details}>
      <Pressable onPress={() => setOpen(!open)} hitSlop={8}>
        <ThemedText type="linkPrimary">{open ? '▾ Ukryj szczegóły' : '▸ Szczegóły budżetu'}</ThemedText>
      </Pressable>
      {open &&
        categories.map((each) => {
          const lines = doc.budgetLines.filter((line) => line.category === each.category);
          const expanded = category === each.category;
          return (
            <View key={each.category} style={styles.category}>
              <Pressable onPress={() => setCategory(expanded ? null : each.category)} disabled={lines.length === 0} hitSlop={4}>
                <View style={styles.row}>
                  <ThemedText type="smallBold">
                    {lines.length > 0 ? (expanded ? '▾ ' : '▸ ') : ''}
                    {BUDGET_CATEGORY[each.category] ?? each.category}
                  </ThemedText>
                  <ThemedText type="small">{each.highMinor > 0 ? range(money, each.lowMinor, each.highMinor) : '—'}</ThemedText>
                </View>
                <ThemedText type="small" themeColor="textSecondary">
                  {[each.paidMinor > 0 ? `zapłacone ${money(each.paidMinor)}` : null, spent[each.category] ? `wydane na miejscu ${money(spent[each.category]!)}` : null, lines.length > 0 ? `pozycje: ${lines.length}` : 'bez pozycji w planie'].filter(Boolean).join(' · ')}
                </ThemedText>
              </Pressable>
              {expanded &&
                lines.map((line) => (
                  <View key={line.ref} style={[styles.line, { borderLeftColor: theme.backgroundSelected }]}>
                    <View style={styles.row}>
                      <ThemedText type="small" style={styles.lineTitle}>
                        {line.title}
                      </ThemedText>
                      <ThemedText type="small">{range((minor) => formatMoney(minor, line.currency), line.lowMinor, line.highMinor)}</ThemedText>
                    </View>
                    <ThemedText type="small" themeColor="textSecondary">
                      {[
                        LINE_STATUS[line.status],
                        line.perPerson ? `na osobę × ${Math.max(lineTravelers(doc, line).length, 1)}` : null,
                        lineTravelerNames(doc.travelers, line) ? `dotyczy: ${lineTravelerNames(doc.travelers, line)!.join(', ')}` : null,
                        line.bookingRef ? bookings.get(line.bookingRef) : null,
                        line.note,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </ThemedText>
                  </View>
                ))}
            </View>
          );
        })}
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <ThemedText type="small">{label}</ThemedText>
      <ThemedText type="smallBold">{value}</ThemedText>
    </View>
  );
}


/** Zdjęcie paragonu wybrane w formularzu (przed skopiowaniem do katalogu aplikacji). */
type Receipt = { uri: string; mimeType: string; extension: string };

/** `splitIds` — na kogo dzieli się wydatek; pusto = na wszystkich. `paidAt` — data z paragonu, `receipt` — jego zdjęcie. */
type ExpenseFields = { amountMinor: number; currency: string; category: string; payerTravelerId: string | null; note: string | null; splitIds: string[]; paidAt?: string; receipt?: Receipt };

/** Kopia zdjęcia paragonu w telefonie + kolejka wysyłki; ścieżka w buckecie albo `null`, gdy się nie udało. */
function keepReceipt(tripId: string, expenseId: string, receipt: Receipt | undefined): string | null {
  if (receipt === undefined) return null;
  const path = `${tripId}/receipt-${expenseId}/paragon.${receipt.extension}`;
  try {
    keepPhoto(receipt.uri, path, receipt.mimeType);
    void uploadPhotos().catch(() => undefined);
    return path;
  } catch (e) {
    Alert.alert('Nie zapisano zdjęcia paragonu', e instanceof Error ? e.message : String(e));
    return null;
  }
}

/**
 * Nowy wydatek albo poprawka (`initial`) — wtedy także „Usuń”. Przy nowym „📷 Paragon”: zdjęcie
 * idzie do Planner Hub (Gemini), a odczytane pola wypełniają formularz — zapisuje człowiek.
 */
function ExpenseForm({
  trip,
  tripId,
  initial,
  onCancel,
  onSave,
  onRemove,
}: {
  trip: CachedTrip;
  tripId?: string;
  initial?: ExpenseRow;
  onCancel: () => void;
  onSave: (expense: ExpenseFields) => void;
  onRemove?: () => void;
}) {
  const theme = useTheme();
  const doc = trip.state.doc;
  const [extraCurrency, setExtraCurrency] = useState<string | null>(null);
  const currencies = [...new Set([doc.trip.baseCurrency, ...doc.trip.fx.map((each) => each.currency), ...(initial ? [initial.currency] : []), ...(extraCurrency ? [extraCurrency] : [])])];
  const [amount, setAmount] = useState(initial ? (Number(initial.amount_minor) / 100).toFixed(2).replace('.', ',') : '');
  const [currency, setCurrency] = useState(initial?.currency ?? currencies[0]!);
  const [category, setCategory] = useState(initial?.category ?? 'food');
  const [payer, setPayer] = useState<string | null>(initial?.payer_traveler_id ?? null);
  // Podział z bazy telefonu (aktywne wiersze `expense_splits` tego wydatku); brak = wszyscy.
  const [forWhom, setForWhom] = useState<string[]>(() => (initial === undefined ? [] : activeSplits().filter((row) => row.expense_id === initial.id).map((row) => row.traveler_id)));
  const toggle = (id: string) => setForWhom((current) => (current.includes(id) ? current.filter((each) => each !== id) : [...current, id]));
  const [note, setNote] = useState(initial?.note ?? '');
  const [paidAt, setPaidAt] = useState<string | undefined>(undefined);
  const [reading, setReading] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | undefined>(undefined);
  const input = [styles.input, { color: theme.text, borderColor: theme.backgroundSelected }];

  const save = () => {
    const minor = parseMoney(amount);
    if (minor === null || minor === 0) return Alert.alert('Kwota', 'Podaj kwotę, np. 45 albo 12,50.');
    onSave({ amountMinor: minor, currency, category, payerTravelerId: payer, note: note.trim() || null, splitIds: forWhom, ...(paidAt ? { paidAt } : {}), ...(receipt ? { receipt } : {}) });
  };

  // Zdjęcie przycięte do paragonu, mocno skompresowane — base64 musi się zmieścić w limicie żądania.
  const scan = async (source: 'camera' | 'library') => {
    if (tripId === undefined) return;
    if (source === 'camera' && !(await requestCameraPermissionsAsync()).granted) return Alert.alert('Brak dostępu do aparatu', 'Zezwól aplikacji na aparat w ustawieniach telefonu.');
    const options = { mediaTypes: ['images' as const], quality: 0.4, base64: true, allowsEditing: true };
    const result = source === 'camera' ? await launchCameraAsync(options) : await launchImageLibraryAsync(options);
    const asset = result.canceled ? undefined : result.assets[0];
    if (asset?.base64 == null) return;
    // Zdjęcie zostaje przy wydatku także wtedy, gdy odczyt się nie uda (np. bez sieci).
    const mimeType = asset.mimeType === 'image/png' ? 'image/png' : 'image/jpeg';
    setReceipt({ uri: asset.uri, mimeType, extension: mimeType === 'image/png' ? 'png' : 'jpg' });
    if (asset.base64.length > 4_000_000) return Alert.alert('Za duże zdjęcie', 'Zdjęcie zostanie przy wydatku, ale jest za duże do odczytu — wpisz kwotę ręcznie.');
    setReading(true);
    try {
      const draft = await readReceiptPhoto(tripId, currencies, { mimeType, data: asset.base64 });
      if (draft === null) return Alert.alert('Paragon', 'Na zdjęciu nie widzę paragonu.');
      if (draft.amountMinor !== null) setAmount((draft.amountMinor / 100).toFixed(2).replace('.', ','));
      if (draft.currency !== null) {
        if (!currencies.includes(draft.currency)) setExtraCurrency(draft.currency);
        setCurrency(draft.currency);
      }
      if (draft.category !== null && draft.category in BUDGET_CATEGORY) setCategory(draft.category);
      if (draft.merchant !== null && note.trim() === '') setNote(draft.merchant);
      // Data z paragonu (południe czasu telefonu), gdy to nie dziś — wydatek dopisany po fakcie.
      const today = new Date().toLocaleDateString('sv-SE');
      setPaidAt(draft.date !== null && draft.date !== today ? new Date(`${draft.date}T12:00:00`).toISOString() : undefined);
      if (draft.amountMinor === null) Alert.alert('Paragon', 'Nie odczytałem kwoty — wpisz ją ręcznie.');
    } catch (e) {
      Alert.alert('Paragon', e instanceof Error ? e.message : String(e));
    } finally {
      setReading(false);
    }
  };

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <ThemedText type="smallBold">{initial ? 'Popraw wydatek' : 'Nowy wydatek'}</ThemedText>
      {initial === undefined && tripId !== undefined && (
        <View style={styles.actions}>
          <Button label="📷✨ Paragon" small disabled={reading} onPress={() => void scan('camera')} />
          <Button label="🖼✨ Z galerii" small disabled={reading} onPress={() => void scan('library')} />
          {reading && <ActivityIndicator />}
          {reading && (
            <ThemedText type="small" themeColor="textSecondary">
              Czytam paragon…
            </ThemedText>
          )}
          {receipt !== undefined && !reading && (
            <Pressable onPress={() => setReceipt(undefined)} hitSlop={6}>
              <ThemedText type="small" themeColor="accent">
                🧾 zdjęcie dołączone · usuń
              </ThemedText>
            </Pressable>
          )}
          {paidAt !== undefined && !reading && (
            <ThemedText type="small" themeColor="textSecondary">
              z dnia {new Date(paidAt).toLocaleDateString('pl-PL')}
            </ThemedText>
          )}
        </View>
      )}
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
          <ThemedText type="small" themeColor="textSecondary">
            Na kogo (do rozliczenia)
          </ThemedText>
          <View style={styles.wrap}>
            <Chip active={forWhom.length === 0} label="wszyscy" onPress={() => setForWhom([])} />
            {trip.live.travelers.map((row) => (
              <Chip key={row.id} active={forWhom.includes(row.id)} label={row.name as string} onPress={() => toggle(row.id)} />
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
  details: { gap: Spacing.two, paddingTop: Spacing.one },
  category: { gap: Spacing.half },
  line: { borderLeftWidth: 2, paddingLeft: Spacing.two, marginLeft: Spacing.one, gap: Spacing.half },
  lineTitle: { flexShrink: 1 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  remove: { marginLeft: 'auto' },
  input: { borderWidth: 1, borderRadius: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, fontSize: 16 },
});
