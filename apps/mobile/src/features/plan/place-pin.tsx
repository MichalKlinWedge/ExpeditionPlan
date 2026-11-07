import type { TripDocument } from '@expeditionplan/core';
import { Linking, Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Pinezka przy miejscu z planu (pole „Miejsce”, „Skąd” / „Dokąd”, nocleg dnia): miejsce w Mapach Google — współrzędne,
 * a bez nich nazwa. Nic się nie zapisuje. Rodzic w `flexDirection: 'row'` z `alignItems: 'stretch'` daje jej wysokość
 * sąsiada (pola, przycisku).
 */

type Place = TripDocument['places'][number];

export function showPlace(place: Pick<Place, 'name' | 'lat' | 'lng'>) {
  const query = place.lat !== undefined && place.lng !== undefined ? `${place.lat},${place.lng}` : place.name;
  void Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`);
}

export function PlacePin({ place }: { place: Pick<Place, 'name' | 'lat' | 'lng'> }) {
  const theme = useTheme();
  return (
    <Pressable onPress={() => showPlace(place)} accessibilityLabel={`Pokaż „${place.name}” w Mapach Google`} hitSlop={4} style={[styles.pin, { borderColor: theme.backgroundSelected, backgroundColor: theme.backgroundElement }]}>
      <ThemedText style={styles.icon}>📍</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pin: { borderWidth: 1, borderRadius: Spacing.two, paddingHorizontal: Spacing.three, alignItems: 'center', justifyContent: 'center' },
  icon: { fontSize: 20, lineHeight: 24 },
});
