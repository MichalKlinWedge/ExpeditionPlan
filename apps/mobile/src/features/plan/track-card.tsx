import { type PlanItem, trackPosition, type TrackPosition, type TripDocument } from '@expeditionplan/core';
import * as Location from 'expo-location';
import { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Ślad GPX punktu w szczegółach: długość, przewyższenie, czas i „Gdzie jestem na śladzie” —
 * pozycja z GPS telefonu (działa bez internetu) rzutowana na linię z planu: odległość od śladu,
 * przebyte i pozostałe km, podejścia przed wami.
 */

const km = (value: number) => `${value.toLocaleString('pl-PL')} km`;
const OFF_TRACK_M = 150;

export function TrackCard({ doc, item }: { doc: TripDocument; item: PlanItem }) {
  const theme = useTheme();
  const [position, setPosition] = useState<TrackPosition | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const track = item.activity?.trackRef === undefined ? undefined : doc.tracks.find((each) => each.ref === item.activity!.trackRef);
  if (track?.geojson === undefined) return null;
  const line = track.geojson as Parameters<typeof trackPosition>[0];
  const start = line.coordinates[0]!;

  const locate = async () => {
    setStatus('Szukam pozycji…');
    try {
      if (!(await Location.requestForegroundPermissionsAsync()).granted) return setStatus('Brak zgody na lokalizację.');
      const here = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setPosition(trackPosition(line, { lat: here.coords.latitude, lng: here.coords.longitude }));
      setStatus(here.coords.accuracy ? `dokładność GPS ok. ${Math.round(here.coords.accuracy)} m` : null);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  };

  const off = position !== null && position.offTrackM > OFF_TRACK_M;
  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <ThemedText type="smallBold" themeColor="accent">
        ŚLAD
      </ThemedText>
      <ThemedText type="small">
        {track.name}
        {track.distanceKm !== undefined ? ` · ${km(track.distanceKm)}` : ''}
        {track.ascentM !== undefined ? ` · ↑ ${track.ascentM} m` : ''}
        {track.descentM !== undefined ? ` ↓ ${track.descentM} m` : ''}
        {track.durationMin !== undefined ? ` · ok. ${Math.floor(track.durationMin / 60)} h ${track.durationMin % 60} min` : ''}
      </ThemedText>
      {position !== null && (
        <View style={styles.result}>
          <ThemedText type="smallBold" style={off ? { color: theme.primary } : undefined}>
            {off ? `⚠ Jesteś ${position.offTrackM} m od śladu` : `Na śladzie (${position.offTrackM} m od linii)`}
          </ThemedText>
          <ThemedText type="small">
            Za wami {km(position.doneKm)}, przed wami {km(position.leftKm)}
            {position.leftAscentM !== null ? ` i ↑ ${position.leftAscentM} m podejść` : ''}.
          </ThemedText>
        </View>
      )}
      {status && (
        <ThemedText type="small" themeColor="textSecondary">
          {status}
        </ThemedText>
      )}
      <View style={styles.buttons}>
        <Button small variant="primary" label="📍 Gdzie jestem na śladzie" onPress={() => void locate()} />
        <Button small label="Do startu" onPress={() => void Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${start[1]},${start[0]}`)} />
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  card: { padding: Spacing.three, borderRadius: Spacing.three, gap: Spacing.one },
  result: { gap: Spacing.half, marginTop: Spacing.one },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginTop: Spacing.one },
});
