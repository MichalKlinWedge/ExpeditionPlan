import { tripReminders, type TripDocument } from '@expeditionplan/core';
import { cachedTrip } from '@expeditionplan/sync';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { Platform } from 'react-native';

import { cachedTrips } from '@/features/trips/my-trips';
import { localDb } from '@/lib/local-db';

/**
 * Przypomnienia o zadaniach z planu jako powiadomienia lokalne (działają offline, `tripReminders`
 * z packages/core). Włączane w Ustawieniach; przeliczane przy każdym wczytaniu planu — stare
 * przypomnienia wyjazdu znikają, nowe wchodzą. Najwyżej 30 na wyjazd (limit alarmów Androida).
 */

const KEY = 'reminders-enabled';
const CHANNEL = 'reminders';
const PER_TRIP = 30;

export const remindersEnabled = () => localStorage.getItem(KEY) === '1';

async function ensureChannel() {
  if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync(CHANNEL, { name: 'Przypomnienia z planu', importance: AndroidImportance.DEFAULT });
}

async function clearTrip(tripId: string) {
  for (const each of await Notifications.getAllScheduledNotificationsAsync()) {
    if (each.content.data?.reminderTrip === tripId) await Notifications.cancelScheduledNotificationAsync(each.identifier);
  }
}

/** Przelicza przypomnienia wyjazdu (po wczytaniu albo zmianie planu). Bez zgody — nic nie robi. */
export async function scheduleTripReminders(tripId: string, doc: TripDocument): Promise<number> {
  if (!remindersEnabled()) return 0;
  await clearTrip(tripId);
  const list = tripReminders(doc, Date.now()).slice(0, PER_TRIP);
  for (const reminder of list) {
    await Notifications.scheduleNotificationAsync({
      content: { title: reminder.title, body: reminder.body, data: { reminderTrip: tripId, key: reminder.key } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: reminder.at, channelId: CHANNEL },
    });
  }
  return list.length;
}

/** Włączenie w Ustawieniach: zgoda na powiadomienia i przeliczenie wszystkich wyjazdów z telefonu. */
export async function enableReminders(): Promise<{ ok: boolean; count: number }> {
  const permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) return { ok: false, count: 0 };
  localStorage.setItem(KEY, '1');
  await ensureChannel();
  let count = 0;
  for (const trip of cachedTrips() ?? []) {
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
