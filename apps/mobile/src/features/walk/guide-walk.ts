import { distanceM } from '@expeditionplan/core';
import { File, Paths } from 'expo-file-system';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';

/**
 * Spacer z przewodnikiem (SPECYFIKACJA M8, „Tryb spaceru”): usługa pierwszoplanowa z dokładnym GPS,
 * a przy miejscu z opisem (do 100 m) powiadomienie „Jesteś przy X — posłuchać?”. Dotknięcie otwiera
 * szczegóły punktu i od razu czyta przewodnik (`GuideFromNotification`). Każde miejsce podpowiada
 * tylko raz: podpowiedziane zostają w osobnym pliku (`guideHeard`) także po zakończeniu spaceru, aż
 * do „Podpowiadaj znowu” (`clearGuideHeard`).
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
const heardFile = () => new File(Paths.document, 'guide-walk-heard.json');

/** Klucz podpowiedzianego miejsca: wyjazd + miejsce. */
export const heardKey = (target: Pick<GuideTarget, 'tripId' | 'key'>) => `${target.tripId}:${target.key}`;

/** Miejsca, o których powiadomienie już przyszło (wszystkie wyjazdy). */
export function guideHeard(): Set<string> {
  try {
    const file = heardFile();
    return new Set(file.exists ? (JSON.parse(file.textSync()) as string[]) : []);
  } catch {
    return new Set();
  }
}

function writeHeard(heard: Set<string>) {
  const file = heardFile();
  if (!file.exists) file.create();
  file.write(JSON.stringify([...heard]));
}

/** „Podpowiadaj znowu”: zapomina podpowiedziane miejsca wyjazdu. */
export function clearGuideHeard(tripId: string) {
  writeHeard(new Set([...guideHeard()].filter((key) => !key.startsWith(`${tripId}:`))));
}

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

type WalkData = { locations: Location.LocationObject[] };

TaskManager.defineTask<WalkData>(GUIDE_WALK_TASK, async ({ data, error }) => {
  if (error || !data?.locations?.length) return;
  const state = readState();
  const inside = new Set(state.inside);
  const heard = guideHeard();
  let changed = false;
  let heardChanged = false;
  // Ostatni odczyt wystarcza — wcześniejsze z tej samej paczki są starsze.
  const { latitude, longitude, accuracy } = data.locations[data.locations.length - 1]!.coords;
  // Odczyt z dokładnością gorszą niż promień nie przesądza o wejściu (miasto, kanion ulicy).
  if (accuracy !== null && accuracy > GUIDE_RADIUS_M * 1.5) return;
  for (const target of state.targets) {
    const meters = distanceM([longitude, latitude], [target.lng, target.lat]);
    if (meters <= GUIDE_RADIUS_M && !inside.has(target.key)) {
      inside.add(target.key);
      changed = true;
      // Raz wystarczy: miejsce już podpowiedziane nie wraca, także w kolejnym spacerze.
      if (heard.has(heardKey(target))) continue;
      heard.add(heardKey(target));
      heardChanged = true;
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
  if (heardChanged) writeHeard(heard);
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
