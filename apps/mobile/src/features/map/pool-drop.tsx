import { addPoolItem, documentProblem, ITEM_KIND } from '@expeditionplan/core';
import { type CachedTrip, refreshTrip, savePlanEdit, uuidv7 } from '@expeditionplan/sync';
import type { SupabaseClient } from '@supabase/supabase-js';
import { useState } from 'react';
import { Alert, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '@/components/button';
import { Chip } from '@/components/chip';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { type ItemFields } from '@/features/plan/item-editor';
import { localDb, remote } from '@/lib/local-db';
import { supabase } from '@/lib/supabase';

/**
 * Długie przytrzymanie na mapie (organizator, edytor): nowy punkt w puli z pinezką w tym miejscu —
 * co, rodzaj, opis. Zapis w bazie jak inne zmiany planu z telefonu (online), potem odświeżenie planu.
 */

const QUICK_KINDS = ['visit', 'activity', 'meal', 'free'] as const;

type Props = { trip: CachedTrip; tripId: string; at: { lat: number; lng: number }; onDone: (trip: CachedTrip | null) => void };

export function PoolDrop({ trip, tripId, at, onDone }: Props) {
  const theme = useTheme();
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<ItemFields['kind']>('visit');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const input = [styles.input, { color: theme.text, borderColor: theme.backgroundSelected }];

  const save = async () => {
    if (title.trim() === '') return Alert.alert('Pula', 'Wpisz, co tu jest — np. „Punkt widokowy”.');
    const edit = addPoolItem(trip.state.doc, { itemId: uuidv7(), placeId: uuidv7() }, { title: title.trim(), kind, ...(description.trim() ? { description: description.trim() } : {}) }, '', at);
    const problem = documentProblem(edit.doc);
    if (problem !== null) return Alert.alert('Nie zapisano', problem);
    setBusy(true);
    try {
      await savePlanEdit(supabase as unknown as SupabaseClient, tripId, edit, trip.ids);
      onDone(await refreshTrip(localDb, remote, tripId));
    } catch (e) {
      Alert.alert('Nie zapisano', `${e instanceof Error ? e.message : String(e)}\n\nZmiana planu wymaga połączenia z internetem.`);
      setBusy(false);
    }
  };

  return (
    <View style={styles.block}>
      <ThemedText type="smallBold">Nowy punkt w puli — tutaj</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {at.lat.toFixed(5)}, {at.lng.toFixed(5)}
      </ThemedText>
      <TextInput value={title} onChangeText={setTitle} style={input} placeholder="Co? np. Punkt widokowy" placeholderTextColor={theme.textSecondary} autoFocus />
      <View style={styles.chips}>
        {QUICK_KINDS.map((each) => (
          <Chip key={each} compact active={kind === each} label={ITEM_KIND[each] ?? each} onPress={() => setKind(each)} />
        ))}
      </View>
      <TextInput value={description} onChangeText={setDescription} style={input} placeholder="Opis (opcjonalnie)" placeholderTextColor={theme.textSecondary} />
      <View style={styles.chips}>
        <Button small variant="primary" label={busy ? 'Zapisuję…' : 'Dodaj do puli'} disabled={busy} onPress={() => void save()} />
        <Button small label="Anuluj" disabled={busy} onPress={() => onDone(null)} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: Spacing.two },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one, alignItems: 'center' },
  input: { borderWidth: 1, borderRadius: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, fontSize: 16 },
});
