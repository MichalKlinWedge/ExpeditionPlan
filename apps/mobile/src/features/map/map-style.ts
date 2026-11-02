import type { StyleSpecification } from '@maplibre/maplibre-react-native';
import { File, Paths } from 'expo-file-system';
import { useEffect, useState } from 'react';

import { OPENFREEMAP_STYLE } from '@/poc/map-styles';

/**
 * Styl mapy z polskimi nazwami (jak na webie: `name:pl`, potem łaciński zapis, potem lokalny).
 * Styl OpenFreeMap pobiera się z sieci i zapisuje w pliku, żeby działał też offline — kafle, czcionki
 * i ikony mają te same adresy co w paczkach `OfflineManager`, więc biorą się z pobranych obszarów.
 */

const FILE = 'map-style-pl.json';

function polish(style: StyleSpecification): StyleSpecification {
  return {
    ...style,
    layers: style.layers.map((layer) => {
      if (layer.type !== 'symbol') return layer;
      const field = layer.layout?.['text-field'];
      if (field === undefined || !JSON.stringify(field).includes('name')) return layer;
      return { ...layer, layout: { ...layer.layout, 'text-field': ['coalesce', ['get', 'name:pl'], ['get', 'name:latin'], ['get', 'name']] } };
    }),
  };
}

function saved(): StyleSpecification | null {
  try {
    const file = new File(Paths.document, FILE);
    return file.exists ? (JSON.parse(file.textSync()) as StyleSpecification) : null;
  } catch {
    return null;
  }
}

/** Jedno pobranie stylu na uruchomienie aplikacji, wspólne dla wszystkich map (Mapa, mapa dnia w Planie). */
let fresh: Promise<StyleSpecification | null> | null = null;
function refresh(): Promise<StyleSpecification | null> {
  fresh ??= fetch(OPENFREEMAP_STYLE)
    .then((response) => (response.ok ? (response.json() as Promise<StyleSpecification>) : Promise.reject(new Error(String(response.status)))))
    .then(async (style) => {
      const next = polish(style);
      await new File(Paths.document, FILE).write(JSON.stringify(next));
      return next;
    })
    .catch(() => {
      fresh = null; // offline — spróbuje przy następnej mapie
      return null;
    });
  return fresh;
}

/** Styl dla `<Map mapStyle>`: zapisany na telefonie od razu, odświeżany z sieci, gdy jest. */
export function useMapStyle(): string | StyleSpecification {
  const [style, setStyle] = useState<string | StyleSpecification>(() => saved() ?? OPENFREEMAP_STYLE);
  useEffect(() => {
    let cancelled = false;
    void refresh().then((next) => {
      if (next !== null && !cancelled) setStyle(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return style;
}
