import { dayChip, dayLodging, dayMap, instantToZoned, type MapLine, type MapPin, moveToDay, type PlanItem, scheduleDay, transitPlaceRefs, type TripDocument, tripMapAreas } from '@expeditionplan/core';
import { type CachedTrip, cachedTrip, refreshTrip, savePlanEdit } from '@expeditionplan/sync';
import type { SupabaseClient } from '@supabase/supabase-js';
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
import { guidedPlaces, ItemDetails } from '@/features/plan/item-details';
import { DayPicker } from '@/features/plan/item-editor';
import { PoolDrop } from '@/features/map/pool-drop';
import { cachedTrips } from '@/features/trips/my-trips';
import { useMapStyle } from '@/features/map/map-style';
import { mapTransit, setMapTransit } from '@/features/map/map-transit';
import { type AreaStatus, areaStatuses, deleteAreas, downloadAreas } from '@/features/map/offline-packs';
import { offlineChanged } from '@/features/trip/offline-download';
import { useTheme } from '@/hooks/use-theme';
import { localDb, remote } from '@/lib/local-db';
import { supabase } from '@/lib/supabase';

/**
 * Mapa wyjazdu: pinezki dnia z numerami kolejności (ta sama `dayMap` co na webie), cała trasa,
 * nawigacja do miejsca i mapa offline — obszary liczone z miejsc planu (`tripMapAreas`),
 * pobierane jednym przyciskiem. „✈ Dojazd i powrót” (zapamiętany dla wyjazdu, `map-transit.ts`)
 * chowa lotnisko w domu itp.: wyłączony skupia mapę na miejscu i pobiera tylko obszar podróży.
 * Plan z pamięci telefonu, więc działa bez sieci. Organizator i edytor
 * długim przytrzymaniem dodają w tym miejscu punkt do puli (online). „Pula” pokazuje szare pinezki
 * punktów spoza dni — opis z przewodnikiem i „Wstaw do dnia…”.
 */

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** Punkty puli (bez dnia) dopisane do pinezek widoku: w istniejącej pinezce albo nowa szara. */
function withPool(doc: TripDocument, pins: MapPin[]): MapPin[] {
  const out = new Map(pins.map((pin) => [pin.placeRef, { ...pin }]));
  for (const item of doc.items) {
    if (item.dayRef !== undefined || item.parentRef !== undefined) continue;
    const place = doc.places.find((each) => each.ref === (item.leg?.toPlaceRef ?? item.placeRef));
    if (place?.lat === undefined || place.lng === undefined) continue;
    const pin = out.get(place.ref) ?? { placeRef: place.ref, name: place.name, lat: place.lat, lng: place.lng, stops: [] };
    pin.pool = [...(pin.pool ?? []), { ref: item.ref, title: item.title }];
    out.set(place.ref, pin);
  }
  return [...out.values()];
}

