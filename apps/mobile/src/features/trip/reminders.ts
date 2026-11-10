import { dayAlerts, goNoGoReminders, isPostponed, localToday, type Reminder, tripReminders, type TripDocument } from '@expeditionplan/core';
import { cachedTrip } from '@expeditionplan/sync';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { Platform } from 'react-native';

import { offlineDoneVersion } from '@/features/trip/offline-flag';
import { cachedTrips } from '@/features/trips/my-trips';
import { localDb } from '@/lib/local-db';

/**
 * Przypomnienia z planu jako powiadomienia lokalne (działają offline, packages/core): zadania
 * z terminem (`tripReminders`, najwyżej 30), „go / no-go” pogody 2 dni przed dniem pod gołym niebem
 * (`goNoGoReminders`) i oś dnia (`dayAlerts`: „Za 15 min: …”, termin decyzji
 * wariantu — najbliższe 25, osobny kanał „Plan dnia”). Włączane w Ustawieniach; przeliczane przy
 * każdym wczytaniu planu i po każdym zdarzeniu dnia (opóźnienie, pominięcie, wybór wariantu) —
 * godziny z silnika razem z zapisami czekającymi w outboxie, więc działa też bez sieci. Wyjazd
 * odłożony nie przypomina: jego daty są tylko orientacyjne.
 */

const KEY = 'reminders-enabled';
const CHANNEL = 'reminders';
const DAY_CHANNEL = 'day-plan';
const PER_TRIP = 30;

export const remindersEnabled = () => localStorage.getItem(KEY) === '1';

async function ensureChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL, { name: 'Przypomnienia z planu', importance: AndroidImportance.DEFAULT });
  await Notifications.setNotificationChannelAsync(DAY_CHANNEL, { name: 'Plan dnia', description: '„Za 15 min” przed punktami i termin decyzji wariantu', importance: AndroidImportance.HIGH });
}

async function clearTrip(tripId: string) {
  for (const each of await Notifications.getAllScheduledNotificationsAsync()) {
    if (each.content.data?.reminderTrip === tripId) await Notifications.cancelScheduledNotificationAsync(each.identifier);
  }
}

/** Przelicza przypomnienia wyjazdu (po wczytaniu albo zmianie planu). Bez zgody — nic nie robi. */
let channels: Promise<void> | null = null;

/** Jedno przeliczenie naraz na wyjazd — szybkie zapisy po sobie nie zdublują powiadomień. */
const queue = new Map<string, Promise<number>>();

export function scheduleTripReminders(tripId: string, doc: TripDocument): Promise<number> {
  const next = (queue.get(tripId) ?? Promise.resolve(0)).catch(() => 0).then(() => reschedule(tripId, doc));
  queue.set(tripId, next);
  return next;
}

async function reschedule(tripId: string, doc: TripDocument): Promise<number> {
  if (!remindersEnabled()) return 0;
  await (channels ??= ensureChannel());
  await clearTrip(tripId);
  if (cachedTrips()?.some((trip) => trip.id === tripId && isPostponed(trip))) return 0;
  // Opóźnienia, pominięcia i wybory z terenu — także te, które jeszcze czekają na sieć.
  const inputs = cachedTrip(localDb, tripId)?.state.inputs ?? {};
  const now = Date.now();
  const list = [
    ...tripReminders(doc, now)
      .slice(0, PER_TRIP)
      .map((reminder) => ({ ...reminder, channelId: CHANNEL })),
    ...goNoGoReminders(doc, now)
      .slice(0, 10)
      .map((reminder) => ({ ...reminder, channelId: CHANNEL })),
    ...dayAlerts(doc, inputs, now).map((reminder) => ({ ...reminder, channelId: DAY_CHANNEL })),
    ...offlineReminders(tripId, doc, now).map((reminder) => ({ ...reminder, channelId: CHANNEL })),
  ];
  for (const reminder of list) {
    await Notifications.scheduleNotificationAsync({
      content: { title: reminder.title, body: reminder.body, data: { reminderTrip: tripId, key: reminder.key } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: reminder.at, channelId: reminder.channelId },
    });
  }
  return list.length;
}

/**
 * „Pobierz wyjazd offline” 2 dni i dzień przed startem o 19:00 (czas telefonu), dopóki pakiet nie był
 * ani razu kompletny. Po kompletnym pobraniu `offline-download.ts` przelicza przypomnienia i to znika.
 */
function offlineReminders(tripId: string, doc: TripDocument, now: number): Reminder[] {
  const start = doc.days[0]?.date;
  if (start === undefined || offlineDoneVersion(tripId) !== null) return [];
  const [year, month, day] = start.split('-').map(Number) as [number, number, number];
  return [2, 1].flatMap((before) => {
    const at = new Date(year, month - 1, day - before, 19, 0).getTime();
    if (at <= now) return [];
    return [
      {
        at,
        title: 'Pobierz wyjazd offline',
        body: `„${doc.trip.title}” zaczyna się ${before === 1 ? 'jutro' : 'pojutrze'}, a na telefonie nie ma jeszcze mapy i dokumentów. Wyjazdy → wyjazd → „Pobierz offline”, najlepiej przez Wi-Fi.`,
        key: `offline-download-${before}`,
      },
    ];
  });
}

/** Start aplikacji i powrót na pierwszy plan: wyjazdy trwające albo zaczynające się jutro — oś dnia sięga 25 powiadomień do przodu. */
export async function refreshCurrentReminders(): Promise<void> {
  if (!remindersEnabled()) return;
  // Daty telefonu, nie UTC (strefa UTC+4 po północy to w UTC jeszcze wczoraj).
  const today = localToday();
  const tomorrow = localToday(new Date(Date.now() + 86_400_000));
  for (const trip of cachedTrips() ?? []) {
    // Odłożony na webie: przypomnienia zaplanowane wcześniej znikają też bez otwierania planu.
    if (trip.id != null && isPostponed(trip)) {
      await clearTrip(trip.id);
      continue;
    }
    if (trip.id == null || (trip.end_date ?? '') < today || (trip.start_date ?? '') > tomorrow) continue;
    const cached = cachedTrip(localDb, trip.id);
    if (cached) await scheduleTripReminders(trip.id, cached.state.doc);
  }
}

/** Włączenie w Ustawieniach: zgoda na powiadomienia i przeliczenie wszystkich wyjazdów z telefonu. */
export async function enableReminders(): Promise<{ ok: boolean; count: number }> {
  const permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) return { ok: false, count: 0 };
  localStorage.setItem(KEY, '1');
  await ensureChannel();
  let count = 0;
  for (const trip of cachedTrips() ?? []) {
    if (isPostponed(trip)) continue;
    const cached = trip.id ? cachedTrip(localDb, trip.id) : null;
    if (cached) count += await scheduleTripReminders(trip.id!, cached.state.doc);
  }
  return { ok: true, count };
}

export async function disableReminders(): Promise<void> {
  localStorage.removeItem(KEY);
  for (const each of await Notifications.getAllScheduledNotificationsAsync()) {
    if (each.content.data?.reminderTrip !== undefined) await Notifications.cancelScheduledNotificationAsync(each.identifier);
  }
}
