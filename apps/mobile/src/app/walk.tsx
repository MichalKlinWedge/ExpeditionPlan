import * as Battery from 'expo-battery';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as Sharing from 'expo-sharing';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { appendLog, clearLog, type LogEntry, logUri, readLog } from '@/poc/log';
import { addPoint, type Point, walkPoints } from '@/poc/points';
import { distanceM, GEOFENCE_RADIUS_M, GEOFENCE_TASK, WALK_RADIUS_M, WALK_TASK } from '@/poc/tasks';

/**
 * PoC-3 — geofencing i bateria (PLAN_ETAPOWY.md). Dwa tryby na osobne spacery: geofence w tle
 * (100 m, ekran wygaszony) i „Tryb spaceru” (usługa pierwszoplanowa, dokładny GPS, 40 m).
 * „Jestem przy punkcie” zapisuje rzeczywistą chwilę dojścia — z niej liczy się opóźnienie wykrycia.
 */

export default function WalkScreen() {
  const [points, setPoints] = useState<Point[]>([]);
  const [log, setLog] = useState<(LogEntry & { t: string })[]>([]);
  const [geofencing, setGeofencing] = useState(false);
  const [walking, setWalking] = useState(false);
  const [battery, setBattery] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    setPoints(await walkPoints());
    setLog(await readLog());
    setGeofencing(await Location.hasStartedGeofencingAsync(GEOFENCE_TASK).catch(() => false));
    setWalking(await Location.hasStartedLocationUpdatesAsync(WALK_TASK).catch(() => false));
    const level = await Battery.getBatteryLevelAsync();
    setBattery(level < 0 ? null : Math.round(level * 100));
  }, []);

  // Odświeżanie z timera (także pierwsze), bo stan zmieniają też zadania w tle.
  useEffect(() => {
    const first = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => void refresh(), 5000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [refresh]);

  /** Kolejność wymagana przez Androida: najpierw lokalizacja „podczas używania”, potem „cały czas”. */
  const ensurePermissions = async (): Promise<boolean> => {
    const foreground = await Location.requestForegroundPermissionsAsync();
    if (!foreground.granted) return false;
    const background = await Location.getBackgroundPermissionsAsync();
    if (!background.granted) {
      await new Promise<void>((resolve) =>
        Alert.alert('Lokalizacja w tle', 'Na następnym ekranie wybierz „Zezwalaj zawsze” — inaczej punkty nie będą wykrywane przy wygaszonym ekranie.', [
          { text: 'Dalej', onPress: () => resolve() },
        ]),
      );
      if (!(await Location.requestBackgroundPermissionsAsync()).granted) return false;
    }
    await Notifications.requestPermissionsAsync();
    return true;
  };

  const startGeofencing = async () => {
    if (!(await ensurePermissions())) return Alert.alert('Brak uprawnień do lokalizacji w tle.');
    await Location.startGeofencingAsync(
      GEOFENCE_TASK,
      points.map((point) => ({ identifier: point.name, latitude: point.latitude, longitude: point.longitude, radius: point.radius ?? GEOFENCE_RADIUS_M })),
    );
    await appendLog({ type: 'start', mode: 'geofence', points: points.length, radius: GEOFENCE_RADIUS_M, battery });
    await refresh();
  };

  const startWalk = async () => {
    if (!(await ensurePermissions())) return Alert.alert('Brak uprawnień do lokalizacji w tle.');
    await Location.startLocationUpdatesAsync(WALK_TASK, {
      accuracy: Location.Accuracy.Highest,
      timeInterval: 5000,
      distanceInterval: 10,
      foregroundService: {
        notificationTitle: 'ExpeditionPlan — tryb spaceru',
        notificationBody: 'Śledzę pozycję, żeby wykryć punkty trasy.',
        killServiceOnDestroy: false,
      },
    });
    await appendLog({ type: 'start', mode: 'walk', points: points.length, radius: WALK_RADIUS_M, battery });
    await refresh();
  };

  const stopAll = async () => {
    if (await Location.hasStartedGeofencingAsync(GEOFENCE_TASK)) await Location.stopGeofencingAsync(GEOFENCE_TASK);
    if (await Location.hasStartedLocationUpdatesAsync(WALK_TASK)) await Location.stopLocationUpdatesAsync(WALK_TASK);
    await appendLog({ type: 'stop', battery });
    await refresh();
  };

  /** Prawda z terenu: „właśnie doszedłem” — porównywana z chwilą zdarzenia z geofence. */
  const markArrival = async () => {
    const here = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
    const nearest = points
      .map((point) => ({ point, meters: distanceM(here.coords.latitude, here.coords.longitude, point.latitude, point.longitude) }))
      .sort((a, b) => a.meters - b.meters)[0];
    await appendLog({ type: 'arrival', point: nearest?.point.name, meters: nearest ? Math.round(nearest.meters) : null, accuracy: here.coords.accuracy, battery });
    await refresh();
  };

  const addHere = async () => {
    const here = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
    const name = `Punkt ${points.length + 1}`;
    await addPoint({ id: `p${Date.now()}`, name, latitude: here.coords.latitude, longitude: here.coords.longitude });
    await appendLog({ type: 'point-added', name, accuracy: here.coords.accuracy });
    await refresh();
    if (geofencing) Alert.alert('Uruchom geofencing ponownie', 'Nowy punkt zacznie działać po ponownym starcie.');
  };

  const share = async () => {
    const uri = logUri();
    if (uri === null) return Alert.alert('Log jest pusty.');
    await Sharing.shareAsync(uri, { mimeType: 'application/json', dialogTitle: 'Log PoC' });
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView contentContainerStyle={styles.panel}>
          <ThemedText type="subtitle">Spacer z geofencingiem</ThemedText>
          <ThemedText type="small">
            {geofencing ? `Geofencing: aktywny (${GEOFENCE_RADIUS_M} m)` : walking ? `Tryb spaceru: aktywny (${WALK_RADIUS_M} m)` : 'Nic nie działa w tle.'}
            {battery === null ? '' : ` · bateria ${battery}%`}
          </ThemedText>
          <Row>
            <Button label="Start: geofencing w tle" onPress={startGeofencing} disabled={geofencing || walking} />
            <Button label="Start: tryb spaceru" onPress={startWalk} disabled={geofencing || walking} />
            <Button label="Stop" onPress={stopAll} disabled={!geofencing && !walking} />
          </Row>
          <Row>
            <Button label="Jestem przy punkcie" onPress={markArrival} />
            <Button label="Dodaj punkt tutaj" onPress={addHere} />
          </Row>
          <Row>
            <Button label="Udostępnij log" onPress={share} />
            <Button
              label="Wyczyść log"
              onPress={() =>
                Alert.alert('Wyczyścić log?', 'Wpisy ze spaceru znikną.', [
                  { text: 'Anuluj', style: 'cancel' },
                  { text: 'Wyczyść', style: 'destructive', onPress: () => (clearLog(), void refresh()) },
                ])
              }
            />
          </Row>
          <ThemedText type="small">Punkty ({points.length}): {points.map((point) => point.name).join(', ')}</ThemedText>
          <ThemedText type="small">Ostatnie wpisy:</ThemedText>
          {log.map((entry, i) => (
            <ThemedText key={i} type="small" style={styles.mono}>
              {entry.t.slice(11, 19)} {entry.type} {entry.point ? String(entry.point) : ''} {entry.mode ? `[${String(entry.mode)}]` : ''}
              {typeof entry.battery === 'number' ? ` ${entry.battery}%` : ''}
            </ThemedText>
          ))}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

function Button({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[styles.button, disabled && styles.disabled]}>
      <ThemedText type="small">{label}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1 },
  panel: { padding: Spacing.three, gap: Spacing.two, paddingBottom: BottomTabInset + Spacing.three },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  button: { paddingVertical: Spacing.two, paddingHorizontal: Spacing.three, borderRadius: Spacing.two, borderWidth: 1, borderColor: '#8888' },
  disabled: { opacity: 0.4 },
  mono: { fontFamily: 'monospace' },
});
