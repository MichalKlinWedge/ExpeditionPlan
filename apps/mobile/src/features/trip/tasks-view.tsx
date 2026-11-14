import { localToday, taskOverdue } from '@expeditionplan/core';
import { type CachedTrip, setTaskDone } from '@expeditionplan/sync';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { localDb } from '@/lib/local-db';

/**
 * Zadania z planu na telefonie (zakładka „Zadania”) — offline, odhaczane przez outbox: organizator
 * i edytor — każde, widz — przypisane do siebie albo swojego dziecka (RLS `tasks_update`; zapis
 * odrzucony przez serwer wraca do „do zrobienia”). Na webie: strona logistyki.
 */

type Task = CachedTrip['state']['doc']['tasks'][number];
type TravelerRow = { id: string; ref: string | null; name: string; user_id: string | null; guardian_id: string | null };

type Props = {
  trip: CachedTrip;
  tripId: string;
  signedIn: boolean;
  /** Zalogowany użytkownik — które zadania są „moje”. */
  userId: string | null;
  /** Organizator i edytor odhaczają każde zadanie. */
  canAct: boolean;
  /** Po zapisie z telefonu — odświeżenie stanu i przypomnień. */
  onChanged: () => void;
};

const KIND: Record<Task['kind'], string> = { todo: '', question: 'pytanie', decision: 'decyzja' };
/** Czerwień zaległego zadania — ta sama co na karcie zadań na Starcie i na liście na webie. */
const OVERDUE = '#dc2626';

function dueLabel(task: Task, doc: CachedTrip['state']['doc']): string {
  // Własne przypomnienie (`remindAt`) obok terminu.
  const remind = task.remindAt === undefined ? '' : `🔔 ${task.remindAt.date.slice(8)}.${task.remindAt.date.slice(5, 7)} ${task.remindAt.time}`;
  const deadline = task.deadline === undefined ? '' : `najpóźniej ${task.deadline.slice(8)}.${task.deadline.slice(5, 7)}`;
  return [dueText(task, doc), deadline, remind].filter(Boolean).join(' · ');
}

function dueText(task: Task, doc: CachedTrip['state']['doc']): string {
  const due = task.due;
  if (due === undefined) return '';
  if (due.kind === 'absolute') return `do ${due.date}`;
  if (due.kind === 'before_trip') return due.days === 0 ? 'w dniu wyjazdu' : `${due.days} dni przed wyjazdem`;
  if (due.kind === 'on_trip') {
    const day = due.dayRef === undefined ? undefined : doc.days.find((each) => each.ref === due.dayRef);
    return ['w trakcie', day ? `${day.date.slice(8)}.${day.date.slice(5, 7)}` : '', due.time ?? ''].filter(Boolean).join(' ');
  }
  return 'przed terminem w planie';
}

export function TasksView({ trip, tripId, signedIn, userId, canAct, onChanged }: Props) {
  const doc = trip.state.doc;
  const [doneOpen, setDoneOpen] = useState(false);
  /**
   * Zadanie odhaczone przed chwilą zostaje w swojej sekcji (przypadkowe dotknięcie widać i da się
   * cofnąć); do „Zrobione” przechodzi dopiero po odświeżeniu — przeciągnięciu listy w dół albo
   * powrocie na zakładkę.
   */
  const [held, setHeld] = useState<Record<string, 'open' | 'done'>>({});
  const section = (task: Task) => held[task.ref] ?? task.status;
  const open = doc.tasks.filter((task) => section(task) === 'open');
  const finished = doc.tasks.filter((task) => section(task) === 'done');
  // Uczestnicy „moi”: z moim kontem albo dzieci pod moją opieką — jak `is_my_traveler` w bazie.
  const travelers = trip.live.travelers as unknown as TravelerRow[];
  const byId = new Map(travelers.map((row) => [row.id, row]));
  const names = new Map(travelers.filter((row) => row.ref !== null).map((row) => [row.ref!, row.name]));
  const myRefs = new Set(
    travelers
      .filter((row) => userId !== null && (row.user_id === userId || (row.guardian_id !== null && byId.get(row.guardian_id)?.user_id === userId)))
      .map((row) => row.ref)
      .filter((ref): ref is string => ref !== null),
  );
  const canCheck = (task: Task) => signedIn && (canAct || (task.assigneeRefs ?? []).some((ref) => myRefs.has(ref)));
  const toggle = (task: Task) => {
    if (!canCheck(task)) return;
    try {
      setTaskDone(localDb, tripId, trip, task.ref, task.status !== 'done');
      setHeld({ ...held, [task.ref]: section(task) });
      onChanged();
    } catch (e) {
      Alert.alert('Nie zapisano', e instanceof Error ? e.message : String(e));
    }
  };
  const today = localToday();
  const row = (task: Task) => (
    <TaskRow
      key={task.ref}
      task={task}
      due={dueLabel(task, doc)}
      overdue={taskOverdue(doc, task, today)}
      who={(task.assigneeRefs ?? []).map((ref) => names.get(ref) ?? ref).join(', ')}
      note={section(task) === task.status ? '' : task.status === 'done' ? 'zrobione — dotknij ☑, żeby cofnąć' : 'do zrobienia — dotknij ☐, żeby odhaczyć'}
      canCheck={canCheck(task)}
      onToggle={() => toggle(task)}
    />
  );

  if (open.length === 0 && finished.length === 0) {
    return (
      <ThemedText themeColor="textSecondary" style={styles.pad}>
        Plan nie ma zadań. Dodaje się je na webie, na stronie logistyki.
      </ThemedText>
    );
  }

  return (
    <View style={styles.list}>
      {!canAct && signedIn && (
        <ThemedText type="small" themeColor="textSecondary">
          Odhaczasz zadania przypisane do siebie — resztę widzisz bez zmiany.
        </ThemedText>
      )}
      <ThemedView type="backgroundElement" style={styles.card}>
        <ThemedText type="smallBold">Do zrobienia ({open.length})</ThemedText>
        {open.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            Wszystko zrobione.
          </ThemedText>
        ) : (
          open.map(row)
        )}
      </ThemedView>
      {finished.length > 0 && (
        <ThemedView type="backgroundElement" style={styles.card}>
          <Pressable onPress={() => setDoneOpen(!doneOpen)} hitSlop={8}>
            <ThemedText type="smallBold">
              {doneOpen ? '▾' : '▸'} Zrobione ({finished.length})
            </ThemedText>
          </Pressable>
          {doneOpen && finished.map(row)}
        </ThemedView>
      )}
    </View>
  );
}

