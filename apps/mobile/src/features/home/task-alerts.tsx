import { addDays, isDraft, isPostponed, localToday, type TaskDueContext, taskDueDate, taskLimitDate, type TripDocument } from '@expeditionplan/core';
import { cachedTrip, setTaskStatus, updateTask } from '@expeditionplan/sync';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert as RnAlert, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/features/auth/session';
import { scheduleTripReminders } from '@/features/trip/reminders';
import { cachedTrips, setCurrentTrip } from '@/features/trips/my-trips';
import { syncPending } from '@/features/sync/sync-loop';
import { localDb } from '@/lib/local-db';

/**
 * Start: otwarte zadania ze wszystkich moich zaplanowanych wyjazdów. Zwinięta karta to trzy liczby —
 * po terminie, w najbliższym tygodniu i wszystkie; dotknięcie liczby rozwija listę pięciu zadań z
 * najbliższym terminem. W wierszu duże pole do odhaczenia, a dotknięcie treści otwiera okno zadania
 * (odhaczenie i zmiana przypomnienia — zapis przez outbox, więc działa offline). Dane prosto z wierszy
 * w bazie telefonu, bez wczytywania całych planów.
 */

/** „Najbliższy tydzień” w zwiniętej karcie. */
const WEEK_DAYS = 7;
/** Ile zadań pokazuje rozwinięta karta. */
const SHOWN = 5;
/** Godzina podpowiadanych przypomnień. */
const DEFAULT_TIME = '09:00';
/** Czerwień zaległego zadania — ta sama co na liście zadań. */
const OVERDUE = '#dc2626';

type Row = Record<string, unknown>;
type Group = 'overdue' | 'week' | 'all';
type Task = {
  id: string;
  tripId: string;
  tripTitle: string;
  title: string;
  body: string;
  priority: string;
  /** Data graniczna terminu (`taskLimitDate`); razem z przypomnieniem decyduje, kiedy zadanie wchodzi na kartę. */
  limit?: string;
  due?: string;
  deadline?: string;
  remind?: { date: string; time: string };
  overdue: boolean;
  /** Odhaczone tutaj przed chwilą: wiersz zostaje na liście (przypadkowe dotknięcie widać i da się cofnąć). */
  done: boolean;
  /** Odhaczenie: organizator i edytor zawsze, widz — swoje zadania (RLS `tasks_update`). */
  canCheck: boolean;
  /** Zmiana przypomnienia: organizator i edytor (trigger `guard_viewer_task`). */
  canEdit: boolean;
};

const refOf = (row: Row) => (typeof row.ref === 'string' ? row.ref : `id-${String(row.id)}`);
const dayDiff = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const plural = (days: number) => (days === 1 ? 'dzień' : 'dni');
/** Data, po której zadanie wchodzi na kartę: termin albo własne przypomnienie — co wcześniej. */
const whenOf = (task: Task) => [task.limit, task.remind?.date].filter((date): date is string => date !== undefined).sort()[0];
/** „5.12” — dzień i miesiąc z daty ISO. */
const shortDate = (date: string) => `${Number(date.slice(8))}.${date.slice(5, 7)}`;
/** „🔔 5.12 09:00” — własne przypomnienie zadania. */
const remindLabel = (task: Task) => (task.remind === undefined ? '' : `🔔 ${shortDate(task.remind.date)} ${task.remind.time}`);

/** „dziś”, „jutro”, „za 5 dni”, „5 dni po terminie”. */
function whenLabel(when: string | undefined, today: string, overdue: boolean): string {
  if (when === undefined) return 'bez terminu';
  const days = dayDiff(today, when);
  if (days < 0) return overdue ? `${-days} ${plural(-days)} po terminie` : `${-days} ${plural(-days)} temu`;
  if (days === 0) return 'dziś';
  if (days === 1) return 'jutro';
  return `za ${days} dni`;
}

