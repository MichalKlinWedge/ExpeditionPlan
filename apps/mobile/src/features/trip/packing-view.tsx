import { carriesFromRows, defaultTake, formatWeight, gearLoads, gearShare, headcount, isShopping, mealList, selfCookedTotals, SHOPPING_CATEGORY } from '@expeditionplan/core';
import { type CachedTrip, setCarrying, setPacked, uuidv7 } from '@expeditionplan/sync';
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
 * Sprzęt na telefonie: wybrana osoba widzi swoje rzeczy osobiste i wspólne, które bierze, oraz te, których
 * jeszcze nikt nie wziął, z „Biorę”; rzeczy wzięte przez innych są pod osobnym przełącznikiem. Odhaczanie
 * i „Biorę” działają offline (outbox). Widz zmienia tylko siebie i swoje dzieci (RLS `packing_checks`,
 * `packing_carriers`) — inne osoby widzi bez możliwości zmiany. Nowe pozycje dodaje organizator i edytor, online.
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
  const [showOthers, setShowOthers] = useState(false);
  const shopping = list === 'shopping';
  const checks = trip.live.packingChecks as unknown as CheckRow[];
  const packed = (itemId: string, travelerId: string) => checks.some((row) => row.packing_item_id === itemId && row.traveler_id === travelerId && row.packed);

  const person = selected === null ? undefined : byId.get(selected);
  const personRef = person?.ref ?? (person ? `id-${person.id}` : undefined);
  const canToggle = (travelerId: string) => {
    const row = byId.get(travelerId);
    return canEdit || (row !== undefined && mine(row));
  };

  const carries = carriesFromRows(trip.live.packingCarriers, trip.ids);
  const nameOf = (ref: string) => doc.travelers.find((each) => each.ref === ref)?.name ?? '?';
  /** Rzecz wspólna z podziału (nie zakupy: te kupuje się razem). */
  const isClaimable = (item: (typeof doc.packing)[number]) => item.scope === 'shared' && !isShopping(item);
  const carrying = (item: (typeof doc.packing)[number]) => gearShare(item, carries).carriers.find((carrier) => carrier.travelerRef === personRef);

  const all = doc.packing
    .map((item) => ({ item, id: trip.ids[item.ref]! }))
    .filter(({ item }) => isShopping(item) === shopping)
    .filter(({ item }) => item.scope === 'shared' || item.assigneeRef === undefined || item.assigneeRef === personRef);
  /** Wzięte w całości przez innych: nie jej sprawa, więc poza listą i licznikiem. */
  const others = all.filter(({ item }) => isClaimable(item) && carrying(item) === undefined && gearShare(item, carries).left === 0);
  const items = all.filter((entry) => !others.includes(entry));
  /** Co można odhaczyć: wspólne dopiero po „Biorę”. */
  const packable = items.filter(({ item }) => !isClaimable(item) || carrying(item) !== undefined);
  const load = gearLoads(doc, carries).find((each) => each.travelerRef === personRef);
  const isPacked = ({ item, id }: (typeof items)[number]) =>
    item.scope === 'shared' ? checks.some((row) => row.packing_item_id === id && row.packed) : selected !== null && packed(id, selected);
  const done = packable.filter(isPacked).length;

  const toggle = (entry: (typeof items)[number]) => {
    if (selected === null || !packable.includes(entry)) return;
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

  const carry = (entry: (typeof items)[number], quantity: number) => {
    if (selected === null) return;
    if (!canToggle(selected)) return Alert.alert('Bez uprawnień', 'Możesz decydować tylko za siebie i swoje dzieci.');
    setCarrying(localDb, tripId, entry.id, selected, quantity);
    onChanged();
  };

  const groups = new Map<string, typeof items>();
  for (const entry of items) groups.set(entry.item.category, [...(groups.get(entry.item.category) ?? []), entry]);

  const shoppingCount = doc.packing.filter(isShopping).length;
  const meals = shopping ? mealList(doc) : [];
  const people = headcount(doc);
  const own = selfCookedTotals(meals);
  const portions = (each: { adults: number; children: number }) => `${each.adults} dor.${each.children > 0 ? ` + ${each.children} dz.` : ''}`;
  const shareLine = (item: (typeof doc.packing)[number]) => {
    const share = gearShare(item, carries);
    const who = share.carriers.map((carrier) => `${nameOf(carrier.travelerRef)}${share.needed !== 1 ? ` × ${String(carrier.quantity).replace('.', ',')}` : ''}`).join(', ');
    if (share.status === 'open') return 'wspólne · do ustalenia';
    if (share.status === 'partial') return `bierze: ${who} · brakuje ${String(share.left).replace('.', ',')}${item.unit ? ` ${item.unit}` : ''}`;
    if (share.status === 'over') return `bierze: ${who} · za dużo, ustalcie to`;
    return `bierze: ${who}`;
  };
  const choose = (next: 'packing' | 'shopping') => {
    setList(next);
    setAdding(false);
  };

  return (
    <View style={styles.stack}>
      <View style={styles.wrap}>
        <Chip active={!shopping} label={`Sprzęt (${doc.packing.length - shoppingCount})`} onPress={() => choose('packing')} />
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
              <ThemedText key={meal.itemRef} type="small" themeColor={meal.selfCooked ? 'text' : 'textSecondary'}>
                {meal.selfCooked ? '🍳 ' : ''}Dzień {meal.dayNo}: {meal.title}
                {meal.place ? ` · ${meal.place}` : ''}
                {meal.selfCooked ? ` · porcje: ${portions(meal.people)}` : ''}
              </ThemedText>
            ))
          )}
          {own.meals > 0 && (
            <ThemedText type="smallBold">
              Gotujecie sami: {own.meals} · razem porcji: {portions(own)}
            </ThemedText>
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
          {shopping ? 'Lista zakupów jest pusta.' : 'Lista sprzętu jest pusta.'}
          {canEdit ? ' Dodaj pierwsze rzeczy poniżej.' : ''}
        </ThemedText>
      ) : (
        <ThemedText type="small" themeColor="textSecondary">
          {shopping ? 'Kupione' : 'Spakowane'} {done} z {packable.length}
          {!shopping && load !== undefined && load.weightG > 0 ? ` · niesie ${formatWeight(load.weightG)}${load.noWeight > 0 ? ` + ${load.noWeight} bez wagi` : ''}` : ''}
          {person && !canToggle(person.id) ? ' · tylko podgląd' : ''}
        </ThemedText>
      )}

      {[...groups.entries()].map(([category, entries]) => (
        <View key={category} style={styles.group}>
          {!shopping && <ThemedText type="smallBold">{category}</ThemedText>}
          {entries.map((entry) => (
            <Pressable key={entry.id} onPress={() => toggle(entry)}>
              <ThemedView type="backgroundElement" style={styles.item}>
                {packable.includes(entry) && <ThemedText>{isPacked(entry) ? '☑' : '☐'}</ThemedText>}
                <View style={styles.fill}>
                  <ThemedText type="small" style={isPacked(entry) && styles.done}>
                    {entry.item.title}
                    {entry.item.quantity ? ` × ${String(entry.item.quantity).replace('.', ',')}${entry.item.unit ? ` ${entry.item.unit}` : ''}` : ''}
                  </ThemedText>
                  {isClaimable(entry.item) && <ThemedText type="small" themeColor="textSecondary">{shareLine(entry.item)}</ThemedText>}
                  {entry.item.note && (
                    <ThemedText type="small" themeColor="textSecondary">
                      {entry.item.note}
                    </ThemedText>
                  )}
                  {isClaimable(entry.item) && person && canToggle(person.id) && <CarryControl item={entry.item} carried={carrying(entry.item)?.quantity} take={defaultTake(gearShare(entry.item, carries))} onChange={(quantity) => carry(entry, quantity)} />}
                </View>
              </ThemedView>
            </Pressable>
          ))}
        </View>
      ))}

      {others.length > 0 && (
        <Pressable onPress={() => setShowOthers(!showOthers)} hitSlop={8}>
          <ThemedText type="linkPrimary">
            {showOthers ? 'Ukryj rzeczy innych' : `Rzeczy wspólne, które biorą inni (${others.length})`}
          </ThemedText>
        </Pressable>
      )}
      {showOthers &&
        others.map((entry) => (
          <ThemedView key={entry.id} type="backgroundElement" style={styles.item}>
            <View style={styles.fill}>
              <ThemedText type="small">{entry.item.title}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {shareLine(entry.item)}
              </ThemedText>
            </View>
          </ThemedView>
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

/** „Biorę” przy rzeczy wspólnej, a gdy dzieli się ją po kawałku — także ile. Zapis przy końcu wpisywania. */
function CarryControl({ item, carried, take, onChange }: { item: { quantity?: number; unit?: string }; carried: number | undefined; take: number; onChange: (quantity: number) => void }) {
  const theme = useTheme();
  const split = (item.quantity ?? 1) !== 1;
  return (
    <View style={styles.carry}>
      <Pressable onPress={() => onChange(carried === undefined ? take : 0)} hitSlop={8}>
        <ThemedText type="linkPrimary">{carried === undefined ? 'Biorę' : 'Nie biorę'}</ThemedText>
      </Pressable>
      {carried !== undefined && split && (
        <>
          <TextInput
            key={carried}
            defaultValue={String(carried).replace('.', ',')}
            keyboardType="decimal-pad"
            style={[styles.amount, { color: theme.text, borderColor: theme.backgroundSelected }]}
            onEndEditing={(event) => {
              const next = Number(event.nativeEvent.text.replace(',', '.'));
              if (Number.isFinite(next) && next > 0 && next !== carried) onChange(next);
            }}
          />
          {item.unit && <ThemedText type="small">{item.unit}</ThemedText>}
        </>
      )}
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
  carry: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginTop: Spacing.one },
  amount: { borderWidth: 1, borderRadius: Spacing.one, paddingHorizontal: Spacing.two, paddingVertical: 0, minWidth: 48, fontSize: 14, textAlign: 'center' },
  input: { borderWidth: 1, borderRadius: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, fontSize: 16 },
});
