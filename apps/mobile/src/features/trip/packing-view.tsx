import { headcount, isShopping, mealList, SHOPPING_CATEGORY } from '@expeditionplan/core';
import { type CachedTrip, setPacked, uuidv7 } from '@expeditionplan/sync';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Chip } from '@/components/chip';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { localDb } from '@/lib/local-db';
import { supabase } from '@/lib/supabase';

/**
 * Lista pakowania na telefonie: każdy uczestnik odhacza swoje (offline, outbox), rzeczy wspólne
 * odhacza ktokolwiek. Widz odhacza tylko siebie i swoje dzieci (RLS `packing_checks`) — inne osoby
 * widzi bez możliwości zmiany. Nowe pozycje dodaje organizator i edytor, online.
 * „Zakupy” to osobna lista (kategoria `zakupy`, rzeczy wspólne) z posiłkami z planu i liczbą osób.
 */

type Props = {
  trip: CachedTrip;
  tripId: string;
  /** Organizator albo edytor: odhacza za każdego i dodaje pozycje. */
  canEdit: boolean;
  userId: string | null;
  onChanged: () => void;
};

type TravelerRow = { id: string; ref: string | null; name: string; user_id: string | null; guardian_id: string | null };
type CheckRow = { packing_item_id: string; traveler_id: string; packed: boolean };

