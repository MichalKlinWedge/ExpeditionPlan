import { plural } from '@expeditionplan/core';
import { cachedTrip } from '@expeditionplan/sync';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, StyleSheet } from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { itemGuide } from '@/features/plan/item-details';
import { cachedTrips, currentTrip } from '@/features/trips/my-trips';
import { GUIDE_RADIUS_M, type GuideTarget, guideTargets, guideWalkRunning, startGuideWalk, stopGuideWalk } from '@/features/walk/guide-walk';
import { localDb } from '@/lib/local-db';

/**
 * Karta „Spacer z przewodnikiem” w zakładce Spacer: miejsca z opisem w wybranym wyjeździe (z bazy
 * telefonu), start i stop. Lokalizacja „zawsze” jest potrzebna, żeby powiadomienie przyszło przy
 * wygaszonym ekranie.
 */

/** Miejsca wyjazdu z przewodnikiem i współrzędnymi — jedno na miejsce. */
function targetsOf(tripId: string): GuideTarget[] {
  const trip = cachedTrip(localDb, tripId);
  if (trip === null) return [];
  const doc = trip.state.doc;
  const seen = new Set<string>();
  return doc.items.flatMap((item) => {
    const placeRef = item.leg?.toPlaceRef ?? item.placeRef;
    const place = placeRef === undefined ? undefined : doc.places.find((each) => each.ref === placeRef);
    if (place?.lat === undefined || place.lng === undefined || seen.has(place.ref)) return [];
    const guide = itemGuide(trip, item);
    if (guide === null) return [];
    seen.add(place.ref);
    return [{ key: place.ref, name: guide.title, lat: place.lat, lng: place.lng, tripId, itemRef: item.ref }];
  });
}

async function permissions(): Promise<boolean> {
  if (!(await Location.requestForegroundPermissionsAsync()).granted) return false;
  if (!(await Location.getBackgroundPermissionsAsync()).granted) {
    await new Promise<void>((resolve) =>
      Alert.alert('Lokalizacja w tle', 'Na następnym ekranie wybierz „Zezwalaj zawsze” — inaczej powiadomienie nie przyjdzie przy wygaszonym ekranie.', [{ text: 'Dalej', onPress: () => resolve() }]),
    );
    if (!(await Location.requestBackgroundPermissionsAsync()).granted) return false;
  }
  return (await Notifications.requestPermissionsAsync()).granted;
}

export function GuideWalkCard({ blocked }: { blocked: boolean }) {
  const [running, setRunning] = useState(false);
  const [targets, setTargets] = useState<GuideTarget[]>([]);
  const [title, setTitle] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      const trips = cachedTrips() ?? [];
      const id = currentTrip(trips);
      setTitle(trips.find((trip) => trip.id === id)?.title ?? null);
      void guideWalkRunning().then((now) => {
        setRunning(now);
        setTargets(now ? guideTargets() : id === null ? [] : targetsOf(id));
      });
    }, []),
  );

  const start = async () => {
    if (targets.length === 0) return;
    if (!(await permissions())) return Alert.alert('Brak uprawnień', 'Spacer z przewodnikiem potrzebuje lokalizacji „zawsze” i powiadomień.');
    try {
      await startGuideWalk(targets);
      setRunning(true);
    } catch (e) {
      Alert.alert('Nie udało się uruchomić', e instanceof Error ? e.message : String(e));
    }
  };

  const stop = async () => {
    await stopGuideWalk();
    setRunning(false);
  };

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <ThemedText type="subtitle">🎧 Spacer z przewodnikiem</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {title === null
          ? 'Wybierz wyjazd w zakładce Wyjazdy.'
          : targets.length === 0
            ? `„${title}”: żadne miejsce nie ma jeszcze przewodnika ze współrzędnymi — opisy przygotowuje się na webie.`
            : `„${title}”: ${plural(targets.length, ['miejsce', 'miejsca', 'miejsc'])} z przewodnikiem. Gdy podejdziesz na ok. ${GUIDE_RADIUS_M} m, przyjdzie powiadomienie — dotknij, żeby posłuchać.`}
      </ThemedText>
      {running ? (
        <>
          <ThemedText type="smallBold" themeColor="accent">
            Działa — możesz wygasić ekran. Zużywa więcej baterii (dokładny GPS).
          </ThemedText>
          <Button label="Zakończ spacer" onPress={() => void stop()} />
        </>
      ) : (
        <Button label="Zacznij spacer" variant="primary" onPress={() => void start()} disabled={targets.length === 0 || blocked} />
      )}
      {blocked && !running && (
        <ThemedText type="small" themeColor="textSecondary">
          Najpierw zatrzymaj test PoC poniżej.
        </ThemedText>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  card: { padding: Spacing.three, borderRadius: Spacing.three, gap: Spacing.two },
});
