import { localToday, type TripDocument, weatherAlerts } from '@expeditionplan/core';
import { cachedTrip } from '@expeditionplan/sync';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTripWeather } from '@/features/trip/trip-weather';
import { localDb } from '@/lib/local-db';

/**
 * „Go / no-go” na Starcie: dni w najbliższych dwóch dniach z punktami pod gołym niebem i złą
 * prognozą — co jest zagrożone i czy plan ma wariant na pogodę (`weatherAlerts` w core).
 * Prognoza z zapisanej na telefonie (offline — ostatnia pobrana).
 */

const WEEKDAY = ['nd.', 'pon.', 'wt.', 'śr.', 'czw.', 'pt.', 'sob.'];
const short = (date: string) => `${WEEKDAY[new Date(`${date}T12:00:00Z`).getUTCDay()]} ${Number(date.slice(8))}.${date.slice(5, 7)}`;

type Days = NonNullable<ReturnType<typeof useTripWeather>>['days'];

/** Lista alertów; `onPrimary` — biały tekst na karcie „W trasie”. */
export function WeatherAlertList({ doc, days, onPrimary = false }: { doc: TripDocument; days: Days | undefined; onPrimary?: boolean }) {
  const alerts = days === undefined ? [] : weatherAlerts(doc, days, localToday());
  if (alerts.length === 0) return null;
  const text = onPrimary ? styles.white : undefined;
  return (
    <View style={styles.list}>
      {alerts.map((alert) => (
        <View key={alert.dayRef} style={[styles.alert, onPrimary ? styles.onPrimary : null]}>
          <ThemedText type="smallBold" style={text}>
            ⚠ {short(alert.date)}: {alert.line}
          </ThemedText>
          <ThemedText type="small" style={text}>
            Pod gołym niebem: {alert.outdoor.join(', ')}
          </ThemedText>
          <ThemedText type="small" style={text}>
            {alert.hint ? `Plan B: „${alert.hint.variant}” (${alert.hint.group}) — przełączysz w Planie.` : 'Plan nie ma wariantu na pogodę — zostaw zapas albo zamień kolejność dni.'}
          </ThemedText>
        </View>
      ))}
    </View>
  );
}

/** Dla wyjazdu, który zaczyna się za 1–2 dni: wczytuje plan i prognozę z telefonu. */
export function NextTripWeather({ tripId }: { tripId: string }) {
  const theme = useTheme();
  const [doc, setDoc] = useState<TripDocument | null>(null);
  useFocusEffect(
    useCallback(() => {
      try {
        setDoc(cachedTrip(localDb, tripId)?.state.doc ?? null);
      } catch {
        setDoc(null);
      }
    }, [tripId]),
  );
  const weather = useTripWeather(tripId, doc);
  if (doc === null || weather === null || weatherAlerts(doc, weather.days, localToday()).length === 0) return null;
  return (
    <ThemedView type="backgroundElement" style={[styles.card, { borderColor: theme.primary }]}>
      <ThemedText type="small" themeColor="textSecondary">
        POGODA — GO / NO-GO
      </ThemedText>
      <WeatherAlertList doc={doc} days={weather.days} />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  list: { gap: Spacing.two, marginTop: Spacing.one },
  alert: { gap: Spacing.half },
  onPrimary: { borderLeftWidth: 2, borderLeftColor: '#FFFFFF', paddingLeft: Spacing.two },
  white: { color: '#FFFFFF' },
  card: { padding: Spacing.three, borderRadius: Spacing.three, borderWidth: 1, gap: Spacing.one },
});
