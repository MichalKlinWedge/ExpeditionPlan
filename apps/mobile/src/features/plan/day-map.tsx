import { dayMap, type DaySchedule, type TripDocument } from '@expeditionplan/core';
import { Camera, Map as MapView, UserLocation } from '@maplibre/maplibre-react-native';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { DayLines, PinCard, PinMarkers } from '@/features/map/map-parts';
import { useMapStyle } from '@/features/map/map-style';
import { useTheme } from '@/hooks/use-theme';

/**
 * Kwadratowa mapa pod planem dnia: pinezki z numerami kolejności z silnika (ta sama `dayMap` co
 * na webie i w zakładce Mapa), trasy przejazdów i własna pozycja. Dotknięcie pinezki pokazuje
 * punkty w tym miejscu i „Nawiguj”. Kafle z pobranej mapy offline działają bez sieci.
 */

export function DayMap({ doc, dayRef, schedule }: { doc: TripDocument; dayRef: string; schedule: DaySchedule }) {
  const theme = useTheme();
  const mapStyle = useMapStyle();
  const [selected, setSelected] = useState<string | null>(null);
  const baseRef = doc.days.find((each) => each.ref === dayRef)?.baseRef;
  const refs = schedule.items.map((item) => item.ref).join(',');
  // Klucz z kolejności — przelicza się przy zmianie planu dnia, nie przy każdym odświeżeniu „teraz”.
  const view = useMemo(() => dayMap(doc, refs === '' ? [] : refs.split(','), { baseRef }), [doc, refs, baseRef]);
  const times = new Map(schedule.items.map((item) => [item.ref, item.startLocal]));

  if (view.pins.length === 0) {
    return (
      <ThemedText type="small" themeColor="textSecondary">
        Żaden punkt tego dnia nie ma miejsca ze współrzędnymi — mapy dnia nie będzie.
      </ThemedText>
    );
  }

  const lngs = view.pins.map((pin) => pin.lng);
  const lats = view.pins.map((pin) => pin.lat);
  const start =
    view.pins.length === 1
      ? { center: [lngs[0]!, lats[0]!] as [number, number], zoom: 14 }
      : { bounds: [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)] as [number, number, number, number], padding: { top: 40, right: 40, bottom: 40, left: 40 } };
  const pin = view.pins.find((each) => each.placeRef === selected) ?? null;

  return (
    <View style={styles.wrap}>
      <View style={[styles.square, { borderColor: theme.backgroundSelected }]}>
        {/* Nowy dzień = nowa mapa z widokiem dopasowanym do jego pinezek. */}
        <MapView key={dayRef} mapStyle={mapStyle} androidView="surface" onPress={() => setSelected(null)}>
          <Camera initialViewState={start} />
          <UserLocation accuracy />
          <DayLines lines={view.lines} id="plan-day" />
          <PinMarkers pins={view.pins} selected={selected} onSelect={setSelected} />
        </MapView>
      </View>
      {pin ? (
        <PinCard pin={pin} times={times} onClose={() => setSelected(null)} small />
      ) : (
        <ThemedText type="small" themeColor="textSecondary">
          Numery = kolejność dnia. Dotknij pinezki, żeby nawigować.
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.two },
  square: { width: '100%', aspectRatio: 1, borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
});