/** Otwarte zadania wszystkich zaplanowanych wyjazdów, prosto z wierszy w bazie telefonu. */
function loadTasks(today: string, userId: string | null): Task[] {
  // Z dniem zapasu na strefy: wyjazd zakończony wczoraj liczy się jeszcze dziś (jak na webie).
  const yesterday = addDays(today, -1);
  const planned = (cachedTrips() ?? []).filter((trip) => !isDraft(trip) && !isPostponed(trip) && typeof trip.end_date === 'string' && trip.end_date >= yesterday);
  if (planned.length === 0) return [];
  const marks = planned.map(() => '?').join(', ');
  const rows = localDb.all<{ tbl: string; trip_id: string; data: string }>(
    `select tbl, trip_id, data from rows where trip_id in (${marks}) and tbl in ('tasks', 'days', 'items', 'bookings', 'travelers') and deleted_at is null`,
    planned.map((trip) => trip.id!),
  );
  const parsed = rows.map((row) => ({ tbl: row.tbl, tripId: row.trip_id, data: JSON.parse(row.data) as Row }));
  const of = (tbl: string, tripId: string) => parsed.filter((row) => row.tbl === tbl && row.tripId === tripId).map((row) => row.data);

  return planned.flatMap((trip) => {
    const tripId = trip.id!;
    const canEdit = ['owner', 'editor'].includes(trip.role ?? '');
    // Uczestnicy „moi”: z moim kontem albo dzieci pod moją opieką — jak `is_my_traveler` w bazie.
    const travelers = of('travelers', tripId);
    const byId = new Map(travelers.map((row) => [String(row.id), row]));
    const mine = new Set(
      travelers
        .filter((row) => userId !== null && (row.user_id === userId || (typeof row.guardian_id === 'string' && byId.get(row.guardian_id)?.user_id === userId)))
        .map((row) => String(row.id)),
    );
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
      const remind = (row.remind_at ?? undefined) as { date: string; time: string } | undefined;
      // Własne przypomnienie liczy się jak termin: zadanie bez terminu też ma trafić na listę.
      const assignees = Array.isArray(row.assignee_ids) ? (row.assignee_ids as unknown[]).map(String) : [];
      return [
        {
          id: String(row.id),
          tripId,
          tripTitle: String(trip.title),
          title: String(row.title ?? 'Zadanie'),
          body: typeof row.body === 'string' ? row.body : '',
          priority: typeof row.priority === 'string' ? row.priority : 'normal',
          limit,
          due: taskDueDate(context, task),
          deadline: task.deadline,
          remind,
          overdue: limit !== undefined && limit < today,
          done: false,
          canCheck: userId !== null && (canEdit || assignees.some((id) => mine.has(id))),
          canEdit,
        },
      ];
    });
  });
}

