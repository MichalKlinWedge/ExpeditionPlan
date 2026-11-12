import type { TripDocument } from "@expeditionplan/core";

/**
 * Zadania przy punktach planu: zadanie „dotyczy punktu” (`itemRef`) albo ma termin „N dni przed punktem”.
 * Plan pokazuje przy takim punkcie ikonę, która prowadzi na „Zadania” z kotwicą punktu; lista zadań zaznacza wtedy
 * wszystkie jego zadania (także zamknięte, rozwijając je).
 */

type Task = TripDocument["tasks"][number];

/** Punkty, których dotyczy zadanie. */
export function taskItemRefs(task: Task): string[] {
  const refs = [task.itemRef, task.due?.kind === "before_item" ? task.due.itemRef : undefined].filter((ref): ref is string => ref !== undefined);
  return [...new Set(refs)];
}

/** Zadania każdego punktu, bez porzuconych. */
export function tasksByItem(tasks: readonly Task[]): Map<string, Task[]> {
  const byItem = new Map<string, Task[]>();
  for (const task of tasks) {
    if (task.status === "dropped") continue;
    for (const ref of taskItemRefs(task)) byItem.set(ref, [...(byItem.get(ref) ?? []), task]);
  }
  return byItem;
}

const PREFIX = "zadania-punktu-";

export const itemTasksAnchor = (itemRef: string) => `${PREFIX}${itemRef}`;

export const itemTasksHref = (tripId: string, itemRef: string) => `/trips/${tripId}/tasks#${encodeURIComponent(itemTasksAnchor(itemRef))}`;

/** Punkt z kotwicy adresu (`#zadania-punktu-…`), inaczej `null`. */
export function itemFromTasksHash(hash: string): string | null {
  const id = decodeURIComponent(hash.replace(/^#/, ""));
  return id.startsWith(PREFIX) && id.length > PREFIX.length ? id.slice(PREFIX.length) : null;
}
