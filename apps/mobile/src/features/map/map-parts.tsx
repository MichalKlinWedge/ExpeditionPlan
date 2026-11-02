import type { MapLine, MapPin } from '@expeditionplan/core';
import { GeoJSONSource, Layer, Marker } from '@maplibre/maplibre-react-native';
import { Linking, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Wspólne części map telefonu (zakładka Mapa i mapa dnia w Planie): linie dnia, pinezki z numerami
 * kolejności, karta miejsca z „Nawiguj”. Dane z `dayMap` (packages/core) — tej samej co na webie.
 */

const BASE = '#1B2A41';

/** Trasy przejazdów (ORS) — linia ciągła; odcinki bez trasy — przerywana prosta. Dzieci `<Map>`. */
export function DayLines({ lines, id }: { lines: MapLine[]; id: string }) {
  const theme = useTheme();
  return [true, false].map((routed) => {
    const parts = lines.filter((line) => line.routed === routed && line.coordinates.length > 1);
    if (parts.length === 0) return null;
    return (
      <GeoJSONSource key={String(routed)} id={`${id}-${routed}`} data={{ type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: parts.map((line) => line.coordinates) } }}>
        <Layer
          id={`${id}-${routed}-layer`}
          type="line"
          style={routed ? { lineColor: theme.accent, lineWidth: 4, lineOpacity: 0.9 } : { lineColor: theme.accent, lineWidth: 3, lineOpacity: 0.7, lineDasharray: [2, 1.5] }}
        />
      </GeoJSONSource>
    );
  });
}

/** Pinezki: numery kolejności dnia, baza noclegowa ⌂, wybrana — pomarańczowa. Dzieci `<Map>`. */
export function PinMarkers({ pins, selected, onSelect }: { pins: MapPin[]; selected: string | null; onSelect: (placeRef: string) => void }) {
  const theme = useTheme();
  return pins.map((pin) => {
    const label = pin.stops.map((stop) => stop.n).join('·');
    return (
      <Marker key={pin.placeRef} lngLat={[pin.lng, pin.lat]} anchor="center" onPress={() => onSelect(pin.placeRef)}>
        <View style={[styles.pin, { backgroundColor: pin.placeRef === selected ? theme.primary : pin.base ? BASE : theme.accent }, label.length > 2 && styles.pinWide]}>
          <ThemedText style={styles.pinText}>{label || (pin.base ? '⌂' : '•')}</ThemedText>
        </View>
      </Marker>
    );
  });
}

export const navigateTo = (pin: MapPin) => void Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${pin.lat},${pin.lng}`);

/** Karta wybranego miejsca: nazwa, punkty z godzinami, „Nawiguj” (Google Maps) i „Zamknij”. */
export function PinCard({ pin, times, onClose, small = false }: { pin: MapPin; times: Map<string, string>; onClose: () => void; small?: boolean }) {
  return (
    <View style={styles.block}>
      <ThemedText type="smallBold" style={small ? undefined : styles.title}>
        {pin.name}
        {pin.base ? ' · nocleg' : ''}
      </ThemedText>
      {pin.stops.map((stop) => (
        <ThemedText key={stop.ref} type="small" themeColor="textSecondary">
          {stop.n}. {times.get(stop.ref) ?? ''} {stop.title}
        </ThemedText>
      ))}
      <View style={styles.row}>
        <Button label="Nawiguj" variant="primary" small={small} onPress={() => navigateTo(pin)} />
        <Button label="Zamknij" small={small} onPress={onClose} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pin: { minWidth: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4, elevation: 3 },
  pinWide: { paddingHorizontal: 7 },
  pinText: { color: '#FFFFFF', fontSize: 12, lineHeight: 16, fontWeight: 800 },
  block: { gap: Spacing.one },
  title: { fontSize: 17, lineHeight: 22 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, paddingTop: Spacing.one },
});
