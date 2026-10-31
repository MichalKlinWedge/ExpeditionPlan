import type { StyleSpecification } from '@maplibre/maplibre-react-native';
import { layers, namedFlavor } from '@protomaps/basemaps';

/**
 * Style mapy do PoC-2 (docs/USLUGI.md): online i paczki `OfflineManager` z OpenFreeMap,
 * wariant główny — regionalny plik `.pmtiles` z buildu Protomaps otwarty jako `pmtiles://file://…`
 * (MapLibre Native Android obsługuje PMTiles od 11.7.0; wrapper 11.5.1 ma natywny 13.6.1).
 */

export const OPENFREEMAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

/**
 * Glify i sprite'y Protomaps są online; MapLibre trzyma je w pamięci podręcznej po pierwszym
 * użyciu — to, czy napisy zostają bez sieci, jest jednym z pomiarów PoC-2.
 */
const ASSETS = 'https://protomaps.github.io/basemaps-assets';

export function pmtilesStyle(fileUri: string): StyleSpecification {
  return {
    version: 8,
    glyphs: `${ASSETS}/fonts/{fontstack}/{range}.pbf`,
    sprite: `${ASSETS}/sprites/v4/light`,
    sources: {
      protomaps: {
        type: 'vector',
        url: `pmtiles://${fileUri}`,
        attribution: '© OpenStreetMap contributors, Protomaps',
      },
    },
    layers: layers('protomaps', namedFlavor('light'), { lang: 'pl' }),
  };
}

/** Liczba kafli w prostokącie dla zakresu zoomu — OpenFreeMap: najwyżej 3000 kafli na pobranie. */
export function tileCount(bounds: [number, number, number, number], minZoom: number, maxZoom: number): number {
  const [west, south, east, north] = bounds;
  const x = (lng: number, z: number) => Math.floor(((lng + 180) / 360) * 2 ** z);
  const y = (lat: number, z: number) => {
    const rad = (lat * Math.PI) / 180;
    return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z);
  };
  let total = 0;
  for (let z = minZoom; z <= maxZoom; z++) {
    total += (x(east, z) - x(west, z) + 1) * (y(south, z) - y(north, z) + 1);
  }
  return total;
}

/** Najwyższy zoom, przy którym paczka mieści się w limicie kafli. */
export function maxZoomWithin(bounds: [number, number, number, number], minZoom: number, limit: number, ceiling = 16): number {
  let zoom = minZoom;
  while (zoom < ceiling && tileCount(bounds, minZoom, zoom + 1) <= limit) zoom++;
  return zoom;
}
