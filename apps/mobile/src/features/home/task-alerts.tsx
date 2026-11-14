import { addDays, isDraft, isPostponed, localToday, type TaskDueContext, taskLimitDate, taskUrgency, type TripDocument } from '@expeditionplan/core';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { cachedTrips, setCurrentTrip } from '@/features/trips/my-trips';
import { localDb } from '@/lib/local-db';

/**
 * Start: otwarte zadania ze wszystkich moich zaplanowanych wyjazdów — po terminie i z terminem w ciągu
 * 30 dni (tyle, ile belka na webie). Przypomnienie przychodzi jako powiadomienie, ale po wejściu do
 * aplikacji zadanie ma być widać, dopóki nie zostanie odhaczone — dotknięcie otwiera zakładkę „Zadania”
 * tego wyjazdu. Dane prosto z bazy telefonu (wiersze zadań, dni, punktów i rezerwacji), więc offline też.
 */

/** Ile dni naprzód zadanie „zbliża się” (jak w belce na webie). */
const SOON_DAYS = 30;
/** Ile zadań pokazać na skróconej liście. */
const SHOWN = 4;

type Row = Record<string, unknown>;
/** `when` — data, po której zadanie wchodzi na kartę: termin albo własne przypomnienie, co bliżej. */
type Alert = { tripId: string; tripTitle: string; title: string; when: string; overdue: boolean; reminderOnly: boolean };

const refOf = (row: Row) => (typeof row.ref === 'string' ? row.ref : `id-${String(row.id)}`);
const dayDiff = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** „dziś”, „jutro”, „za 5 dni”, „5 dni po terminie” — od daty, która wprowadziła zadanie na kartę. */
function whenLabel(when: string, today: string, overdue = false): string {
  const days = dayDiff(today, when);
  if (days < 0) return overdue ? `${-days} ${-days === 1 ? 'dzień' : 'dni'} po terminie` : `${-days} ${-days === 1 ? 'dzień' : 'dni'} temu`;
  if (days === 0) return 'dziś';
  if (days === 1) return 'jutro';
  return `za ${days} dni`;
}

/** Otwarte zadania z terminem we wszystkich zaplanowanych wyjazdach, z bazy telefonu. */
function loadAlerts(today: string): Alert[] {
  // Z dniem zapasu na strefy: wyjazd zakończony wczoraj liczy się jeszcze dziś (jak na webie).
  const yesterday = addDays(today, -1);
  const planned = (cachedTrips() ?? []).filter((trip) => !isDraft(trip) && !isPostponed(trip) && typeof trip.end_date === 'string' && trip.end_date >= yesterday);
  if (planned.length === 0) return [];
  const marks = planned.map(() => '?').join(', ');
  const rows = localDb.all<{ tbl: string; trip_id: string; data: string }>(
    `select tbl, trip_id, data from rows where trip_id in (${marks}) and tbl in ('tasks', 'days', 'items', 'bookings') and deleted_at is null`,
    planned.map((trip) => trip.id!),
  );
  const parsed = rows.map((row) => ({ tbl: row.tbl, tripId: row.trip_id, data: JSON.parse(row.data) as Row }));
  const of = (tbl: string, tripId: string) => parsed.filter((row) => row.tbl === tbl && row.tripId === tripId).map((row) => row.data);

  return planned.flatMap((trip) => {
    const tripId = trip.id!;
    const days = of('days', tripId);
    const dayRef = new Map(days.map((row) => [String(row.id), refOf(row)]));
    const context: TaskDueContext = {
      trip: { startDate: trip.start_date!, endDate: trip.end_date! },
      days: days.map((row) => ({ ref: refOf(row), date: String(row.date) })),
      items: of('items', tripId).map((row) => ({ ref: refOf(row), dayRef: typeof row.day_id === 'string' ? dayRef.get(row.day_id) : undefined })),
      bookings: of('bookings', tripId).map((row) => ({ ref: refOf(row), start: typeof row.start_date === 'string' ? { date: row.start_date } : undefined })),
    };
    return of('tasks', tripId).flatMap((row) => {
      if (row.status !== 'open') return [];
      const task = { status: 'open' as const, due: (row.due ?? undefined) as TripDocument['tasks'][number]['due'], deadline: typeof row.deadline === 'string' ? row.deadline : undefined };
      const limit = taskLimitDate(context, task);
      // Własne przypomnienie liczy się osobno: zadanie bez terminu też ma być widać, gdy powiadomienie już przyszło.
      const remind = (row.remind_at as { date?: string } | null)?.date;
      const dates = [limit, remind].filter((date): date is string => date !== undefined);
      if (taskUrgency(dates, today, SOON_DAYS) === null) return [];
      const when = dates.sort()[0]!;
      return [{ tripId, tripTitle: String(trip.title), title: String(row.title ?? 'Zadanie'), when, overdue: limit !== undefined && limit < today, reminderOnly: limit === undefined }];
    });
  });
}

export function TaskAlerts() {
  const theme = useTheme();
  const [alerts, setAlerts] = useState<Alert[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      const today = localToday();
      try {
        setAlerts(loadAlerts(today).sort((a, b) => a.when.localeCompare(b.when)));
      } catch {
        setAlerts([]);
      }
    }, []),
  );

  if (alerts === null || alerts.length === 0) return null;
  const today = localToday();
  const overdue = alerts.filter((alert) => alert.overdue).length;
  const trips = new Set(alerts.map((alert) => alert.tripId));
  const open = (tripId: string) => {
    setCurrentTrip(tripId);
    router.navigate('/plan?tab=tasks');
  };

  return (
    <ThemedView type="backgroundElement" style={[styles.card, { borderLeftColor: overdue > 0 ? OVERDUE : theme.accent }]}>
      <ThemedText type="small" themeColor="textSecondary">
        DO ZROBIENIA
      </ThemedText>
      <ThemedText type="smallBold" style={overdue > 0 ? styles.overdue : undefined}>
        {overdue > 0 ? `${overdue} po terminie · ` : ''}
        {alerts.length - overdue > 0 ? `${alerts.length - overdue} w ciągu ${SOON_DAYS} dni` : 'zadania czekają'}
      </ThemedText>
      {alerts.slice(0, SHOWN).map((alert, at) => (
        <Pressable key={`${alert.tripId}-${at}`} onPress={() => open(alert.tripId)} hitSlop={6} style={styles.row}>
          <ThemedText type="small" style={alert.overdue ? styles.overdue : undefined}>
            ☐ {alert.title}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {alert.reminderOnly ? '🔔 ' : ''}
            {whenLabel(alert.when, today, alert.overdue)}
            {trips.size > 1 ? ` · ${alert.tripTitle}` : ''}
          </ThemedText>
        </Pressable>
      ))}
      {alerts.length > SHOWN && (
        <Pressable onPress={() => open(alerts[0]!.tripId)} hitSlop={6}>
          <ThemedText type="small" themeColor="accent">
            Wszystkie zadania → ({alerts.length})
          </ThemedText>
        </Pressable>
      )}
    </ThemedView>
  );
}

/** Czerwień zaległego zadania — ta sama co na liście zadań. */
const OVERDUE = '#dc2626';

const styles = StyleSheet.create({
  card: { padding: Spacing.three, borderRadius: 16, gap: Spacing.one, borderLeftWidth: 4 },
  row: { gap: 2, paddingVertical: 2 },
  overdue: { color: OVERDUE, fontWeight: '600' },
});
