"use client";

import { NOTE_TOPIC } from "@expeditionplan/core";
import type { PracticalInfo } from "@expeditionplan/core";
import type { PracticalPick, SourceCheck } from "@expeditionplan/planner";
import { type ReactNode, useState, useTransition } from "react";

import type { FormState } from "@/app/actions";
import { applyPractical } from "@/app/practical-actions";

/**
 * Szkic etapu 5 do akceptacji: wszystko zaznaczone na start, człowiek odznacza, co zbędne,
 * i dodaje resztę do planu jednym przyciskiem. Martwe źródła są już odrzucone (lista na dole).
 */

type Key = keyof PracticalPick;

export function PracticalReview({ tripId, runId, info, checks }: { tripId: string; runId: string; info: PracticalInfo; checks: SourceCheck[] }) {
  const all = (list: unknown[]) => list.map((_, i) => i);
  const [pick, setPick] = useState<Record<Key, number[]>>({
    notes: all(info.notes),
    contacts: all(info.contacts),
    packing: all(info.packing),
    tasks: all(info.tasks),
    sources: all(info.sources),
  });
  const [result, setResult] = useState<FormState>({});
  const [pending, start] = useTransition();
  const toggle = (key: Key, i: number) =>
    setPick((current) => ({ ...current, [key]: current[key].includes(i) ? current[key].filter((each) => each !== i) : [...current[key], i] }));
  const box = (key: Key, i: number) => <input type="checkbox" checked={pick[key].includes(i)} onChange={() => toggle(key, i)} className="mt-1" />;
  const total = Object.values(pick).reduce((sum, list) => sum + list.length, 0);
  const section = (title: string, count: number, body: ReactNode) =>
    count === 0 ? null : (
      <div className="flex flex-col gap-2">
        <h3 className="font-medium">
          {title} ({count})
        </h3>
        {body}
      </div>
    );
  const dead = checks.filter((check) => !check.ok);

  return (
    <div className="flex flex-col gap-4 panel-ai p-4 text-sm">
      <p className="text-xs text-zinc-500">Szkic AI — nic nie jest jeszcze w planie. Odznacz, czego nie chcesz, i dodaj resztę.</p>
      {section(
        "Notatki",
        info.notes.length,
        <ul className="flex flex-col gap-2">
          {info.notes.map((note, i) => (
            <li key={i} className="flex gap-2">
              {box("notes", i)}
              <span>
                <span className="font-medium">{note.title}</span> <span className="text-xs text-zinc-500">· {NOTE_TOPIC[note.topic]}</span>
                <span className="block whitespace-pre-line text-zinc-600 dark:text-zinc-400">{note.body}</span>
              </span>
            </li>
          ))}
        </ul>,
      )}
      {section(
        "Kontakty",
        info.contacts.length,
        <ul className="flex flex-col gap-1">
          {info.contacts.map((contact, i) => (
            <li key={i} className="flex gap-2">
              {box("contacts", i)}
              <span>
                {contact.name}
                {contact.phone ? <span className="font-mono"> · {contact.phone}</span> : null}
                {contact.notes ? <span className="text-xs text-zinc-500"> · {contact.notes}</span> : null}
              </span>
            </li>
          ))}
        </ul>,
      )}
      {section(
        "Sprzęt",
        info.packing.length,
        <ul className="grid gap-1 sm:grid-cols-2">
          {info.packing.map((item, i) => (
            <li key={i} className="flex gap-2">
              {box("packing", i)}
              <span>
                {item.title}
                <span className="text-xs text-zinc-500">
                  {" "}
                  · {item.category} · {item.scope === "shared" ? "wspólne" : "każdy"}
                  {item.note ? ` · ${item.note}` : ""}
                </span>
              </span>
            </li>
          ))}
        </ul>,
      )}
      {section(
        "Zadania przed wyjazdem",
        info.tasks.length,
        <ul className="flex flex-col gap-1">
          {info.tasks.map((task, i) => (
            <li key={i} className="flex gap-2">
              {box("tasks", i)}
              <span>
                {task.priority === "high" ? <span className="msg-error">! </span> : null}
                {task.title}
                {task.daysBefore !== undefined ? (
                  <span className="text-xs text-zinc-500"> · {task.daysBefore === 0 ? "w dniu wyjazdu" : `${task.daysBefore} dni przed wyjazdem`}</span>
                ) : null}
                {task.body ? <span className="block text-xs text-zinc-500">{task.body}</span> : null}
              </span>
            </li>
          ))}
        </ul>,
      )}
      {section(
        "Źródła (adres sprawdzony — odpowiada)",
        info.sources.length,
        <ul className="flex flex-col gap-1">
          {info.sources.map((source, i) => (
            <li key={i} className="flex gap-2">
              {box("sources", i)}
              <a href={source.url} target="_blank" rel="noreferrer" className="underline">
                {source.title}
              </a>
            </li>
          ))}
        </ul>,
      )}
      {dead.length > 0 && <p className="text-xs text-zinc-500">Odrzucone źródła (adres nie odpowiada): {dead.map((check) => check.url).join(", ")}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button
          disabled={pending || total === 0}
          onClick={() => start(async () => setResult(await applyPractical(tripId, runId, pick)))}
          className="btn-primary">
          {pending ? "Dodaję…" : `Dodaj zaznaczone do planu (${total})`}
        </button>
        {result.error && <span className="msg-error">{result.error}</span>}
        {result.ok && <span className="msg-ok">{result.ok}</span>}
      </div>
    </div>
  );
}
