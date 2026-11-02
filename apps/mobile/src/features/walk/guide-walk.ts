import { File, Paths } from 'expo-file-system';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';

/**
 * Spacer z przewodnikiem (SPECYFIKACJA M8, „Tryb spaceru”): usługa pierwszoplanowa z dokładnym GPS,
 * a przy miejscu z opisem (do 100 m) powiadomienie „Jesteś przy X — posłuchać?”. Dotknięcie otwiera
 * szczegóły punktu i od razu czyta przewodnik (`GuideFromNotification`).
 * Zadanie w tle działa też bez ekranu aplikacji, więc cele leżą w pliku (nie w bazie), a ten moduł
 * importuje główny `_layout.tsx` — `defineTask` musi się wykonać przy ładowaniu.
 */

export const GUIDE_WALK_TASK = 'guide-walk';
/** Promień „jesteś przy” — przy dokładnym GPS (PoC-3: tryb spaceru 30–50 m, tu z zapasem na duże miejsca). */
export const GUIDE_RADIUS_M = 100;
const CHANNEL = 'guide';

export type GuideTarget = { key: string; name: string; lat: number; lng: number; tripId: string; itemRef: string };
type State = { targets: GuideTarget[]; inside: string[] };

const stateFile = () => new File(Paths.document, 'guide-walk.json');

function readState(): State {
  try {
    const file = stateFile();
    return file.exists ? (JSON.parse(file.textSync()) as State) : { targets: [], inside: [] };
  } catch {
    return { targets: [], inside: [] };
  }
}

function writeState(state: State) {
  const file = stateFile();
  if (!file.exists) file.create();
  file.write(JSON.stringify(state));
}

function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = Math.PI / 180;
  const h = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lng2 - lng1) * rad) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

type WalkData = { locations: Location.LocationObject[] };

TaskManager.defineTask<WalkData>(GUIDE_WALK_TASK, async ({ data, error }) => {
  if (error || !data?.locations?.length) return;
  const state = readState();
  const inside = new Set(state.inside);
  let changed = false;
  // Ostatni odczyt wystarcza — wcześniejsze z tej samej paczki są starsze.
  const { latitude, longitude, accuracy } = data.locations[data.locations.length - 1]!.coords;
  // Odczyt z dokładnością gorszą niż promień nie przesądza o wejściu (miasto, kanion ulicy).
  if (accuracy !== null && accuracy > GUIDE_RADIUS_M * 1.5) return;
  for (const target of state.targets) {
    const meters = distanceM(latitude, longitude, target.lat, target.lng);
    if (meters <= GUIDE_RADIUS_M && !inside.has(target.key)) {
      inside.add(target.key);
      changed = true;
      await Notifications.scheduleNotificationAsync({
        content: {
          title: `Jesteś przy: ${target.name}`,
          body: 'Dotknij, żeby posłuchać przewodnika.',
          data: { guideTrip: target.tripId, guideItem: target.itemRef },
        },
        trigger: { channelId: CHANNEL },
      });
    } else if (meters > GUIDE_RADIUS_M * 2 && inside.has(target.key)) {
      // Odejście na 200 m — przy powrocie powiadomienie przyjdzie znowu.
      inside.delete(target.key);
      changed = true;
    }
  }
  if (changed) writeState({ ...state, inside: [...inside] });
});

export const guideWalkRunning = () => Location.hasStartedLocationUpdatesAsync(GUIDE_WALK_TASK).catch(() => false);

export const guideTargets = () => readState().targets;

/** Start: cele do pliku, kanał powiadomień, usługa pierwszoplanowa z dokładnym GPS. */
export async function startGuideWalk(targets: GuideTarget[]): Promise<void> {
  writeState({ targets, inside: [] });
  await Notifications.setNotificationChannelAsync(CHANNEL, { name: 'Przewodnik na spacerze', importance: AndroidImportance.HIGH });
  await Location.startLocationUpdatesAsync(GUIDE_WALK_TASK, {
    accuracy: Location.Accuracy.High,
    timeInterval: 10_000,
    distanceInterval: 15,
    foregroundService: {
      notificationTitle: 'Expedition Planner — spacer z przewodnikiem',
      notificationBody: `Powiem, gdy będziesz przy opisanym miejscu (${targets.length}).`,
      killServiceOnDestroy: false,
    },
  });
}

export async function stopGuideWalk(): Promise<void> {
  if (await guideWalkRunning()) await Location.stopLocationUpdatesAsync(GUIDE_WALK_TASK);
}
