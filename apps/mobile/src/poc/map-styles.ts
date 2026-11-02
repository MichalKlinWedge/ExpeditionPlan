import type { StyleSpecification } from '@maplibre/maplibre-react-native';
import { layers, namedFlavor } from '@protomaps/basemaps';

/**
 * Style mapy (docs/USLUGI.md): online i paczki `OfflineManager` z OpenFreeMap (mapa wyjazdu),
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
