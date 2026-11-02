import { dayLodging, dayMap, instantToZoned, type MapLine, type MapPin, scheduleDay, tripMapAreas, type TripDocument } from '@expeditionplan/core';
import { type CachedTrip, cachedTrip, refreshTrip } from '@expeditionplan/sync';
import { Camera, type CameraRef, Map as MapView, UserLocation } from '@maplibre/maplibre-react-native';
import * as Location from 'expo-location';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Chip } from '@/components/chip';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { DayLines, hasTransit, PinCard, PinMarkers, TransitToggle, withoutTransit } from '@/features/map/map-parts';
import { useMapStyle } from '@/features/map/map-style';
import { type AreaStatus, areaStatuses, deleteAreas, downloadAreas } from '@/features/map/offline-packs';
import { useTheme } from '@/hooks/use-theme';
import { localDb, remote } from '@/lib/local-db';

/**
 * Mapa wyjazdu: pinezki dnia z numerami kolejności (ta sama `dayMap` co na webie), cała trasa,
 * nawigacja do miejsca i mapa offline — obszary liczone z miejsc planu (`tripMapAreas`),
 * pobierane jednym przyciskiem. Plan z pamięci telefonu, więc działa bez sieci.
 */

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const shortDay = (date: string) => new Intl.DateTimeFormat('pl-PL', { weekday: 'short', day: 'numeric', month: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));

/** Wszystkie miejsca planu ze współrzędnymi (widok „Cała trasa”), bazy noclegowe wyróżnione. */
function tripPins(doc: TripDocument): MapPin[] {
  const used = new Set(doc.items.flatMap((item) => [item.placeRef, item.leg?.toPlaceRef].filter((ref): ref is string => ref !== undefined)));
  const bases = new Set(doc.days.flatMap((day) => (day.baseRef ? [day.baseRef] : [])));
  return doc.places.flatMap((place) =>
    place.lat !== undefined && place.lng !== undefined && (used.has(place.ref) || bases.has(place.ref))
      ? [{ placeRef: place.ref, name: place.name, lat: place.lat, lng: place.lng, stops: [], ...(bases.has(place.ref) ? { base: true } : {}) }]
      : [],
  );
}

