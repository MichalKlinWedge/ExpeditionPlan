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

  return (
    <View style={styles.stack}>
      {travelers.length > 0 && (
        <View style={styles.wrap}>
          {travelers.map((row) => (
            <Chip key={row.id} active={selected === row.id} label={row.user_id === userId ? `${row.name} (ja)` : row.name} onPress={() => setSelected(row.id)} />
          ))}
        </View>
      )}
      {doc.packing.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          Lista pakowania jest pusta.{canEdit ? ' Dodaj pierwsze rzeczy poniżej.' : ''}
        </ThemedText>
      ) : (
        <ThemedText type="small" themeColor="textSecondary">
          Spakowane {done} z {items.length}
          {person && !canToggle(person.id) ? ' · tylko podgląd' : ''}
        </ThemedText>
      )}

      {[...groups.entries()].map(([category, entries]) => (
        <View key={category} style={styles.group}>
          <ThemedText type="smallBold">{category}</ThemedText>
          {entries.map((entry) => (
            <Pressable key={entry.id} onPress={() => toggle(entry)}>
              <ThemedView type="backgroundElement" style={styles.item}>
                <ThemedText>{isPacked(entry) ? '☑' : '☐'}</ThemedText>
                <View style={styles.fill}>
                  <ThemedText type="small" style={isPacked(entry) && styles.done}>
                    {entry.item.title}
                    {entry.item.quantity ? ` × ${entry.item.quantity}${entry.item.unit ? ` ${entry.item.unit}` : ''}` : ''}
                  </ThemedText>
                  {(entry.item.scope === 'shared' || entry.item.note) && (
                    <ThemedText type="small" themeColor="textSecondary">
                      {entry.item.scope === 'shared' ? 'wspólne' : ''}
                      {entry.item.scope === 'shared' && entry.item.note ? ' · ' : ''}
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
          <ThemedText type="linkPrimary">+ Dodaj rzecz</ThemedText>
        </Pressable>
      )}
      {canEdit && adding && <NewItem tripId={tripId} categories={[...groups.keys()]} onDone={() => setAdding(false)} onSaved={onChanged} />}
    </View>
  );
}

/** Nowa pozycja listy (online — `packing_items` zmienia tylko organizator i edytor). */
function NewItem({ tripId, categories, onDone, onSaved }: { tripId: string; categories: string[]; onDone: () => void; onSaved: () => void }) {
  const theme = useTheme();
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState(categories[0] ?? 'ubrania');
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState(false);
  const input = [styles.input, { color: theme.text, borderColor: theme.backgroundSelected }];
  const suggestions = [...new Set([...categories, 'ubrania', 'kosmetyki', 'dokumenty', 'elektronika', 'apteczka', 'sprzęt'])];

  const save = async () => {
    if (title.trim() === '' || category.trim() === '') return;
    setBusy(true);
    const { error } = await supabase
      .from('packing_items')
      .insert({ id: uuidv7(), trip_id: tripId, title: title.trim(), category: category.trim(), scope: shared ? 'shared' : 'personal' });
    setBusy(false);
    if (error) return Alert.alert('Nie zapisano', `${error.message}\n\nDodawanie rzeczy wymaga połączenia z internetem.`);
    setTitle('');
    onSaved();
  };

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <TextInput value={title} onChangeText={setTitle} style={input} placeholder="Rzecz, np. ładowarka" placeholderTextColor={theme.textSecondary} autoFocus />
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
