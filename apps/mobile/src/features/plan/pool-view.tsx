import { formatMoney, itemIcon, itemKindLabel, type PlanItem, priceForGroup } from '@expeditionplan/core';
import type { CachedTrip } from '@expeditionplan/sync';
import * as Location from 'expo-location';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '@/components/button';
import { Chip } from '@/components/chip';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { itemGuide } from '@/features/plan/item-details';
import { DayPicker, type ItemFields, KIND } from '@/features/plan/item-editor';

/**
 * Pula w Planie na telefonie: punkty poza dniami — opcje, do których można wrócić. Każdy z opisem,
 * miejscem, czasem i ceną dla grupy; dotknięcie = szczegóły z przewodnikiem (offline). Organizator
 * i edytor wstawiają punkt do dnia („Wstaw do dnia…”) i dodają nowe pomysły („+ Dodaj do puli”, także
 * „tu, gdzie jestem” — pinezka z GPS); online, jak inne zmiany planu z telefonu.
 */

const duration = (min: number, max?: number) => {
  const text = (value: number) => (value < 60 ? `${value} min` : `${Math.floor(value / 60)} h${value % 60 ? ` ${value % 60} min` : ''}`);
  return max !== undefined && max !== min ? `${text(min)}–${text(max)}` : text(min);
};

type Props = {
  trip: CachedTrip;
  /** `null` — podgląd (widz albo bez trybu edycji). */
  onMove: ((ref: string, dayRef: string) => void) | null;
  onAdd: ((fields: ItemFields, placeName?: string, at?: { lat: number; lng: number }) => void) | null;
  onOpen: (item: PlanItem) => void;
};

export function PoolView({ trip, onMove, onAdd, onOpen }: Props) {
  const theme = useTheme();
  const doc = trip.state.doc;
  const [moving, setMoving] = useState<string | null>(null);
  const pool = doc.items.filter((item) => item.dayRef === undefined && item.parentRef === undefined);
  const places = new Map(doc.places.map((place) => [place.ref, place]));
  const travelers = doc.travelers.map((each) => ({ ref: each.ref, age: each.age }));
  // Obszary w kolejności pierwszego punktu (bez `Object.groupBy` — Hermes).
  const areas = new Map<string, PlanItem[]>();
  for (const item of pool) areas.set(item.area ?? '', [...(areas.get(item.area ?? '') ?? []), item]);

  return (
    <View style={styles.stack}>
      <ThemedText type="small" themeColor="textSecondary">
        Opcje spoza dni planu — można do nich wrócić i zmienić plan.{onMove ? ' „Wstaw do dnia…” przenosi punkt do wybranego dnia (wymaga internetu).' : ''}
      </ThemedText>
      {onAdd && <PoolAdd areas={[...new Set(doc.items.flatMap((item) => (item.area ? [item.area] : [])))]} onAdd={onAdd} />}
      {pool.length === 0 && <ThemedText type="small">Pula jest pusta — wszystkie punkty są w dniach.</ThemedText>}
      {[...areas].map(([area, items]) => (
        <View key={area} style={styles.stack}>
          {area !== '' && (
            <ThemedText type="smallBold" themeColor="textSecondary">
              {area.toUpperCase()}
            </ThemedText>
          )}
          {items.map((item) => {
            const place = places.get(item.leg?.toPlaceRef ?? item.placeRef ?? '');
            const price = item.price === undefined ? null : priceForGroup(item.price, travelers);
            const facts = [
              itemKindLabel(item, KIND),
              place && place.name !== item.title ? place.name : null,
              item.durationMin !== undefined ? duration(item.durationMin, item.durationMaxMin) : null,
              price === null ? null : `${price.approx ? 'ok. ' : ''}${price.minMinor === price.maxMinor ? formatMoney(price.minMinor, price.currency) : `${formatMoney(price.minMinor, price.currency)}–${formatMoney(price.maxMinor, price.currency)}`} dla grupy`,
            ].filter(Boolean);
            return (
              <ThemedView key={item.ref} type="backgroundElement" style={styles.card}>
                <Pressable onPress={() => onOpen(item)} hitSlop={4} style={styles.body}>
                  <ThemedText type="smallBold">
                    {itemIcon(doc, item)} {item.title}
                    {itemGuide(trip, item) !== null ? <ThemedText type="small" themeColor="accent">{'  '}📖 opis</ThemedText> : null}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {facts.join(' · ')}
                  </ThemedText>
                  {item.description && (
                    <ThemedText type="small" numberOfLines={4}>
                      {item.description}
                    </ThemedText>
                  )}
                  {item.notes.slice(0, 2).map((note, i) => (
                    <ThemedText key={i} type="small" themeColor="textSecondary" numberOfLines={2}>
                      • {note}
                    </ThemedText>
                  ))}
                </Pressable>
                <View style={[styles.actions, { borderTopColor: theme.backgroundSelected }]}>
                  <Button small label="Szczegóły" onPress={() => onOpen(item)} />
                  {onMove && <Button small variant="primary" label="Wstaw do dnia…" onPress={() => setMoving(item.ref)} />}
                </View>
              </ThemedView>
            );
          })}
        </View>
      ))}
      {onMove && (
        <DayPicker
          doc={doc}
          current=""
          visible={moving !== null}
          onCancel={() => setMoving(null)}
          onPick={(dayRef) => {
            if (moving !== null && dayRef !== null) onMove(moving, dayRef);
            setMoving(null);
          }}
        />
      )}
    </View>
  );
}

