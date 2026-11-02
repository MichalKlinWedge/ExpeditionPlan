import type { MapArea } from '@expeditionplan/core';
import { OfflineManager, type OfflinePack } from '@maplibre/maplibre-react-native';

import { OPENFREEMAP_STYLE } from '@/poc/map-styles';

/**
 * Paczki mapy offline wyjazdu (MapLibre `OfflineManager`, kafle OpenFreeMap). Paczka niesie
 * w metadanych wyjazd, klucz obszaru i jego granice — po zmianie planu obszar z innymi granicami
 * pobiera się od nowa. Pobieranie po jednej paczce (warunki OpenFreeMap: ≤ 3000 kafli na pobranie).
 */

export type AreaStatus = { area: MapArea; pack?: OfflinePack; done: boolean; bytes: number };

const sameBounds = (a: unknown, b: number[]) => Array.isArray(a) && a.length === 4 && a.every((value, i) => Math.abs(Number(value) - b[i]!) < 1e-6);

/** Stan obszarów wyjazdu: które są już pobrane i ile zajmują. */
export async function areaStatuses(tripId: string, areas: MapArea[]): Promise<AreaStatus[]> {
  const packs = (await OfflineManager.getPacks()).filter((pack) => pack.metadata.trip === tripId);
  return Promise.all(
    areas.map(async (area) => {
      const pack = packs.find((each) => each.metadata.key === area.key && sameBounds(each.metadata.bounds, area.bounds));
      if (pack === undefined) return { area, done: false, bytes: 0 };
      const status = await pack.status();
      return { area, pack, done: status.state === 'complete', bytes: status.completedResourceSize };
    }),
  );
}

/** Pobiera brakujące obszary po kolei; stare paczki wyjazdu (inne granice) usuwa. */
export async function downloadAreas(tripId: string, areas: MapArea[], onProgress: (text: string) => void): Promise<void> {
  // Limit MapLibre jest łączny dla wszystkich paczek; warunek OpenFreeMap pilnuje rozmiar każdego obszaru.
  OfflineManager.setTileCountLimit(100_000);
  const statuses = await areaStatuses(tripId, areas);
  const current = new Set(statuses.flatMap((status) => (status.pack ? [status.pack.id] : [])));
  for (const pack of (await OfflineManager.getPacks()).filter((each) => each.metadata.trip === tripId && !current.has(each.id))) {
    await OfflineManager.deletePack(pack.id);
  }
  const missing = statuses.filter((status) => !status.done);
  for (const [index, status] of missing.entries()) {
    if (status.pack) await OfflineManager.deletePack(status.pack.id);
    const { area } = status;
    await new Promise<void>((resolve, reject) => {
      void OfflineManager.createPack(
        { mapStyle: OPENFREEMAP_STYLE, bounds: area.bounds, minZoom: area.minZoom, maxZoom: area.maxZoom, metadata: { trip: tripId, key: area.key, bounds: area.bounds, name: area.label } },
        (_pack, progress) => {
          onProgress(`${index + 1}/${missing.length} ${area.label}: ${Math.round(progress.percentage)}%`);
          if (progress.state === 'complete') resolve();
        },
        (_pack, error) => reject(new Error(`${area.label}: ${error.message}`)),
      ).catch(reject);
    });
  }
}

/** Usuwa wszystkie paczki mapy tego wyjazdu. */
export async function deleteAreas(tripId: string): Promise<void> {
  for (const pack of (await OfflineManager.getPacks()).filter((each) => each.metadata.trip === tripId)) await OfflineManager.deletePack(pack.id);
}