/** Zadanie z polem do odhaczenia; bez prawa do zmiany — sam tekst (widz, cudze zadanie, bez logowania). */
function TaskRow({
  task,
  due,
  overdue: late,
  who,
  note,
  canCheck,
  onToggle,
}: {
  task: Task;
  due: string;
  overdue: boolean;
  who: string;
  /** Zmiana zrobiona przed chwilą, wiersz czeka w swojej sekcji na odświeżenie. */
  note: string;
  canCheck: boolean;
  onToggle: () => void;
}) {
  const done = task.status === 'done';
  const overdue = late && !done;
  const meta = note !== '' ? note : [KIND[task.kind], due, who].filter(Boolean).join(' · ');
  const body = (
    <View style={styles.grow}>
      <ThemedText type="small" style={done ? styles.done : overdue ? styles.overdue : undefined}>
        {task.priority === 'high' ? '! ' : ''}
        {task.title}
      </ThemedText>
      <View style={styles.meta}>
        {overdue && <ThemedText style={styles.badge}>PO TERMINIE</ThemedText>}
        {meta !== '' && (
          <ThemedText type="small" themeColor="textSecondary" style={styles.grow}>
            {meta}
          </ThemedText>
        )}
      </View>
    </View>
  );
  // Zaległe zadanie odcina się od reszty listy: czerwony pasek z lewej i tło, nie sam kolor tekstu.
  const line = [styles.task, overdue ? styles.overdueRow : undefined];
  if (!canCheck) {
    return (
      <View style={line}>
        <View style={styles.box}>
          <ThemedText themeColor="textSecondary" style={styles.boxMark}>
            {done ? '✓' : '·'}
          </ThemedText>
        </View>
        {body}
      </View>
    );
  }
  // Duże pole do odhaczenia (44 px) — ten sam rozmiar co na karcie zadań na Starcie.
  return (
    <Pressable onPress={onToggle} hitSlop={6} style={line} accessibilityLabel={`${done ? 'Cofnij odhaczenie' : 'Zrobione'}: ${task.title}`}>
      <View style={styles.box}>
        <ThemedText style={[styles.boxMark, overdue ? styles.overdue : undefined]}>{done ? '☑' : '☐'}</ThemedText>
      </View>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pad: { paddingHorizontal: Spacing.three },
  list: { gap: Spacing.two, paddingHorizontal: Spacing.three },
  card: { borderRadius: 12, padding: Spacing.three, gap: Spacing.two },
  task: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 44 },
  box: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  boxMark: { fontSize: 26, lineHeight: 30 },
  grow: { flex: 1 },
  done: { textDecorationLine: 'line-through', opacity: 0.6 },
  meta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.one },
  // Otwarte zadanie po terminie albo po „najpóźniej” (`taskOverdue`).
  overdue: { color: OVERDUE, fontWeight: '600' },
  overdueRow: { backgroundColor: '#dc26261f', borderLeftWidth: 3, borderLeftColor: OVERDUE, borderRadius: 8, paddingLeft: Spacing.two, paddingRight: Spacing.one, paddingVertical: 4 },
  badge: { color: '#FFFFFF', backgroundColor: OVERDUE, fontSize: 11, lineHeight: 16, fontWeight: '700', borderRadius: 6, paddingHorizontal: 6, overflow: 'hidden' },
});