export function PackingView({ trip, tripId, canEdit, userId, onChanged }: Props) {
  const doc = trip.state.doc;
  const travelers = trip.live.travelers as unknown as TravelerRow[];
  const byId = new Map(travelers.map((row) => [row.id, row]));
  const mine = (row: TravelerRow) => userId !== null && (row.user_id === userId || (row.guardian_id !== null && byId.get(row.guardian_id)?.user_id === userId));
  const me = travelers.find((row) => row.user_id === userId);
  const [selected, setSelected] = useState<string | null>(me?.id ?? travelers[0]?.id ?? null);
  const [adding, setAdding] = useState(false);
  const [list, setList] = useState<'packing' | 'shopping'>('packing');
  const shopping = list === 'shopping';
  const checks = trip.live.packingChecks as unknown as CheckRow[];
  const packed = (itemId: string, travelerId: string) => checks.some((row) => row.packing_item_id === itemId && row.traveler_id === travelerId && row.packed);

  const person = selected === null ? undefined : byId.get(selected);
  const personRef = person?.ref ?? (person ? `id-${person.id}` : undefined);
  const canToggle = (travelerId: string) => {
    const row = byId.get(travelerId);
    return canEdit || (row !== undefined && mine(row));
  };

  const items = doc.packing
    .map((item) => ({ item, id: trip.ids[item.ref]! }))
    .filter(({ item }) => isShopping(item) === shopping)
    .filter(({ item }) => item.scope === 'shared' || item.assigneeRef === undefined || item.assigneeRef === personRef);
  const isPacked = ({ item, id }: (typeof items)[number]) =>
    item.scope === 'shared' ? checks.some((row) => row.packing_item_id === id && row.packed) : selected !== null && packed(id, selected);
  const done = items.filter(isPacked).length;

  const toggle = (entry: (typeof items)[number]) => {
    if (selected === null) return;
    const now = !isPacked(entry);
    if (entry.item.scope === 'shared' && !now) {
      // Wspólną rzecz „odpakowuje” się za każdego, kto ją odhaczył — o ile wolno.
      const by = checks.filter((row) => row.packing_item_id === entry.id && row.packed).map((row) => row.traveler_id);
      if (!by.every(canToggle)) return Alert.alert('Bez uprawnień', 'Tę rzecz odhaczył ktoś inny — odznaczyć może on albo organizator.');
      for (const travelerId of by) setPacked(localDb, tripId, entry.id, travelerId, false);
    } else {
      if (!canToggle(selected)) return Alert.alert('Bez uprawnień', 'Możesz odhaczać tylko swoje rzeczy.');
      setPacked(localDb, tripId, entry.id, selected, now);
    }
    onChanged();
  };

  const groups = new Map<string, typeof items>();
  for (const entry of items) groups.set(entry.item.category, [...(groups.get(entry.item.category) ?? []), entry]);

  const shoppingCount = doc.packing.filter(isShopping).length;
  const meals = shopping ? mealList(doc) : [];
  const people = headcount(doc);
  const choose = (next: 'packing' | 'shopping') => {
    setList(next);
    setAdding(false);
  };

  return (
    <View style={styles.stack}>
      <View style={styles.wrap}>
        <Chip active={!shopping} label={`Pakowanie (${doc.packing.length - shoppingCount})`} onPress={() => choose('packing')} />
        <Chip active={shopping} label={`Zakupy (${shoppingCount})`} onPress={() => choose('shopping')} />
      </View>
      {shopping && (
        <ThemedView type="backgroundElement" style={styles.card}>
          <ThemedText type="smallBold">
            Na posiłek: {people.adults} dorosłych{people.children > 0 ? ` + ${people.children} dzieci` : ''}
          </ThemedText>
          {meals.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              W planie nie ma posiłków.
            </ThemedText>
          ) : (
            meals.map((meal) => (
              <ThemedText key={meal.itemRef} type="small" themeColor="textSecondary">
                Dzień {meal.dayNo}: {meal.title}
                {meal.place ? ` · ${meal.place}` : ''}
              </ThemedText>
            ))
          )}
        </ThemedView>
      )}
      {travelers.length > 0 && (
        <View style={styles.wrap}>
          {travelers.map((row) => (
            <Chip key={row.id} active={selected === row.id} label={row.user_id === userId ? `${row.name} (ja)` : row.name} onPress={() => setSelected(row.id)} />
          ))}
        </View>
      )}
      {items.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          {shopping ? 'Lista zakupów jest pusta.' : 'Lista pakowania jest pusta.'}
          {canEdit ? ' Dodaj pierwsze rzeczy poniżej.' : ''}
        </ThemedText>
      ) : (
        <ThemedText type="small" themeColor="textSecondary">
          {shopping ? 'Kupione' : 'Spakowane'} {done} z {items.length}
          {person && !canToggle(person.id) ? ' · tylko podgląd' : ''}
        </ThemedText>
      )}

      {[...groups.entries()].map(([category, entries]) => (
        <View key={category} style={styles.group}>
          {!shopping && <ThemedText type="smallBold">{category}</ThemedText>}
          {entries.map((entry) => (
            <Pressable key={entry.id} onPress={() => toggle(entry)}>
              <ThemedView type="backgroundElement" style={styles.item}>
                <ThemedText>{isPacked(entry) ? '☑' : '☐'}</ThemedText>
                <View style={styles.fill}>
                  <ThemedText type="small" style={isPacked(entry) && styles.done}>
                    {entry.item.title}
                    {entry.item.quantity ? ` × ${String(entry.item.quantity).replace('.', ',')}${entry.item.unit ? ` ${entry.item.unit}` : ''}` : ''}
                  </ThemedText>
                  {((entry.item.scope === 'shared' && !shopping) || entry.item.note) && (
                    <ThemedText type="small" themeColor="textSecondary">
                      {entry.item.scope === 'shared' && !shopping ? 'wspólne' : ''}
                      {entry.item.scope === 'shared' && !shopping && entry.item.note ? ' · ' : ''}
                      {entry.item.note ?? ''}
                    </ThemedText>
                  )}
                </View>
              </ThemedView>
            </Pressable>
          ))}
        </View>
      ))}

      {canEdit && !adding && (
        <Pressable onPress={() => setAdding(true)} hitSlop={8}>
          <ThemedText type="linkPrimary">{shopping ? '+ Dodaj do zakupów' : '+ Dodaj rzecz'}</ThemedText>
        </Pressable>
      )}
      {canEdit && adding && <NewItem tripId={tripId} shopping={shopping} categories={[...groups.keys()]} onDone={() => setAdding(false)} onSaved={onChanged} />}
    </View>
  );
}

