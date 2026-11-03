import { dayLodging, dayMap, type DaySchedule, type PlanItem, type TripDocument } from '@expeditionplan/core';
import { Camera, Map as MapView, UserLocation } from '@maplibre/maplibre-react-native';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { DayLines, hasTransit, PinCard, PinMarkers, TransitToggle, withoutTransit } from '@/features/map/map-parts';
import { useMapStyle } from '@/features/map/map-style';
import { useTheme } from '@/hooks/use-theme';

/**
 * Kwadratowa mapa pod planem dnia: pinezki z numerami kolejności z silnika (ta sama `dayMap` co
 * na webie i w zakładce Mapa), trasy przejazdów i własna pozycja. Dotknięcie pinezki pokazuje
 * punkty w tym miejscu, „Nawiguj” i — gdy miejsce ma przewodnik — „Poczytaj / Posłuchaj”. Kafle z pobranej mapy offline działają bez sieci.
 */

type Props = {
  doc: TripDocument;
  dayRef: string;
  schedule: DaySchedule;
  /** Miejsca z przewodnikiem: `placeRef` → punkt (`guidedPlaces`). */
  guides?: Map<string, PlanItem>;
  onGuide?: (item: PlanItem, play: boolean) => void;
};

export function DayMap({ doc, dayRef, schedule, guides, onGuide }: Props) {
  const theme = useTheme();
  const mapStyle = useMapStyle();
  const [selected, setSelected] = useState<string | null>(null);
  const baseRef = dayLodging(doc, dayRef)?.placeRef;
  const refs = schedule.items.map((item) => item.ref).join(',');
  // Klucz z kolejności — przelicza się przy zmianie planu dnia, nie przy każdym odświeżeniu „teraz”.
  const full = useMemo(() => dayMap(doc, refs === '' ? [] : refs.split(','), { baseRef }), [doc, refs, baseRef]);
  const [showTransit, setShowTransit] = useState(false);
  const transit = hasTransit(full);
  // Dzień złożony z samego dojazdu — pokazujemy go mimo wyłączonego przełącznika.
  const view = withoutTransit(full, showTransit || full.pins.every((pin) => pin.transit));
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
        {/* Nowy dzień albo przełączony dojazd = nowa mapa z widokiem dopasowanym do pinezek. */}
        <MapView key={`${dayRef}:${showTransit}`} mapStyle={mapStyle} androidView="surface" onPress={() => setSelected(null)}>
          <Camera initialViewState={start} />
          <UserLocation accuracy />
          <DayLines lines={view.lines} id="plan-day" />
          <PinMarkers pins={view.pins} selected={selected} onSelect={setSelected} guided={guides === undefined ? undefined : new Set(guides.keys())} />
        </MapView>
        {transit && <TransitToggle value={showTransit} onChange={setShowTransit} />}
      </View>
      {pin ? (
        <PinCard
          pin={pin}
          times={times}
          onClose={() => setSelected(null)}
          small
          guide={(() => {
            const item = guides?.get(pin.placeRef);
            return item === undefined || onGuide === undefined ? undefined : { onRead: () => onGuide(item, false), onListen: () => onGuide(item, true) };
          })()}
        />
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
