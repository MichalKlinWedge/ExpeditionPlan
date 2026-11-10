import { formatKm, formatMinutes, type PlanItem, routeLinkLabel, trackPosition, type TrackPosition, type TripDocument } from '@expeditionplan/core';
import * as Location from 'expo-location';
import { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { navigate } from '@/lib/navigate';

/**
 * Trasa punktu w szczegółach: długość, przewyższenie, czas, link do trasy (mapy.com, wymaga internetu),
 * a przy śladzie GPX „Gdzie jestem na śladzie” — pozycja z GPS telefonu (działa bez internetu) rzutowana
 * na linię z planu: odległość od śladu, przebyte i pozostałe km, podejścia przed wami.
 */

const OFF_TRACK_M = 150;

export function TrackCard({ doc, item }: { doc: TripDocument; item: PlanItem }) {
  const theme = useTheme();
  const [position, setPosition] = useState<TrackPosition | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const track = item.activity?.trackRef === undefined ? undefined : doc.tracks.find((each) => each.ref === item.activity!.trackRef);
  const url = track?.url !== undefined && /^https?:\/\//i.test(track.url) ? track.url : undefined;
  if (track === undefined || (track.geojson === undefined && url === undefined)) return null;
  const line = track.geojson as Parameters<typeof trackPosition>[0] | undefined;
  const start = line?.coordinates[0];

  const locate = async () => {
    if (line === undefined) return;
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
        {line === undefined ? 'TRASA' : 'ŚLAD'}
      </ThemedText>
      <ThemedText type="small">
        {track.name}
        {track.distanceKm !== undefined ? ` · ${formatKm(track.distanceKm)}` : ''}
        {track.ascentM !== undefined ? ` · ↑ ${track.ascentM} m` : ''}
        {track.descentM !== undefined ? ` ↓ ${track.descentM} m` : ''}
        {track.durationMin !== undefined ? ` · ok. ${formatMinutes(track.durationMin)}` : ''}
      </ThemedText>
      {position !== null && (
        <View style={styles.result}>
          <ThemedText type="smallBold" style={off ? { color: theme.primary } : undefined}>
            {off ? `⚠ Jesteś ${position.offTrackM} m od śladu` : `Na śladzie (${position.offTrackM} m od linii)`}
          </ThemedText>
          <ThemedText type="small">
            Za wami {formatKm(position.doneKm)}, przed wami {formatKm(position.leftKm)}
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
        {url !== undefined && <Button small label={`🗺 ${routeLinkLabel(url)}`} onPress={() => void Linking.openURL(url)} />}
        {line !== undefined && <Button small variant="primary" label="📍 Gdzie jestem na śladzie" onPress={() => void locate()} />}
        {start !== undefined && <Button small label="Do startu" onPress={() => navigate({ lat: start[1]!, lng: start[0]!, name: 'Start trasy' }, 'walking')} />}
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  card: { padding: Spacing.three, borderRadius: Spacing.three, gap: Spacing.one },
  result: { gap: Spacing.half, marginTop: Spacing.one },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginTop: Spacing.one },
});