export function TaskAlerts() {
  const theme = useTheme();
  const session = useSession();
  const userId = session?.user.id ?? null;
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [group, setGroup] = useState<Group | null>(null);
  const [sheet, setSheet] = useState<string | null>(null);

  const reload = useCallback(() => {
    try {
      const today = localToday();
      setTasks(loadTasks(today, userId).sort((a, b) => (whenOf(a) ?? '9999').localeCompare(whenOf(b) ?? '9999')));
    } catch {
      setTasks([]);
    }
  }, [userId]);

  useFocusEffect(useCallback(() => reload(), [reload]));

  if (tasks === null || tasks.length === 0) return null;
  const today = localToday();
  const week = addDays(today, WEEK_DAYS);
  // Liczniki pokazują to, co zostało do zrobienia; listy — także zadanie odhaczone przed chwilą.
  const inWeek = (task: Task) => !task.overdue && whenOf(task) !== undefined && whenOf(task)! <= week;
  const inGroup = (task: Task, which: Group) => (which === 'overdue' ? task.overdue : which === 'week' ? inWeek(task) : true);
  const left = tasks.filter((task) => !task.done);
  const overdue = left.filter((task) => task.overdue);
  const soon = left.filter(inWeek);
  const shown = group === null ? [] : tasks.filter((task) => inGroup(task, group)).slice(0, SHOWN);
  const open = (tripId: string) => {
    setCurrentTrip(tripId);
    router.navigate('/plan?tab=tasks');
  };
  /** Odhaczenie i cofnięcie; wiersz zostaje na liście aż do następnego wejścia na Start. */
  const check = (task: Task) => {
    if (!task.canCheck) {
      RnAlert.alert('Nie możesz odhaczyć', 'To zadanie odhacza organizator, edytor albo osoba, do której jest przypisane.');
      return;
    }
    const done = !task.done;
    try {
      setTaskStatus(localDb, task.tripId, task.id, done ? 'done' : 'open');
      void syncPending();
      setTasks(tasks.map((each) => (each.id === task.id ? { ...each, done } : each)));
    } catch (e) {
      RnAlert.alert('Nie zapisano', e instanceof Error ? e.message : String(e));
    }
  };
  const current = tasks.find((task) => task.id === sheet) ?? null;

  return (
    <ThemedView type="backgroundElement" style={[styles.card, { borderColor: theme.backgroundSelected }]}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.heading}>
        ZADANIA
      </ThemedText>
      <View style={styles.counts}>
        <Count label="po terminie" value={overdue.length} danger active={group === 'overdue'} onPress={() => setGroup(group === 'overdue' ? null : 'overdue')} />
        <Count label="w tym tygodniu" value={soon.length} active={group === 'week'} onPress={() => setGroup(group === 'week' ? null : 'week')} />
        <Count label="wszystkich" value={left.length} active={group === 'all'} onPress={() => setGroup(group === 'all' ? null : 'all')} />
      </View>
      {group !== null && shown.length === 0 && (
        <ThemedText type="small" themeColor="textSecondary">
          Nic w tej grupie.
        </ThemedText>
      )}
      {shown.map((task) => (
        <View key={task.id} style={[styles.row, task.overdue && !task.done ? styles.overdueRow : undefined]}>
          <Pressable onPress={() => check(task)} hitSlop={8} accessibilityLabel={`${task.done ? 'Cofnij odhaczenie' : 'Zrobione'}: ${task.title}`} style={styles.box}>
            <ThemedText style={[styles.boxMark, task.overdue && !task.done ? styles.overdue : undefined]}>{task.done ? '☑' : '☐'}</ThemedText>
          </Pressable>
          <Pressable onPress={() => setSheet(task.id)} style={styles.grow}>
            <ThemedText type="small" style={task.done ? styles.struck : task.overdue ? styles.overdue : undefined}>
              {task.priority === 'high' ? '! ' : ''}
              {task.title}
            </ThemedText>
            <View style={styles.meta}>
              {task.overdue && !task.done && <ThemedText style={styles.badge}>PO TERMINIE</ThemedText>}
              <ThemedText type="small" themeColor="textSecondary" style={styles.grow}>
                {task.done
                  ? 'zrobione — dotknij ☑, żeby cofnąć'
                  : [whenLabel(whenOf(task), today, task.overdue), remindLabel(task), task.tripTitle].filter(Boolean).join(' · ')}
              </ThemedText>
            </View>
          </Pressable>
        </View>
      ))}
      {group !== null && left.length > 0 && (
        <View style={styles.trips}>
          {/* Każdy wyjazd z otwartymi zadaniami, nie tylko ten z pierwszego wiersza. */}
          {[...new Map(left.map((task) => [task.tripId, task])).values()].map((task) => (
            <Pressable key={task.tripId} onPress={() => open(task.tripId)} style={[styles.trip, { borderColor: theme.backgroundSelected }]}>
              <ThemedText type="small" themeColor="accent">
                {task.tripTitle} ({left.filter((each) => each.tripId === task.tripId).length}) →
              </ThemedText>
            </Pressable>
          ))}
        </View>
      )}
      <TaskSheet
        task={current}
        today={today}
        onClose={() => setSheet(null)}
        onDone={() => current !== null && check(current)}
        onSaved={(remind) => setTasks(tasks.map((each) => (each.id === sheet ? { ...each, remind } : each)))}
        onOpenTrip={() => {
          if (current === null) return;
          setSheet(null);
          open(current.tripId);
        }}
      />
    </ThemedView>
  );
}

