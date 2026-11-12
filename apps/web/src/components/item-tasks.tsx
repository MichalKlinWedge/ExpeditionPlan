"use client";

import Link from "next/link";
import { useState } from "react";

import { ListIcon } from "@/components/icons";
import { type Choices, TaskForm } from "@/components/logistics-editors";
import { itemTasksHref } from "@/lib/task-link";

/**
 * Zadania punktu na jego karcie: link do „Zadań” z zaznaczonymi zadaniami tego punktu i, w trybie edycji,
 * „+ Dodaj zadanie powiązane” — formularz zadania z tym punktem już wybranym w „Dotyczy punktu”.
 */
export function ItemTasks({ tripId, itemRef, itemLabel, tasks, choices, editing }: { tripId: string; itemRef: string; itemLabel: string; tasks: { title: string; done: boolean }[]; choices: Choices; editing: boolean }) {
  const [adding, setAdding] = useState(false);
  // Punkt z puli nie ma go na liście punktów dni: dopisany, żeby formularz go zapisał.
  const withItem = choices.items.some((each) => each.ref === itemRef) ? choices : { ...choices, items: [{ ref: itemRef, label: itemLabel }, ...choices.items] };
  const open = tasks.filter((task) => !task.done).length;
  return (
    <div className="flex flex-col gap-2">
      {(tasks.length > 0 || (editing && !adding)) && (
        <div className="flex flex-wrap items-center gap-1">
          {tasks.length > 0 && (
            <Link href={itemTasksHref(tripId, itemRef)} title={`Zadania: ${tasks.map((task) => `${task.title}${task.done ? " ✓" : ""}`).join(", ")}`} className="btn-mini">
              <ListIcon className="size-3.5" />
              Zadania punktu: {tasks.length}
              {open < tasks.length ? ` (otwarte: ${open})` : ""}
            </Link>
          )}
          {editing && !adding && (
            <button type="button" onClick={() => setAdding(true)} className="btn-secondary btn-sm">
              + Dodaj zadanie powiązane
            </button>
          )}
        </div>
      )}
      {editing && adding && (
        <div className="panel p-3">
          <TaskForm tripId={tripId} choices={withItem} itemRef={itemRef} onDone={() => setAdding(false)} />
        </div>
      )}
    </div>
  );
}