/** Rodzaje do wyboru przy pomyśle z drogi — reszta jest w edytorze punktu. */
const QUICK_KINDS = ['visit', 'activity', 'meal', 'free'] as const;

/** „+ Dodaj do puli”: co, rodzaj, opis, miejsce — nazwa albo „📍 tu, gdzie jestem” (GPS, bez internetu do odczytu pozycji). */
function PoolAdd({ areas, onAdd }: { areas: string[]; onAdd: NonNullable<Props['onAdd']> }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<ItemFields['kind']>('visit');
  const [description, setDescription] = useState('');
  const [place, setPlace] = useState('');
  const [area, setArea] = useState<string | null>(null);
  const [here, setHere] = useState(false);
  const [busy, setBusy] = useState(false);
  const input = [styles.input, { color: theme.text, borderColor: theme.backgroundSelected }];
  if (!open)
    return (
      <Pressable onPress={() => setOpen(true)} hitSlop={8}>
        <ThemedText type="linkPrimary">+ Dodaj do puli (atrakcja, miejsce, pomysł)</ThemedText>
      </Pressable>
    );

  const save = async () => {
    if (title.trim() === '') return Alert.alert('Pula', 'Wpisz, co to jest — np. „Kawiarnia z widokiem”.');
    let at: { lat: number; lng: number } | undefined;
    if (here) {
      setBusy(true);
      try {
        if (!(await Location.requestForegroundPermissionsAsync()).granted) return Alert.alert('Brak zgody na lokalizację');
        const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        at = { lat: position.coords.latitude, lng: position.coords.longitude };
      } catch (e) {
        return Alert.alert('Nie mam pozycji', e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    }
    onAdd({ title: title.trim(), kind, ...(description.trim() ? { description: description.trim() } : {}), ...(area ? { area } : {}) }, place, at);
    setTitle('');
    setDescription('');
    setPlace('');
    setHere(false);
    setOpen(false);
  };

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <ThemedText type="smallBold">Nowy punkt w puli</ThemedText>
      <TextInput value={title} onChangeText={setTitle} style={input} placeholder="Co? np. Kawiarnia z widokiem" placeholderTextColor={theme.textSecondary} autoFocus />
      <View style={styles.chips}>
        {QUICK_KINDS.map((each) => (
          <Chip key={each} compact active={kind === each} label={KIND[each] ?? each} onPress={() => setKind(each)} />
        ))}
      </View>
      <TextInput value={description} onChangeText={setDescription} style={input} placeholder="Opis, dlaczego warto (opcjonalnie)" placeholderTextColor={theme.textSecondary} multiline />
      <View style={styles.chips}>
        <Chip compact active={here} label="📍 tu, gdzie jestem" onPress={() => setHere(!here)} />
      </View>
      {!here && <TextInput value={place} onChangeText={setPlace} style={input} placeholder="Miejsce — nazwa (opcjonalnie)" placeholderTextColor={theme.textSecondary} />}
      {areas.length > 0 && (
        <View style={styles.chips}>
          {areas.map((each) => (
            <Chip key={each} compact active={area === each} label={each} onPress={() => setArea(area === each ? null : each)} />
          ))}
        </View>
      )}
      <View style={styles.actions}>
        <Button small variant="primary" label={busy ? 'Szukam pozycji…' : 'Dodaj do puli'} disabled={busy} onPress={() => void save()} />
        <Button small label="Anuluj" onPress={() => setOpen(false)} />
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  stack: { gap: Spacing.two },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  input: { borderWidth: 1, borderRadius: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, fontSize: 16 },
  card: { padding: Spacing.three, borderRadius: Spacing.three, gap: Spacing.two },
  body: { gap: Spacing.half },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: Spacing.two },
});
