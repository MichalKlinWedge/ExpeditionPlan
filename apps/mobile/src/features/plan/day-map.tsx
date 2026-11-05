import { dayMap, type DayMap as DayMapData, type DaySchedule, type PlanItem, type TripDocument } from '@expeditionplan/core';
import { Camera, type CameraRef, Map as MapView, UserLocation } from '@maplibre/maplibre-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
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
 * Wybrana pinezka i numery na liście punktów to ten sam stan w planie dnia.
 */

/**
 * Numery i pinezki dnia dla listy punktów i mapy. `refs` to kolejność z silnika w jednym napisie,
 * więc przelicza się przy zmianie planu dnia, a nie przy każdym odświeżeniu „teraz”.
 */
export function useDayStops(doc: TripDocument, refs: string, baseRef: string | undefined) {
  return useMemo(() => {
    const map = dayMap(doc, refs === '' ? [] : refs.split(','), { baseRef });
    return { map, pinOf: new Map(map.pins.flatMap((pin) => pin.stops.map((stop) => [stop.ref, pin] as const))) };
  }, [doc, refs, baseRef]);
}

type Props = {
  dayRef: string;
  schedule: DaySchedule;
  /** Mapa z kolejności dnia: te same numery co na liście punktów. */
  full: DayMapData;
  selected: string | null;
  onSelect: (placeRef: string | null) => void;
  /** Punkt wybrany na liście: mapa przesuwa się do niego. Nowy obiekt przy każdym dotknięciu. */
  focus: { lng: number; lat: number } | null;
  /** Miejsca z przewodnikiem: `placeRef` → punkt (`guidedPlaces`). */
  guides?: Map<string, PlanItem>;
  onGuide?: (item: PlanItem, play: boolean) => void;
};

export function DayMap({ dayRef, schedule, full, selected, onSelect, focus, guides, onGuide }: Props) {
  const theme = useTheme();
  const mapStyle = useMapStyle();
  const camera = useRef<CameraRef>(null);
  const [showTransit, setShowTransit] = useState(false);
  const transit = hasTransit(full);
  // Punkt wybrany na liście bywa dojazdem: wtedy dojazd widać mimo wyłączonego przełącznika.
  const transitChosen = full.pins.some((each) => each.placeRef === selected && each.transit);
  // Dzień złożony z samego dojazdu — pokazujemy go mimo wyłączonego przełącznika.
  const shown = showTransit || transitChosen || full.pins.every((pin) => pin.transit);
  const view = withoutTransit(full, shown);
  const times = new Map(schedule.items.map((item) => [item.ref, item.startLocal]));

  useEffect(() => {
    if (focus !== null) camera.current?.flyTo({ center: [focus.lng, focus.lat], duration: 500 });
  }, [focus]);

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
        <MapView key={`${dayRef}:${shown}`} mapStyle={mapStyle} androidView="surface" onPress={() => onSelect(null)}>
          <Camera ref={camera} initialViewState={start} />
          <UserLocation accuracy />
          <DayLines lines={view.lines} id="plan-day" />
          <PinMarkers pins={view.pins} selected={selected} onSelect={onSelect} guided={guides === undefined ? undefined : new Set(guides.keys())} />
        </MapView>
        {transit && (
          <TransitToggle
            value={showTransit || transitChosen}
            onChange={(value) => {
              setShowTransit(value);
              if (!value && transitChosen) onSelect(null);
            }}
          />
        )}
      </View>
      {pin ? (
        <PinCard
          pin={pin}
          times={times}
          onClose={() => onSelect(null)}
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
