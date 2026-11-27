import { z } from 'zod';

import { IsoDate, LocalTime, TimeZone } from './schemas/common.ts';
import type { TripDocument } from './schemas/trip-document.ts';
import { taskDueDate } from './task-due.ts';

/**
 * Integracja z Task Plannerem (`docs/INTEGRACJA_TP.md`): zadanie wyjazdu jako ładunek `PUT /tasks/{key}`
 * Edge Function `inbound-api` TP i odpowiedź TP. Zwrot statusu (webhook TP) obsługuje RPC
 * `taskplanner_webhook` w bazie, więc tu jest tylko kierunek EP → TP.
 */

type Doc = TripDocument;
type Task = Doc['tasks'][number];

/** Klucz zewnętrzny zadania w TP: `ep:<id wyjazdu>:<ref zadania>`; TP robi z niego stałe id zadania. */
export const plannerKey = (tripId: string, ref: string): string => `ep:${tripId}:${ref}`;

export const PLANNER_TASK_STATUS = ['todo', 'in_progress', 'waiting', 'done', 'cancelled'] as const;
export type PlannerTaskStatus = (typeof PLANNER_TASK_STATUS)[number];

/** Ciało `PUT /tasks/{key}`: pole nieobecne = EP nim nie zarządza, `null` = wyczyść. */
export const PlannerTaskInput = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(10_000).nullable().optional(),
  status: z.enum(['todo', 'done', 'cancelled']).optional(),
  priority: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
  startDate: IsoDate.nullable().optional(),
  dueDate: IsoDate.nullable().optional(),
  dueTime: LocalTime.nullable().optional(),
  timeZone: TimeZone.nullable().optional(),
  tags: z.array(z.string().min(1).max(60)).max(20).optional(),
  source: z.object({ kind: z.literal('expeditionplan'), tripId: z.uuid(), ref: z.string().min(1), url: z.url() }),
});
export type PlannerTaskInput = z.infer<typeof PlannerTaskInput>;

/** Odpowiedź `PUT` i `GET /tasks/{key}`. */
export const PlannerTaskResult = z.object({
  id: z.uuid(),
  key: z.string(),
  created: z.boolean(),
  status: z.enum(PLANNER_TASK_STATUS),
  deleted: z.boolean(),
  url: z.string(),
  applied: z.array(z.string()),
  kept: z.array(z.string()),
});
export type PlannerTaskResult = z.infer<typeof PlannerTaskResult>;

const STATUS: Record<Task['status'], NonNullable<PlannerTaskInput['status']>> = { open: 'todo', done: 'done', dropped: 'cancelled' };
const PRIORITY: Record<NonNullable<Task['priority']>, 1 | 2 | 3 | 4> = { high: 2, normal: 3, low: 4 };
const KIND_TAG: Partial<Record<Task['kind'], string>> = { question: 'pytanie', decision: 'decyzja' };

/** Etykieta statusu zadania w TP (np. „w TP: w toku”). */
export const PLANNER_STATUS_LABEL: Record<PlannerTaskStatus, string> = {
  todo: 'do zrobienia',
  in_progress: 'w toku',
  waiting: 'oczekuje',
  done: 'zrobione',
  cancelled: 'anulowane',
};

const DRAFT_PREFIX = /^Szkic AI:\s*/;

/** Godzina terminu: z terminu absolutnego albo „w trakcie” z godziną. */
function dueTime(task: Task): string | undefined {
  return task.due?.kind === 'absolute' || task.due?.kind === 'on_trip' ? task.due.time : undefined;
}

/** Opis zadania w TP: treść, odpowiedź, z czym jest związane i link do EP (Markdown). */
function description(doc: Doc, task: Task, taskUrl: string): string {
  const parts: string[] = [];
  if (task.body?.trim()) parts.push(task.body.trim());
  if (task.answer?.trim()) parts.push(`**Odpowiedź:** ${task.answer.trim()}`);
  const context = [
    task.bookingRef === undefined ? undefined : doc.bookings.find((each) => each.ref === task.bookingRef)?.title,
    task.itemRef === undefined ? undefined : doc.items.find((each) => each.ref === task.itemRef)?.title,
    task.variantGroupRef === undefined ? undefined : doc.variantGroups.find((each) => each.ref === task.variantGroupRef)?.title,
  ].filter((each): each is string => each !== undefined && each.trim() !== '');
  if (context.length > 0) parts.push(`Dotyczy: ${context.join(' · ')}`);
  parts.push(`[Otwórz w Expedition Plan](${taskUrl})`);
  return parts.join('\n\n').slice(0, 10_000);
}

/**
 * Zadanie wyjazdu jako ładunek dla TP. Termin względny jest przeliczony na datę (`taskDueDate`); przy „najpóźniej”
 * (`deadline`) to on jest terminem w TP, a wcześniejszy termin — datą rozpoczęcia. Godzina tylko wtedy, gdy terminem
 * w TP jest data, do której ją podano; strefa = dnia wyjazdu z tą datą, inaczej domowa. Daty i godzinę wysyła
 * zawsze (także `null`), bo nimi zarządza EP; priorytet tylko podany.
 */
export function plannerTask(doc: Doc, task: Task, ctx: { tripId: string; tripUrl: string; taskUrl: string }): PlannerTaskInput {
  const due = taskDueDate(doc, task);
  const dueDate = task.deadline ?? due ?? null;
  const startDate = task.deadline !== undefined && due !== undefined && due < task.deadline ? due : null;
  const time = dueDate !== null && dueDate === due ? dueTime(task) : undefined;
  const tripTag = doc.trip.title.replace(DRAFT_PREFIX, '').trim().slice(0, 60);
  const kindTag = KIND_TAG[task.kind];
  return {
    title: task.title.slice(0, 500),
    description: description(doc, task, ctx.taskUrl),
    status: STATUS[task.status],
    ...(task.priority === undefined ? {} : { priority: PRIORITY[task.priority] }),
    startDate,
    dueDate,
    dueTime: time ?? null,
    timeZone: time === undefined ? null : (doc.days.find((day) => day.date === dueDate)?.tz ?? doc.trip.homeTz),
    tags: ['wyjazd', ...(tripTag === '' ? [] : [tripTag]), ...(kindTag === undefined ? [] : [kindTag])],
    source: { kind: 'expeditionplan', tripId: ctx.tripId, ref: task.ref, url: ctx.tripUrl },
  };
}

/**
 * Zadania do wysłania domyślnie: otwarte, bez osoby albo przypisane do mnie (`mine` = refy moich uczestników,
 * także dzieci, którym jestem opiekunem).
 */
export function suggestedForPlanner(doc: Doc, mine: ReadonlySet<string>): string[] {
  return doc.tasks
    .filter((task) => task.status === 'open' && (task.assigneeRefs.length === 0 || task.assigneeRefs.some((ref) => mine.has(ref))))
    .map((task) => task.ref);
}
