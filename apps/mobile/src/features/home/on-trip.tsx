import { dayLodging, formatMinutes, instantToZoned, nowAndNext, type PlanItem, scheduleDay, type TripDocument, weatherIcon, weatherLine } from '@expeditionplan/core';
import { type CachedTrip, cachedTrip } from '@expeditionplan/sync';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { ItemDetails, itemGuide, prefetchGuideImages } from '@/features/plan/item-details';
import { WeatherAlertList } from '@/features/home/weather-alerts';
import { useTripWeather } from '@/features/trip/trip-weather';
import { localDb } from '@/lib/local-db';

/**
 * Tryb „w trasie” na Starcie: dla trwającego wyjazdu — teraz i następny punkt dnia, pogoda,
 * „Nawiguj” do następnego miejsca i do noclegu, „Poczytaj” — przewodnik po miejscu (gdy ma opis).
 * Z bazy telefonu (działa offline), zegar co 30 s.
 * Godziny jak w planie: scenariusz optymistyczny, warianty i zdarzenia dnia z bazy.
 */

const navigate = (at: { lat: number; lng: number }) => void Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${at.lat},${at.lng}`);

/** Miejsce, do którego się jedzie: cel przejazdu albo miejsce punktu (ze współrzędnymi). */
function placeOf(doc: TripDocument, itemRef: string) {
  const item = doc.items.find((each) => each.ref === itemRef);
  const ref = item?.leg?.toPlaceRef ?? item?.placeRef;
  const place = ref === undefined ? undefined : doc.places.find((each) => each.ref === ref);
  return place?.lat === undefined || place.lng === undefined ? null : { name: place.name, lat: place.lat, lng: place.lng };
}

export function OnTrip({ tripId }: { tripId: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(tick);
  }, []);
  // Przy każdym wejściu na Start — opóźnienia i pominięcia z planu zmieniają godziny.
  const [trip, setTrip] = useState<CachedTrip | null>(null);
  const [reading, setReading] = useState<PlanItem | null>(null);
  useFocusEffect(
    useCallback(() => {
      try {
        const found = cachedTrip(localDb, tripId);
        setTrip(found);
        if (found !== null) prefetchGuideImages(found);
      } catch {
        setTrip(null);
      }
    }, [tripId]),
  );
  const weather = useTripWeather(tripId, trip?.state.doc ?? null);
  if (trip === null) return null;

  const { doc, inputs } = trip.state;
  const day = doc.days.find((each) => instantToZoned(now, each.tz).date === each.date);
  if (day === undefined) return null;
  let view: ReturnType<typeof nowAndNext> | null = null;
  try {
    const schedule = scheduleDay(doc, day.ref, { scenario: 'optimistic', activeVariants: inputs.activeVariants, delays: inputs.delays, skipRefs: inputs.skipRefs, done: inputs.done, pulled: inputs.pulled });
    view = nowAndNext(schedule, now);
  } catch {
    view = null;
  }
  const sky = weather?.days[day.ref];
  const target = view?.next ?? view?.current ?? null;
  const goTo = target === null ? null : placeOf(doc, target.ref);
  const lodgingRef = dayLodging(doc, day.ref)?.placeRef;
  const base = lodgingRef === undefined ? undefined : doc.places.find((place) => place.ref === lodgingRef);
  const lodging = base?.lat !== undefined && base.lng !== undefined ? { lat: base.lat, lng: base.lng } : null;
  // Przewodnik: najpierw następny punkt (tam idziecie), potem bieżący.
  const readable = [view?.next, view?.current].flatMap((each) => {
    const item = each ? doc.items.find((other) => other.ref === each.ref) : undefined;
    return item !== undefined && itemGuide(trip, item) !== null ? [item] : [];
  })[0];

  return (
    <View style={styles.block}>
      {day.title && (
        <ThemedText type="small" style={styles.muted}>
          {day.title}
        </ThemedText>
      )}
      {sky && (
        <ThemedText type="smallBold" style={styles.text}>
          {weatherIcon(sky.code)} {weatherLine(sky)}
        </ThemedText>
      )}
      <WeatherAlertList doc={doc} days={weather?.days} onPrimary />
      {view?.current && (
        <ThemedText type="small" style={styles.text}>
          <ThemedText type="smallBold" style={styles.text}>
            Teraz:
          </ThemedText>{' '}
          {view.current.title} · do {view.current.endLocal}
        </ThemedText>
      )}
      {view?.next && (
        <ThemedText type="small" style={styles.text}>
          <ThemedText type="smallBold" style={styles.text}>
            Następny:
          </ThemedText>{' '}
          {view.next.startLocal} {view.next.title} · za {formatMinutes(view.untilNextMin!)}
        </ThemedText>
      )}
      {view !== null && view.current === null && view.next === null && (
        <ThemedText type="small" style={styles.text}>
          Na dziś wszystko z planu za wami.
        </ThemedText>
      )}
      {(goTo !== null || lodging !== null) && (
        <View style={styles.buttons}>
          {goTo !== null && <Button small label={`Nawiguj: ${goTo.name}`} onPress={() => navigate(goTo)} style={styles.grow} />}
          {lodging !== null && <Button small label="Do noclegu" onPress={() => navigate(lodging)} />}
        </View>
      )}
      {readable !== undefined && <Button small label={`📖 Poczytaj: ${readable.title}`} onPress={() => setReading(readable)} style={styles.read} />}
      <ItemDetails trip={trip} item={reading} onClose={() => setReading(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: Spacing.one },
  text: { color: '#FFFFFF' },
  muted: { color: '#FFFFFFCC' },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginTop: Spacing.one },
  grow: { flexShrink: 1 },
  read: { alignSelf: 'flex-start', marginTop: Spacing.one },
});
