import { type NearbyPoolItem, poolNearby, type TripDocument } from '@expeditionplan/core';
import * as Location from 'expo-location';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';

/**
 * „Z puli w pobliżu” na karcie „Teraz”: przy wolnym czasie — punkty z puli najbliżej telefonu
 * (pozycja na żądanie, bez śledzenia), z dojściem i tym, czy zdążycie przed następnym punktem.
 * „Wstaw” zapisuje zdarzenie dnia (outbox, offline) — plan liczy się od razu, a na webie widać
 * wstawienie po synchronizacji. Pula w planie zostaje bez zmian.
 */

type Props = {
  doc: TripDocument;
  /** Wolny czas w minutach (do następnego punktu); `null` — nie wiadomo. */
  gapMin: number | null;
  /** Już wstawione dziś z puli — bez nich na liście. */
  pulled: readonly string[];
  onPull: (itemRef: string) => void;
};

const distance = (km: number) => (km < 1 ? `${Math.round(km * 100) * 10} m` : `${km.toFixed(1).replace('.', ',')} km`);

export function PoolNearby({ doc, gapMin, pulled, onPull }: Props) {
  const [list, setList] = useState<NearbyPoolItem[] | null>(null);
  const [busy, setBusy] = useState(false);

  const locate = async () => {
    setBusy(true);
    try {
      if (!(await Location.requestForegroundPermissionsAsync()).granted) return Alert.alert('Brak zgody na lokalizację', 'Bez pozycji nie wiadomo, co jest blisko.');
      // Ostatnia znana pozycja od razu (także bez sieci), dokładniejsza — jeśli przyjdzie szybko.
      const here = (await Location.getLastKnownPositionAsync()) ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
      setList(poolNearby(doc, { lat: here.coords.latitude, lng: here.coords.longitude }, { gapMin, exclude: pulled }));
    } catch (e) {
      Alert.alert('Nie ustalono pozycji', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (list === null) return <Button label={busy ? 'Szukam pozycji…' : '📍 Co z puli jest blisko?'} small disabled={busy} onPress={() => void locate()} />;

  return (
    <View style={styles.box}>
      <ThemedText type="small" themeColor="textSecondary">
        Z PULI W POBLIŻU{gapMin !== null ? ` · wolne ${gapMin} min` : ''}
      </ThemedText>
      {list.length === 0 && (
        <ThemedText type="small" themeColor="textSecondary">
          W promieniu 5 km nic z puli (liczą się miejsca ze współrzędnymi).
        </ThemedText>
      )}
      {list
        .filter((each) => !pulled.includes(each.item.ref))
        .map((each) => (
          <View key={each.item.ref} style={styles.row}>
            <View style={styles.grow}>
              <ThemedText type="smallBold">{each.item.title}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {[each.place, `${distance(each.km)} · ok. ${each.walkMin} min pieszo`, each.stayMin !== undefined ? `na miejscu ${each.stayMin} min` : null].filter(Boolean).join(' · ')}
              </ThemedText>
              {each.fits !== null && (
                <ThemedText type="small" themeColor={each.fits ? 'accent' : 'textSecondary'}>
                  {each.fits ? 'zdążycie przed następnym punktem' : 'za mało czasu przed następnym punktem'}
                </ThemedText>
              )}
            </View>
            <Button label="Wstaw" small onPress={() => onPull(each.item.ref)} />
          </View>
        ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  grow: { flex: 1 },
});