/** Jedna z trzech liczb zwiniętej karty; dotknięcie rozwija (albo zwija) listę tej grupy. */
function Count({ label, value, danger = false, active, onPress }: { label: string; value: number; danger?: boolean; active: boolean; onPress: () => void }) {
  const theme = useTheme();
  // Wygląd jak odliczanie dni do najbliższego wyjazdu: miękkie tło, duża liczba, podpis pod spodem.
  return (
    <Pressable onPress={onPress} style={[styles.count, { backgroundColor: theme.accentSoft, borderColor: active ? theme.primary : 'transparent' }]}>
      <ThemedText style={[styles.countValue, { color: danger && value > 0 ? OVERDUE : theme.primary }]}>{value}</ThemedText>
      <ThemedText type="small" themeColor="accent" style={styles.countLabel}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

/**
 * Okno zadania: treść, terminy, duże pole „Zrobione” i zmiana przypomnienia (podpowiedzi albo wpisana
 * data i godzina). Przypomnienie zmienia organizator i edytor — widz zobaczy tylko termin.
 */
function TaskSheet({
  task,
  today,
  onClose,
  onDone,
  onSaved,
  onOpenTrip,
}: {
  task: Task | null;
  today: string;
  onClose: () => void;
  onDone: () => void;
  onSaved: (remind: { date: string; time: string } | undefined) => void;
  onOpenTrip: () => void;
}) {
  const theme = useTheme();
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [message, setMessage] = useState('');
  // Każde otwarcie zaczyna od przypomnienia zapisanego w zadaniu.
  const [shown, setShown] = useState<string | null>(null);
  if (task !== null && shown !== task.id) {
    setShown(task.id);
    setDate(task.remind?.date ?? '');
    setTime(task.remind?.time ?? DEFAULT_TIME);
    setMessage('');
  }

  const save = (next: { date: string; time: string } | null) => {
    if (task === null) return;
    if (next !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(next.date) || !/^\d{2}:\d{2}$/.test(next.time))) {
      setMessage('Data w formacie RRRR-MM-DD, godzina GG:MM.');
      return;
    }
    try {
      updateTask(localDb, task.tripId, task.id, { remind_at: next });
      const doc = cachedTrip(localDb, task.tripId)?.state.doc;
      if (doc !== undefined) void scheduleTripReminders(task.tripId, doc).catch(() => undefined);
      void syncPending();
      setMessage(next === null ? 'Przypomnienie usunięte.' : `Przypomnienie: ${next.date} ${next.time}.`);
      if (next !== null) {
        setDate(next.date);
        setTime(next.time);
      }
      onSaved(next ?? undefined);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Modal visible={task !== null} animationType="slide" onRequestClose={onClose}>
      <SafeAreaProvider>
        <ThemedView style={styles.fill}>
          <SafeAreaView style={styles.fill} edges={['top', 'bottom']}>
            {task !== null && (
              <View style={styles.fill}>
                <View style={styles.top}>
                  <Button label="← Wróć" onPress={onClose} small />
                </View>
                <ScrollView contentContainerStyle={styles.sheet}>
                  <ThemedText type="subtitle">{task.title}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {task.tripTitle}
                  </ThemedText>
                  {task.body !== '' && <ThemedText type="small">{task.body}</ThemedText>}

                  <Pressable onPress={onDone} style={[styles.done, { borderColor: theme.accent }]}>
                    <ThemedText style={styles.doneMark}>{task.done ? '☑' : '☐'}</ThemedText>
                    <ThemedText type="smallBold">{task.done ? 'Zrobione — dotknij, żeby cofnąć' : 'Zrobione'}</ThemedText>
                  </Pressable>
                  {!task.canCheck && (
                    <ThemedText type="small" themeColor="textSecondary">
                      To zadanie odhacza organizator, edytor albo osoba, do której jest przypisane.
                    </ThemedText>
                  )}

                  <ThemedView type="backgroundElement" style={styles.block}>
                    <ThemedText type="smallBold">Terminy</ThemedText>
                    <ThemedText type="small">
                      {task.due === undefined ? 'Bez terminu' : `Termin: ${task.due}`}
                      {task.deadline === undefined ? '' : ` · najpóźniej ${task.deadline}`}
                    </ThemedText>
                    <View style={styles.meta}>
                      {task.overdue && !task.done && <ThemedText style={styles.badge}>PO TERMINIE</ThemedText>}
                      <ThemedText type="small" style={task.overdue ? styles.overdue : undefined}>
                        {whenLabel(whenOf(task), today, task.overdue)}
                      </ThemedText>
                    </View>
                  </ThemedView>

                  <ThemedView type="backgroundElement" style={styles.block}>
                    <ThemedText type="smallBold">Przypomnienie</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {task.remind === undefined ? 'Bez własnego przypomnienia — powiadomienie idzie z terminu.' : `🔔 ${task.remind.date} ${task.remind.time}`}
                    </ThemedText>
                    {task.canEdit ? (
                      <>
                        <View style={styles.quick}>
                          <Button small label="jutro" onPress={() => save({ date: addDays(today, 1), time: time || DEFAULT_TIME })} />
                          <Button small label="za 3 dni" onPress={() => save({ date: addDays(today, 3), time: time || DEFAULT_TIME })} />
                          <Button small label="za tydzień" onPress={() => save({ date: addDays(today, 7), time: time || DEFAULT_TIME })} />
                        </View>
                        <View style={styles.quick}>
                          <TextInput
                            value={date}
                            onChangeText={setDate}
                            keyboardType="numbers-and-punctuation"
                            maxLength={10}
                            placeholder="RRRR-MM-DD"
                            placeholderTextColor={theme.textSecondary}
                            style={[styles.input, styles.grow, { color: theme.text, borderColor: theme.backgroundSelected }]}
                          />
                          <TextInput
                            value={time}
                            onChangeText={setTime}
                            keyboardType="numbers-and-punctuation"
                            maxLength={5}
                            placeholder="GG:MM"
                            placeholderTextColor={theme.textSecondary}
                            style={[styles.input, styles.time, { color: theme.text, borderColor: theme.backgroundSelected }]}
                          />
                        </View>
                        <View style={styles.quick}>
                          <Button small label="Zapisz przypomnienie" onPress={() => save({ date, time })} />
                          {task.remind !== undefined && <Button small danger label="Bez przypomnienia" onPress={() => save(null)} />}
                        </View>
                      </>
                    ) : (
                      <ThemedText type="small" themeColor="textSecondary">
                        Przypomnienie ustawia organizator albo edytor.
                      </ThemedText>
                    )}
                    {message !== '' && <ThemedText type="small">{message}</ThemedText>}
                  </ThemedView>

                  <Button small label="Zadania wyjazdu →" onPress={onOpenTrip} />
                </ScrollView>
              </View>
            )}
          </SafeAreaView>
        </ThemedView>
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  card: { padding: Spacing.three, borderRadius: 16, gap: Spacing.two, borderWidth: 1 },
  heading: { textAlign: 'center' },
  counts: { flexDirection: 'row', gap: Spacing.two },
  count: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.two, paddingHorizontal: Spacing.one, borderRadius: 16, borderWidth: 2 },
  countValue: { fontSize: 32, lineHeight: 36, fontWeight: '800' },
  countLabel: { textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 44 },
  box: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  boxMark: { fontSize: 26, lineHeight: 30 },
  grow: { flex: 1 },
  overdue: { color: OVERDUE, fontWeight: '600' },
  // Zaległe zadanie odcina się od reszty listy, tak samo jak w zakładce „Zadania”.
  overdueRow: { backgroundColor: '#dc26261f', borderLeftWidth: 3, borderLeftColor: OVERDUE, borderRadius: 8, paddingRight: Spacing.one },
  meta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.one },
  trips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  trip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: Spacing.two, paddingVertical: 4 },
  badge: { color: '#FFFFFF', backgroundColor: OVERDUE, fontSize: 11, lineHeight: 16, fontWeight: '700', borderRadius: 6, paddingHorizontal: 6, overflow: 'hidden' },
  struck: { textDecorationLine: 'line-through', opacity: 0.6 },
  fill: { flex: 1 },
  top: { padding: Spacing.three },
  sheet: { padding: Spacing.four, gap: Spacing.three },
  block: { padding: Spacing.three, borderRadius: 12, gap: Spacing.one },
  done: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, padding: Spacing.three, borderRadius: 12, borderWidth: 2 },
  doneMark: { fontSize: 32, lineHeight: 36 },
  quick: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: Spacing.two, paddingVertical: Spacing.one, fontSize: 15 },
  time: { width: 90 },
});
