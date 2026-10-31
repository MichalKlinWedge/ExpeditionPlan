import * as Battery from 'expo-battery';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';

import { appendLog } from './log';

/**
 * Zadania w tle PoC-3 (geofencing i „Tryb spaceru”). Według dokumentacji SDK 58 `defineTask`
 * musi się wykonać przy ładowaniu modułu — ten plik importuje główny `_layout.tsx` jako pierwszy.
 */

export const GEOFENCE_TASK = 'poc3-geofence';
export const WALK_TASK = 'poc3-walk';

async function batteryPercent(): Promise<number | null> {
  try {
    const level = await Battery.getBatteryLevelAsync();
    return level < 0 ? null : Math.round(level * 100);
  } catch {
    return null;
  }
}

type GeofenceData = { eventType: Location.GeofencingEventType; region: Location.LocationRegion };

TaskManager.defineTask<GeofenceData>(GEOFENCE_TASK, async ({ data, error }) => {
  if (error) {
    await appendLog({ type: 'error', task: GEOFENCE_TASK, message: error.message });
    return;
  }
  const enter = data.eventType === Location.GeofencingEventType.Enter;
  const name = data.region.identifier ?? '?';
  await appendLog({ type: enter ? 'enter' : 'exit', mode: 'geofence', point: name, battery: await batteryPercent() });
  if (enter) {
    // Powiadomienie pozwala na spacerze od razu zobaczyć, czy i kiedy punkt „zaskoczył”.
    await Notifications.scheduleNotificationAsync({
      content: { title: `Punkt: ${name}`, body: 'Geofencing wykrył wejście.' },
      trigger: null,
    });
  }
});

type WalkData = { locations: Location.LocationObject[] };

/** Ostatnio zgłoszone punkty w trybie spaceru — wejście raz na wizytę, nie przy każdym odczycie. */
const inside = new Set<string>();

TaskManager.defineTask<WalkData>(WALK_TASK, async ({ data, error }) => {
  if (error) {
    await appendLog({ type: 'error', task: WALK_TASK, message: error.message });
    return;
  }
  const { walkPoints } = await import('./points');
  const points = await walkPoints();
  for (const location of data.locations) {
    const { latitude, longitude, accuracy } = location.coords;
    await appendLog({ type: 'fix', mode: 'walk', at: location.timestamp, lat: latitude, lng: longitude, accuracy });
    for (const point of points) {
      const meters = distanceM(latitude, longitude, point.latitude, point.longitude);
      const radius = point.radius ?? WALK_RADIUS_M;
      if (meters <= radius && !inside.has(point.id)) {
        inside.add(point.id);
        await appendLog({ type: 'enter', mode: 'walk', point: point.name, meters: Math.round(meters), battery: await batteryPercent() });
        await Notifications.scheduleNotificationAsync({
          content: { title: `Punkt: ${point.name}`, body: `Tryb spaceru: ${Math.round(meters)} m.` },
          trigger: null,
        });
      } else if (meters > radius * 1.5 && inside.has(point.id)) {
        inside.delete(point.id);
        await appendLog({ type: 'exit', mode: 'walk', point: point.name });
      }
    }
  }
});

/** Promień w trybie spaceru (dokładny GPS) — PLAN_ETAPOWY: 30–50 m. */
export const WALK_RADIUS_M = 40;
/** Promień geofence w tle — zalecane przez Androida 100–150 m (docs/USLUGI.md). */
export const GEOFENCE_RADIUS_M = 100;

export function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}