/** Nowa pozycja listy (online — `packing_items` zmienia tylko organizator i edytor). */
function NewItem({ tripId, shopping, categories, onDone, onSaved }: { tripId: string; shopping: boolean; categories: string[]; onDone: () => void; onSaved: () => void }) {
  const theme = useTheme();
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState(categories[0] ?? 'ubrania');
  const [shared, setShared] = useState(false);
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState('');
  const [busy, setBusy] = useState(false);
  const input = [styles.input, { color: theme.text, borderColor: theme.backgroundSelected }];
  const suggestions = [...new Set([...categories, 'ubrania', 'kosmetyki', 'dokumenty', 'elektronika', 'apteczka', 'sprzęt'])].filter((each) => each !== SHOPPING_CATEGORY);

  const save = async () => {
    if (title.trim() === '' || (!shopping && category.trim() === '')) return;
    setBusy(true);
    const amount = Number(quantity.replace(',', '.'));
    const { error } = await supabase.from('packing_items').insert(
      shopping
        ? { id: uuidv7(), trip_id: tripId, title: title.trim(), category: SHOPPING_CATEGORY, scope: 'shared', quantity: amount > 0 ? amount : null, unit: unit.trim() || null }
        : { id: uuidv7(), trip_id: tripId, title: title.trim(), category: category.trim(), scope: shared ? 'shared' : 'personal' },
    );
    setBusy(false);
    if (error) return Alert.alert('Nie zapisano', `${error.message}\n\nDodawanie rzeczy wymaga połączenia z internetem.`);
    setTitle('');
    setQuantity('');
    setUnit('');
    onSaved();
  };

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <TextInput
        value={title}
        onChangeText={setTitle}
        style={input}
        placeholder={shopping ? 'Co kupić, np. makaron' : 'Rzecz, np. ładowarka'}
        placeholderTextColor={theme.textSecondary}
        autoFocus
      />
      {shopping ? (
        <View style={styles.row}>
          <TextInput value={quantity} onChangeText={setQuantity} style={[input, styles.fill]} placeholder="Ile" keyboardType="decimal-pad" placeholderTextColor={theme.textSecondary} />
          <TextInput value={unit} onChangeText={setUnit} style={[input, styles.fill]} placeholder="kg, szt., l" placeholderTextColor={theme.textSecondary} />
        </View>
      ) : (
        <>
          <TextInput value={category} onChangeText={setCategory} style={input} placeholder="Kategoria" placeholderTextColor={theme.textSecondary} />
          <View style={styles.wrap}>
            {suggestions.map((each) => (
              <Chip key={each} active={category === each} label={each} onPress={() => setCategory(each)} />
            ))}
          </View>
          <View style={styles.wrap}>
            <Chip active={!shared} label="osobista (każdy pakuje swoją)" onPress={() => setShared(false)} />
            <Chip active={shared} label="wspólna (jedna na grupę)" onPress={() => setShared(true)} />
          </View>
        </>
      )}
      <View style={styles.row}>
        <Pressable onPress={onDone} hitSlop={8}>
          <ThemedText type="linkPrimary">Zamknij</ThemedText>
        </Pressable>
        <Pressable onPress={() => void save()} disabled={busy} hitSlop={8}>
          <ThemedText type="linkPrimary">{busy ? 'Zapisuję…' : 'Dodaj'}</ThemedText>
        </Pressable>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  stack: { gap: Spacing.three },
  fill: { flex: 1 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  group: { gap: Spacing.one },
  item: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.three, borderRadius: Spacing.two },
  done: { textDecorationLine: 'line-through', opacity: 0.6 },
  card: { padding: Spacing.three, borderRadius: Spacing.three, gap: Spacing.two },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  input: { borderWidth: 1, borderRadius: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, fontSize: 16 },
});
