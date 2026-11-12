import { itemMap, type MapLine, type PlanItem, type TripDocument } from '@expeditionplan/core';
import { Camera, Map as MapView, Marker, UserLocation } from '@maplibre/maplibre-react-native';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { DayLines } from '@/features/map/map-parts';
import { useMapStyle } from '@/features/map/map-style';
import { useTheme } from '@/hooks/use-theme';
import { navigate } from '@/lib/navigate';

/**
 * Mapa w szczegółach punktu: miejsce punktu, a przy przejeździe i trasie — start (A), cel (B), postoje
 * w trasie (1, 2…) i linia (`itemMap` z packages/core: ślad z „Tras”, przebieg przejazdu, a bez nich
 * przerywana prosta). Własna pozycja jak na mapie dnia; kafle z pobranej mapy offline działają bez sieci.
 * Dotknięcie pinezki pokazuje jej nazwę z „Nawiguj”.
 */

const START = '#2E7D32';
const END = '#C62828';

export function ItemMap({ doc, item }: { doc: TripDocument; item: PlanItem }) {
  const theme = useTheme();
  const mapStyle = useMapStyle();
  const map = useMemo(() => itemMap(doc, item), [doc, item]);
  const [selected, setSelected] = useState<number | null>(null);
  if (map.points.length === 0) return null;

  const lines: MapLine[] = map.lines.map((line) => ({ coordinates: line.coordinates, routed: !line.straight }));
  const coords = [...map.points.map((point) => [point.lng, point.lat] as const), ...map.lines.flatMap((line) => line.coordinates)];
  const lngs = coords.map((each) => each[0]);
  const lats = coords.map((each) => each[1]);
  const single = map.points.length === 1 && map.lines.length === 0;
  const start = single
    ? { center: [lngs[0]!, lats[0]!] as [number, number], zoom: 15 }
    : { bounds: [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)] as [number, number, number, number], padding: { top: 36, right: 36, bottom: 36, left: 36 } };

  let stop = 0;
  const labels = map.points.map((point) => (point.kind === 'start' ? 'A' : point.kind === 'end' ? 'B' : point.kind === 'stop' ? String(++stop) : '•'));
  const color = (kind: string) => (kind === 'start' ? START : kind === 'end' ? END : theme.accent);
  const chosen = selected === null ? null : map.points[selected];

  return (
    <View style={styles.wrap}>
      <View style={[styles.frame, { borderColor: theme.backgroundSelected }]}>
        {/* Jawne `dragPan`: mapa zabiera dotyk przewijaniu szczegółów (jak mapa dnia). */}
        <MapView mapStyle={mapStyle} androidView="surface" dragPan onPress={() => setSelected(null)}>
          <Camera initialViewState={start} />
          <UserLocation accuracy />
          <DayLines lines={lines} id={`item-${item.ref}`} />
          {map.points.map((point, index) => (
            <Marker key={`${point.kind}-${index}`} lngLat={[point.lng, point.lat]} anchor="center" onPress={() => setSelected(index)}>
              <View style={[styles.pin, { backgroundColor: selected === index ? theme.primary : color(point.kind) }]}>
                <ThemedText style={styles.pinText}>{labels[index]}</ThemedText>
              </View>
            </Marker>
          ))}
        </MapView>
      </View>
      {chosen ? (
        <View style={styles.row}>
          <ThemedText type="small" style={styles.grow}>
            {labels[selected!]} — {chosen.name}
          </ThemedText>
          <Button small variant="primary" label="Nawiguj" onPress={() => navigate({ lat: chosen.lat, lng: chosen.lng, name: chosen.name })} />
        </View>
      ) : (
        map.points.length > 1 && (
          <ThemedText type="small" themeColor="textSecondary">
            {map.points.map((point, index) => `${labels[index]} ${point.name}`).join(' · ')}
            {map.lines.some((line) => line.straight) ? ' · linia przerywana = prosto, bez zapisanej trasy' : ''}
          </ThemedText>
        )
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.two },
  frame: { width: '100%', aspectRatio: 4 / 3, borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
  pin: { minWidth: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4, elevation: 3 },
  pinText: { color: '#FFFFFF', fontSize: 13, lineHeight: 17, fontWeight: 800 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  grow: { flex: 1 },
});
