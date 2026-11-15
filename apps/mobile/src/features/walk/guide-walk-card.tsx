import { localToday, plural } from '@expeditionplan/core';
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
import { clearGuideHeard, GUIDE_RADIUS_M, type GuideTarget, guideHeard, guideTargets, guideWalkRunning, heardKey, startGuideWalk, stopGuideWalk } from '@/features/walk/guide-walk';
import { localDb } from '@/lib/local-db';

/**
 * Karta „Spacer z przewodnikiem” w zakładce Spacer: miejsca z opisem w wybranym wyjeździe (z bazy
 * telefonu), start i stop. Lokalizacja „zawsze” jest potrzebna, żeby powiadomienie przyszło przy
 * wygaszonym ekranie. Cele to miejsca dzisiejszego dnia wyjazdu (gdy dziś nie ma dnia tego wyjazdu —
 * całego wyjazdu), bez już podpowiedzianych (`guideHeard`).
 */

/** Miejsca z przewodnikiem i współrzędnymi dzisiejszego dnia (albo całego wyjazdu) — jedno na miejsce. */
function targetsOf(tripId: string): { targets: GuideTarget[]; today: boolean } {
  const trip = cachedTrip(localDb, tripId);
  if (trip === null) return { targets: [], today: false };
  const doc = trip.state.doc;
  const day = doc.days.find((each) => each.date === localToday());
  const seen = new Set<string>();
  const targets = doc.items.flatMap((item) => {
    if (day !== undefined && item.dayRef !== day.ref) return [];
    const placeRef = item.leg?.toPlaceRef ?? item.placeRef;
    const place = placeRef === undefined ? undefined : doc.places.find((each) => each.ref === placeRef);
    if (place?.lat === undefined || place.lng === undefined || seen.has(place.ref)) return [];
    const guide = itemGuide(trip, item);
    if (guide === null) return [];
    seen.add(place.ref);
    return [{ key: place.ref, name: guide.title, lat: place.lat, lng: place.lng, tripId, itemRef: item.ref }];
  });
  return { targets, today: day !== undefined };
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
  const [tripId, setTripId] = useState<string | null>(null);
  const [today, setToday] = useState(true);
  const [heard, setHeard] = useState<Set<string>>(new Set());

  const refresh = useCallback(() => {
    const trips = cachedTrips() ?? [];
    const id = currentTrip(trips);
    setTripId(id);
    setTitle(trips.find((trip) => trip.id === id)?.title ?? null);
    setHeard(guideHeard());
    void guideWalkRunning().then((now) => {
      setRunning(now);
      const found = id === null ? { targets: [], today: true } : targetsOf(id);
      setToday(found.today);
      setTargets(now ? guideTargets() : found.targets);
    });
  }, []);
  useFocusEffect(refresh);

  // Podpowiedziane miejsca nie wracają; spacer rusza z pozostałymi.
  const fresh = targets.filter((target) => !heard.has(heardKey(target)));
  const heardNames = targets.filter((target) => heard.has(heardKey(target))).map((target) => target.name);

  const again = () => {
    if (tripId === null) return;
    clearGuideHeard(tripId);
    refresh();
  };

  const start = async () => {
    if (fresh.length === 0) return;
    if (!(await permissions())) return Alert.alert('Brak uprawnień', 'Spacer z przewodnikiem potrzebuje lokalizacji „zawsze” i powiadomień.');
    try {
      await startGuideWalk(fresh);
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
            ? `„${title}”: ${today ? 'dziś' : 'w planie'} żadne miejsce nie ma przewodnika ze współrzędnymi — opisy przygotowuje się na webie.`
            : `„${title}”, ${today ? 'dzisiejszy dzień' : 'cały wyjazd (dziś nie ma dnia tego wyjazdu)'}: ${plural(fresh.length, ['miejsce', 'miejsca', 'miejsc'])} z przewodnikiem do podpowiedzenia. Gdy podejdziesz na ok. ${GUIDE_RADIUS_M} m, przyjdzie powiadomienie — dotknij, żeby posłuchać. Każde miejsce podpowiadam tylko raz.`}
      </ThemedText>
      {heardNames.length > 0 && (
        <ThemedText type="small" themeColor="textSecondary">
          Już podpowiedziane: {heardNames.join(', ')}.
        </ThemedText>
      )}
      {running ? (
        <>
          <ThemedText type="smallBold" themeColor="accent">
            Działa — możesz wygasić ekran. Zużywa więcej baterii (dokładny GPS).
          </ThemedText>
          <Button label="Zakończ spacer" onPress={() => void stop()} />
        </>
      ) : (
        <>
          <Button label="Zacznij spacer" variant="primary" onPress={() => void start()} disabled={fresh.length === 0 || blocked} />
          {heardNames.length > 0 && <Button label={`Podpowiadaj znowu (${heardNames.length})`} small onPress={again} />}
        </>
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