/** Wszystkie miejsca planu ze współrzędnymi (widok „Cała trasa”), bazy noclegowe wyróżnione, miejsca tylko dojazdu — `transit`. */
function tripPins(doc: TripDocument): MapPin[] {
  const used = new Set(doc.items.flatMap((item) => [item.placeRef, item.leg?.fromPlaceRef, item.leg?.toPlaceRef].filter((ref): ref is string => ref !== undefined)));
  const bases = new Set(doc.days.flatMap((day) => (day.baseRef ? [day.baseRef] : [])));
  const transit = transitPlaceRefs(doc);
  return doc.places.flatMap((place) =>
    place.lat !== undefined && place.lng !== undefined && (used.has(place.ref) || bases.has(place.ref))
      ? [{ placeRef: place.ref, name: place.name, lat: place.lat, lng: place.lng, stops: [], ...(bases.has(place.ref) ? { base: true } : {}), ...(transit.has(place.ref) ? { transit: true } : {}) }]
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
  /** Przewodnik otwarty z karty pinezki; `play` — od razu czytaj na głos. */
  const [reading, setReading] = useState<{ item: PlanItem; play: boolean } | null>(null);
  const [statuses, setStatuses] = useState<AreaStatus[] | null>(null);
  const [progress, setProgress] = useState('');
  /** Długie przytrzymanie: miejsce nowego punktu w puli. */
  const [dropAt, setDropAt] = useState<{ lat: number; lng: number } | null>(null);
  const role = cachedTrips()?.find((each) => each.id === tripId)?.role;
  const canDrop = signedIn && (role === 'owner' || role === 'editor');

  useEffect(() => {
    if (signedIn) void refreshTrip(localDb, remote, tripId).then(setTrip, () => undefined);
  }, [tripId, signedIn]);

  const doc = trip?.state.doc ?? null;
  const [showTransit, setShowTransit] = useState(() => mapTransit(tripId));
  const areas = useMemo(() => (doc ? tripMapAreas(doc, { transit: showTransit }) : []), [doc, showTransit]);
  const refreshStatuses = useCallback(() => {
    void areaStatuses(tripId, areas).then(setStatuses, () => setStatuses([]));
  }, [tripId, areas]);
  useEffect(refreshStatuses, [refreshStatuses]);

  const dayRef = doc && day >= 0 ? doc.days[day]?.ref : undefined;
  const [showPool, setShowPool] = useState(false);
  /** „Wstaw do dnia…” z karty pinezki puli — wybór dnia. */
  const [inserting, setInserting] = useState<string | null>(null);
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
  const view = useMemo(() => {
    if (full === null || doc === null) return null;
    // Dzień złożony z samego dojazdu — pokazujemy go mimo wyłączonego przełącznika.
    const shown = withoutTransit(full, showTransit || full.pins.every((pin) => pin.transit));
    return showPool ? { ...shown, pins: withPool(doc, shown.pins) } : shown;
  }, [full, showTransit, showPool, doc]);
  /** Miejsca tylko dojazdu i powrotu — przełącznik ma sens także w widoku dnia bez dojazdu (obszary offline). */
  const transitPlaces = useMemo(() => (doc ? transitPlaceRefs(doc).size : 0), [doc]);
  const poolCount = doc === null ? 0 : doc.items.filter((item) => item.dayRef === undefined && item.parentRef === undefined).length;

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
  const guides = trip === null ? new Map<string, PlanItem>() : guidedPlaces(trip);
  const pinGuide = pin === null ? undefined : guides.get(pin.placeRef);
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
          <Chip key={each.ref} compact active={index === day} label={dayChip(each.date)} onPress={() => setDay(index)} />
        ))}
        {poolCount > 0 && <Chip compact active={showPool} label={`Pula (${poolCount})`} onPress={() => setShowPool(!showPool)} />}
      </View>

      <View style={styles.fill}>
        <MapView
          mapStyle={mapStyle}
          androidView="surface"
          onPress={() => setSelected(null)}
          onLongPress={
            canDrop
              ? (event) => {
                  const [lng, lat] = event.nativeEvent.lngLat;
                  setSelected(null);
                  setDropAt({ lat, lng });
                }
              : undefined
          }>
          <Camera ref={camera} initialViewState={areas[0] ? { bounds: areas[0].bounds } : undefined} />
          <UserLocation accuracy />
          <DayLines lines={view.lines} id="day-lines" />
          <PinMarkers pins={view.pins} selected={selected} onSelect={setSelected} guided={new Set(guides.keys())} />
        </MapView>
        {(transit || transitPlaces > 0) && (
          <TransitToggle
            value={showTransit}
            onChange={(value) => {
              setShowTransit(value);
              setMapTransit(tripId, value);
              offlineChanged(tripId);
              if (!value && full?.pins.some((each) => each.placeRef === selected && each.transit)) setSelected(null);
            }}
          />
        )}
        <Pressable onPress={() => void centerOnMe()} style={[styles.me, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]} hitSlop={6}>
          <ThemedText type="smallBold">◎</ThemedText>
        </Pressable>
      </View>

      <ThemedView style={[styles.panel, { borderTopColor: theme.backgroundSelected }]}>
        {dropAt && trip !== null ? (
          <PoolDrop
            trip={trip}
            tripId={tripId}
            at={dropAt}
            onDone={(updated) => {
              if (updated !== null) setTrip(updated);
              setDropAt(null);
            }}
          />
        ) : pin ? (
          <PinCard
            pin={pin}
            times={times}
            onClose={() => setSelected(null)}
            guide={pinGuide === undefined ? undefined : { onRead: () => setReading({ item: pinGuide, play: false }), onListen: () => setReading({ item: pinGuide, play: true }) }}
            pool={{
              onOpen: (ref) => {
                const item = doc.items.find((each) => each.ref === ref);
                if (item) setReading({ item, play: false });
              },
              ...(canDrop ? { onInsert: (ref: string) => setInserting(ref) } : {}),
            }}
          />
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
            {transitPlaces > 0 && areas.length > 0 && (
              <ThemedText type="small" themeColor="textSecondary">
                {showTransit ? 'Z dojazdem i powrotem (lotnisko w domu itp.).' : 'Bez dojazdu i powrotu — tylko obszar podróży.'} Zmienia to „✈ Dojazd i powrót” na mapie.
              </ThemedText>
            )}
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
      {trip !== null && <ItemDetails trip={trip} item={reading?.item ?? null} autoPlay={reading?.play ?? false} onClose={() => setReading(null)} />}
      {trip !== null && (
        <DayPicker
          doc={doc}
          current=""
          visible={inserting !== null}
          onCancel={() => setInserting(null)}
          onPick={(target) => {
            const ref = inserting;
            setInserting(null);
            if (ref === null || target === null) return;
            const edit = moveToDay(doc, ref, target);
            if (edit === null) return;
            setSelected(null);
            void savePlanEdit(supabase as unknown as SupabaseClient, tripId, edit, trip.ids)
              .then(() => refreshTrip(localDb, remote, tripId))
              .then(setTrip, (e: unknown) => Alert.alert('Nie zapisano', `${e instanceof Error ? e.message : String(e)}\n\nZmiana planu wymaga połączenia z internetem.`));
          }}
        />
      )}
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
