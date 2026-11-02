import { dayMap, type DaySchedule, type MapPin, type TripDocument } from '@expeditionplan/core';
import { Camera, GeoJSONSource, Layer, Map as MapView, Marker, UserLocation } from '@maplibre/maplibre-react-native';
import { useMemo, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useMapStyle } from '@/features/map/map-style';
import { useTheme } from '@/hooks/use-theme';

/**
 * Kwadratowa mapa pod planem dnia: pinezki z numerami kolejności z silnika (ta sama `dayMap` co
 * na webie i w zakładce Mapa), trasy przejazdów i własna pozycja. Dotknięcie pinezki pokazuje
 * punkty w tym miejscu i „Nawiguj”. Kafle z pobranej mapy offline działają bez sieci.
 */

const BASE = '#1B2A41';

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
  const navigate = (target: MapPin) => void Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${target.lat},${target.lng}`);

  return (
    <View style={styles.wrap}>
      <View style={[styles.square, { borderColor: theme.backgroundSelected }]}>
        {/* Nowy dzień = nowa mapa z widokiem dopasowanym do jego pinezek. */}
        <MapView key={dayRef} mapStyle={mapStyle} androidView="surface" onPress={() => setSelected(null)}>
          <Camera initialViewState={start} />
          <UserLocation accuracy />
          {[true, false].map((routed) => {
            const parts = view.lines.filter((line) => line.routed === routed && line.coordinates.length > 1);
            if (parts.length === 0) return null;
            return (
              <GeoJSONSource key={String(routed)} id={`plan-day-${routed}`} data={{ type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: parts.map((line) => line.coordinates) } }}>
                <Layer
                  id={`plan-day-${routed}-layer`}
                  type="line"
                  style={routed ? { lineColor: theme.accent, lineWidth: 4, lineOpacity: 0.9 } : { lineColor: theme.accent, lineWidth: 3, lineOpacity: 0.7, lineDasharray: [2, 1.5] }}
                />
              </GeoJSONSource>
            );
          })}
          {view.pins.map((each) => {
            const active = each.placeRef === selected;
            const label = each.stops.map((stop) => stop.n).join('·');
            return (
              <Marker key={each.placeRef} lngLat={[each.lng, each.lat]} anchor="center" onPress={() => setSelected(each.placeRef)}>
                <View style={[styles.pin, { backgroundColor: active ? theme.primary : each.base ? BASE : theme.accent }, label.length > 2 && styles.pinWide]}>
                  <ThemedText style={styles.pinText}>{label || (each.base ? '⌂' : '•')}</ThemedText>
                </View>
              </Marker>
            );
          })}
        </MapView>
      </View>
      {pin ? (
        <View style={styles.block}>
          <ThemedText type="smallBold">
            {pin.name}
            {pin.base ? ' · nocleg' : ''}
          </ThemedText>
          {pin.stops.map((stop) => (
            <ThemedText key={stop.ref} type="small" themeColor="textSecondary">
              {stop.n}. {times.get(stop.ref) ?? ''} {stop.title}
            </ThemedText>
          ))}
          <View style={styles.row}>
            <Button label="Nawiguj" variant="primary" small onPress={() => navigate(pin)} />
            <Button label="Zamknij" small onPress={() => setSelected(null)} />
          </View>
        </View>
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
  pin: { minWidth: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4, elevation: 3 },
  pinWide: { paddingHorizontal: 7 },
  pinText: { color: '#FFFFFF', fontSize: 12, lineHeight: 16, fontWeight: 800 },
  block: { gap: Spacing.one },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, paddingTop: Spacing.one },
});