export function TripMap({ tripId, signedIn }: { tripId: string; signedIn: boolean }) {
  const theme = useTheme();
  const camera = useRef<CameraRef>(null);
  const mapStyle = useMapStyle();
  // Plan z pamięci telefonu od razu (offline); komponent dostaje `key` = wyjazd, więc wystarczy raz.
  const [initial] = useState(() => {
    try {
      const cached = cachedTrip(localDb, tripId);
      // Na start dzisiejszy dzień wyjazdu, poza wyjazdem — cała trasa.
      const today = cached === null ? -1 : cached.state.doc.days.findIndex((each) => instantToZoned(Date.now(), each.tz).date === each.date);
      return { cached, today, failure: '' };
    } catch (e) {
      return { cached: null, today: -1, failure: e instanceof Error ? e.message : String(e) };
    }
  });
  const [trip, setTrip] = useState<CachedTrip | null>(initial.cached);
  const failure = initial.failure;
  const [day, setDay] = useState(initial.today);
  const [selected, setSelected] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<AreaStatus[] | null>(null);
  const [progress, setProgress] = useState('');

  useEffect(() => {
    if (signedIn) void refreshTrip(localDb, remote, tripId).then(setTrip, () => undefined);
  }, [tripId, signedIn]);

  const doc = trip?.state.doc ?? null;
  const areas = useMemo(() => (doc ? tripMapAreas(doc) : []), [doc]);
  const refreshStatuses = useCallback(() => {
    void areaStatuses(tripId, areas).then(setStatuses, () => setStatuses([]));
  }, [tripId, areas]);
  useEffect(refreshStatuses, [refreshStatuses]);

  const dayRef = doc && day >= 0 ? doc.days[day]?.ref : undefined;
  const [showTransit, setShowTransit] = useState(false);
  const full = useMemo(() => {
    if (doc === null) return null;
    if (dayRef === undefined) return { pins: tripPins(doc), lines: [] as MapLine[] };
    try {
      const schedule = scheduleDay(doc, dayRef);
      return dayMap(doc, schedule.items.map((item) => item.ref), { baseRef: dayLodging(doc, dayRef)?.placeRef });
    } catch {
      return { pins: [], lines: [] as MapLine[] };
    }
  }, [doc, dayRef]);
  const transit = full !== null && hasTransit(full);
  const view = useMemo(() => (full === null ? null : withoutTransit(full, showTransit)), [full, showTransit]);

  // Kamera obejmuje pinezki dnia (albo całą trasę) przy każdej zmianie widoku.
  useEffect(() => {
    if (view === null || view.pins.length === 0) return;
    const lngs = view.pins.map((pin) => pin.lng);
    const lats = view.pins.map((pin) => pin.lat);
    if (view.pins.length === 1) camera.current?.flyTo({ center: [lngs[0]!, lats[0]!], zoom: 14, duration: 600 });
    else camera.current?.fitBounds([Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)], { padding: { top: 60, right: 50, bottom: 60, left: 50 }, duration: 600 });
  }, [view]);

  if (failure) return <ThemedText style={styles.pad}>Plan na telefonie nie przechodzi walidacji: {failure}</ThemedText>;
  if (doc === null || view === null) {
    return <ThemedText style={styles.pad}>{signedIn ? 'Wczytuję plan…' : 'Tego wyjazdu nie ma jeszcze na telefonie — otwórz go raz w zakładce Plan z internetem.'}</ThemedText>;
  }

  const pin = view.pins.find((each) => each.placeRef === selected) ?? null;
  const times = new Map<string, string>();
  if (dayRef !== undefined) {
    try {
      for (const item of scheduleDay(doc, dayRef).items) times.set(item.ref, item.startLocal);
    } catch {
      // bez godzin
    }
  }
  const done = statuses?.filter((status) => status.done) ?? [];
  const busy = progress !== '';

  const download = async () => {
    setProgress('Przygotowuję…');
    try {
      await downloadAreas(tripId, areas, setProgress);
      Alert.alert('Mapa pobrana', 'Mapa wyjazdu działa teraz bez internetu.');
    } catch (e) {
      Alert.alert('Nie pobrano mapy', e instanceof Error ? e.message : String(e));
    } finally {
      setProgress('');
      refreshStatuses();
    }
  };
  const remove = () =>
    Alert.alert('Usunąć mapę offline?', 'Pobrane obszary tego wyjazdu znikną z telefonu.', [
      { text: 'Anuluj', style: 'cancel' },
      { text: 'Usuń', style: 'destructive', onPress: () => void deleteAreas(tripId).then(refreshStatuses) },
    ]);
  const centerOnMe = async () => {
    if (!(await Location.requestForegroundPermissionsAsync()).granted) return Alert.alert('Brak zgody na lokalizację');
    const here = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    camera.current?.flyTo({ center: [here.coords.longitude, here.coords.latitude], zoom: 15, duration: 600 });
  };

  return (
    <View style={styles.fill}>
      {/* Wszystkie dni naraz (zawijane), bez przewijania w bok. */}
      <View style={styles.chips}>
        <Chip compact active={day < 0} label="Cała trasa" onPress={() => setDay(-1)} />
        {doc.days.map((each, index) => (
          <Chip key={each.ref} compact active={index === day} label={shortDay(each.date)} onPress={() => setDay(index)} />
        ))}
      </View>

      <View style={styles.fill}>
        <MapView mapStyle={mapStyle} androidView="surface" onPress={() => setSelected(null)}>
          <Camera ref={camera} initialViewState={areas[0] ? { bounds: areas[0].bounds } : undefined} />
          <UserLocation accuracy />
          <DayLines lines={view.lines} id="day-lines" />
          <PinMarkers pins={view.pins} selected={selected} onSelect={setSelected} />
        </MapView>
        {transit && <TransitToggle value={showTransit} onChange={setShowTransit} />}
        <Pressable onPress={() => void centerOnMe()} style={[styles.me, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]} hitSlop={6}>
          <ThemedText type="smallBold">◎</ThemedText>
        </Pressable>
      </View>

      <ThemedView style={[styles.panel, { borderTopColor: theme.backgroundSelected }]}>
        {pin ? (
          <PinCard pin={pin} times={times} onClose={() => setSelected(null)} />
        ) : (
          <View style={styles.block}>
            <ThemedText type="smallBold">Mapa offline</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {statuses === null
                ? 'Sprawdzam…'
                : areas.length === 0
                  ? 'Miejsca planu nie mają współrzędnych — uzupełnij je na webie („Uzupełnij współrzędne”).'
                  : `${done.length} z ${areas.length} obszarów na telefonie${done.length > 0 ? ` (${mb(done.reduce((sum, status) => sum + status.bytes, 0))})` : ''}: ${areas.map((area) => area.label).join(', ')}`}
            </ThemedText>
            {busy && <ThemedText type="small">{progress}</ThemedText>}
            {areas.length > 0 && (
              <View style={styles.row}>
                {done.length < areas.length && <Button label={busy ? 'Pobieram…' : 'Pobierz mapę wyjazdu'} variant="primary" disabled={busy} onPress={() => void download()} />}
                {done.length > 0 && !busy && <Button label="Usuń" onPress={remove} small />}
              </View>
            )}
          </View>
        )}
      </ThemedView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  pad: { padding: Spacing.three },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one + 2, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  me: { position: 'absolute', right: Spacing.three, top: Spacing.three, width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center', elevation: 3 },
  panel: { padding: Spacing.three, borderTopWidth: 1, gap: Spacing.two },
  block: { gap: Spacing.one },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, paddingTop: Spacing.one },
});
