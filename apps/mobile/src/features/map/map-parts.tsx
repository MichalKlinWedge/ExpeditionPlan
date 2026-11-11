import type { MapLine, MapPin } from '@expeditionplan/core';
import { GeoJSONSource, Layer, Marker } from '@maplibre/maplibre-react-native';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { navigate } from '@/lib/navigate';

/**
 * Wspólne części map telefonu (zakładka Mapa i mapa dnia w Planie): linie dnia, pinezki z numerami
 * kolejności (📖 = miejsce z przewodnikiem), karta miejsca z „Nawiguj” i „Poczytaj / Posłuchaj”. Dane z `dayMap` (packages/core) — tej samej co na webie.
 */

const BASE = '#1B2A41';

/** Widok mapy bez dojazdu i powrotu (lot, długa droga) — skala kraju gubi szczegóły na miejscu. */
export function withoutTransit<T extends { pins: MapPin[]; lines: MapLine[] }>(view: T, show: boolean): T {
  return show ? view : { ...view, pins: view.pins.filter((pin) => !pin.transit), lines: view.lines.filter((line) => !line.transit) };
}

export const hasTransit = (view: { pins: MapPin[]; lines: MapLine[] }) => view.pins.some((pin) => pin.transit) || view.lines.some((line) => line.transit);

/** Przełącznik „✈ Dojazd i powrót” w rogu mapy. */
export function TransitToggle({ value, onChange }: { value: boolean; onChange: (value: boolean) => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={() => onChange(!value)}
      hitSlop={6}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      style={[styles.transit, value ? { backgroundColor: theme.accent } : { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected, borderWidth: 1 }]}>
      <ThemedText type="smallBold" style={{ color: value ? theme.onPrimary : theme.text }}>
        ✈ Dojazd i powrót
      </ThemedText>
    </Pressable>
  );
}

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

/** Szara pinezka miejsca tylko z puli (poza dniami). */
const POOL_PIN = '#8A94A3';
/** Atrakcja „po drodze i w pobliżu” (`MapPin.extra`): bursztynowa gwiazdka, mniejsza od punktów dnia. */
const EXTRA_PIN = '#F59E0B';

/** Pinezki: numery kolejności dnia, baza noclegowa ⌂, pula — szara, wybrana — pomarańczowa. Dzieci `<Map>`. */
export function PinMarkers({ pins, selected, onSelect, guided }: { pins: MapPin[]; selected: string | null; onSelect: (placeRef: string) => void; guided?: ReadonlySet<string> }) {
  const theme = useTheme();
  return pins.map((pin) => {
    const label = pin.stops.map((stop) => stop.n).join('·');
    return (
      <Marker key={pin.placeRef} lngLat={[pin.lng, pin.lat]} anchor="center" onPress={() => onSelect(pin.placeRef)}>
        {/* Znaczek przewodnika w zapasie kontenera — Android przycina widoki wystające poza rodzica. */}
        <View style={guided?.has(pin.placeRef) ? styles.pinBox : undefined}>
          <View
            style={[
              styles.pin,
              { backgroundColor: pin.placeRef === selected ? theme.primary : pin.base ? BASE : pin.extra ? EXTRA_PIN : pin.stops.length === 0 && pin.pool ? POOL_PIN : theme.accent },
              ((pin.stops.length === 0 && pin.pool) || pin.extra) && pin.placeRef !== selected && styles.poolPin,
              label.length > 2 && styles.pinWide,
            ]}>
            <ThemedText style={styles.pinText}>{label || (pin.base ? '⌂' : pin.extra ? '★' : '•')}</ThemedText>
          </View>
          {guided?.has(pin.placeRef) && (
            <View style={[styles.badge, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText style={styles.badgeText}>📖</ThemedText>
            </View>
          )}
        </View>
      </Marker>
    );
  });
}

export const navigateTo = (pin: MapPin) => navigate({ lat: pin.lat, lng: pin.lng, name: pin.name });

/** Przewodnik miejsca z karty pinezki: szczegóły albo od razu czytanie na głos. */
export type PinGuide = { onRead: () => void; onListen: () => void };

/** Punkty puli w miejscu: szczegóły (opis, przewodnik) i — dla organizatora/edytora — „Wstaw do dnia…”. */
export type PinPool = { onOpen: (ref: string) => void; onInsert?: (ref: string) => void };

/** Karta wybranego miejsca: nazwa, punkty z godzinami, punkty z puli, „Nawiguj” (Google Maps), przewodnik i „Zamknij”. */
export function PinCard({ pin, times, onClose, small = false, guide, pool, onExtra }: { pin: MapPin; times: Map<string, string>; onClose: () => void; small?: boolean; guide?: PinGuide; pool?: PinPool; onExtra?: () => void }) {
  return (
    <View style={styles.block}>
      <ThemedText type="smallBold" style={small ? undefined : styles.title}>
        {pin.name}
        {pin.base ? ' · nocleg' : ''}
        {pin.extra ? ' · ★ po drodze i w pobliżu' : ''}
      </ThemedText>
      {pin.stops.map((stop) => (
        <ThemedText key={stop.ref} type="small" themeColor="textSecondary">
          {stop.n}. {times.get(stop.ref) ?? ''} {stop.title}
        </ThemedText>
      ))}
      {pool &&
        pin.pool?.map((each) => (
          <View key={each.ref} style={styles.poolRow}>
            <ThemedText type="small" style={styles.poolTitle}>
              z puli: {each.title}
            </ThemedText>
            <Button label="Szczegóły" small onPress={() => pool.onOpen(each.ref)} />
            {pool.onInsert && <Button label="Wstaw do dnia…" small variant="primary" onPress={() => pool.onInsert!(each.ref)} />}
          </View>
        ))}
      <View style={styles.row}>
        <Button label="Nawiguj" variant="primary" small={small} onPress={() => navigateTo(pin)} />
        {guide && <Button label="📖 Poczytaj" small={small} onPress={guide.onRead} />}
        {guide && <Button label="▶ Posłuchaj" small={small} onPress={guide.onListen} />}
        {pin.extra && onExtra && <Button label="Szczegóły" small={small} onPress={onExtra} />}
        <Button label="Zamknij" small={small} onPress={onClose} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  transit: { position: 'absolute', left: Spacing.two, top: Spacing.two, borderRadius: 999, paddingHorizontal: Spacing.three, paddingVertical: 6, elevation: 3 },
  pin: { minWidth: 34, height: 34, borderRadius: 17, borderWidth: 2, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4, elevation: 3 },
  pinWide: { paddingHorizontal: 8 },
  poolPin: { minWidth: 24, height: 24, borderRadius: 12, opacity: 0.9 },
  poolRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  poolTitle: { flexShrink: 1 },
  pinText: { color: '#FFFFFF', fontSize: 14, lineHeight: 18, fontWeight: 800 },
  pinBox: { paddingTop: 10, paddingRight: 12 },
  badge: { position: 'absolute', top: 0, right: 0, borderRadius: 9, paddingHorizontal: 1, elevation: 4 },
  badgeText: { fontSize: 11, lineHeight: 15 },
  block: { gap: Spacing.one },
  title: { fontSize: 17, lineHeight: 22 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, paddingTop: Spacing.one },
});
