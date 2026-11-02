import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Chip } from '@/components/chip';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useSession } from '@/features/auth/session';
import { TripMap } from '@/features/map/trip-map';
import { loadMyTrips, pickTrip, type Trip } from '@/features/trips/my-trips';
import { isConfigured } from '@/lib/supabase';

/**
 * Zakładka Mapa: mapa bieżącego wyjazdu (jak w Planie: trwający, inaczej najbliższy) — pinezki dnia,
 * cała trasa i mapa offline do pobrania. Przy kilku wyjazdach przełącznik u góry.
 */
export default function MapTab() {
  const session = useSession();
  const [trips, setTrips] = useState<Trip[] | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await loadMyTrips(session !== null);
    setError(result.error);
    setTrips(result.trips);
    setSelected((current) => (current !== null && result.trips.some((trip) => trip.id === current) ? current : pickTrip(result.trips)));
  }, [session]);

  useFocusEffect(
    useCallback(() => {
      if (session !== undefined) void load();
    }, [load, session]),
  );

  let message: string | null = null;
  if (!isConfigured) message = 'Brak adresu Supabase w tej wersji aplikacji.';
  else if (session === undefined || trips === null) message = 'Wczytuję…';
  else if (error !== '') message = error;
  else if (trips.length === 0) message = session === null ? 'Na telefonie nie ma pobranych planów — zaloguj się na ekranie Start.' : 'Nie masz jeszcze wyjazdów.';

  return (
    <ThemedView style={styles.fill}>
      <SafeAreaView style={[styles.fill, { paddingBottom: BottomTabInset }]} edges={['top']}>
        {message !== null || selected === null ? (
          <ThemedText style={styles.pad}>{message}</ThemedText>
        ) : (
          <View style={styles.fill}>
            {trips!.length > 1 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.bar} contentContainerStyle={styles.chips}>
                {trips!.map((trip) => (
                  <Chip key={trip.id} active={trip.id === selected} label={trip.title!} onPress={() => setSelected(trip.id)} />
                ))}
              </ScrollView>
            )}
            <TripMap key={selected} tripId={selected} signedIn={session !== null} />
          </View>
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  pad: { padding: Spacing.three },
  bar: { flexGrow: 0, flexShrink: 0 },
  chips: { flexDirection: 'row', gap: Spacing.two, paddingHorizontal: Spacing.three, paddingTop: Spacing.two },
});
