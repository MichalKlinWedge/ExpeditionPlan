"use client";

import { DRAFT_PREFIX } from "@expeditionplan/core";
import { useState, useTransition } from "react";

import { renameTrip } from "@/app/actions";
import { IconAction } from "@/components/icon-action";

/**
 * Nazwa wyjazdu z ołówkiem do zmiany (organizator, edytor). Przy szkicu AI zmienia się tylko część
 * po „Szkic AI: ”, a przy planie także nazwy jego szkiców (`renameTrip`).
 */
export function TripTitle({ tripId, title, canEdit, hasDrafts = false }: { tripId: string; title: string; canEdit: boolean; hasDrafts?: boolean }) {
  const draft = title.startsWith(DRAFT_PREFIX);
  const name = draft ? title.slice(DRAFT_PREFIX.length) : title;
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [message, setMessage] = useState<{ error?: string; ok?: string } | null>(null);
  const [pending, start] = useTransition();

  const save = () =>
    start(async () => {
      const result = await renameTrip(tripId, value);
      setMessage(result);
      if (result.ok) setEditing(false);
    });

  if (!editing) {
    return (
      <span className="flex flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2">
          <h1 className="text-3xl font-bold">{title}</h1>
          {canEdit && (
            <IconAction
              kind="edit"
              tip="zmień nazwę"
              onClick={() => {
                setValue(name);
                setMessage(null);
                setEditing(true);
              }}
            />
          )}
        </span>
        {message?.ok && <span className="text-sm text-green-700 dark:text-green-400">{message.ok}</span>}
      </span>
    );
  }
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <span className="flex flex-wrap items-center gap-2">
        {draft && <span className="text-xl font-bold text-zinc-500">{DRAFT_PREFIX}</span>}
        <input autoFocus value={value} onChange={(event) => setValue(event.target.value)} maxLength={120} disabled={pending} aria-label="Nazwa wyjazdu" className="field min-w-64 flex-1 px-3 py-1.5 text-xl font-bold" />
      </span>
      <span className="flex flex-wrap items-center gap-2">
        <button disabled={pending || value.trim() === ""} className="btn-primary btn-sm">
          {pending ? "Zapisuję…" : "Zapisz"}
        </button>
        <button type="button" disabled={pending} onClick={() => setEditing(false)} className="btn-secondary btn-sm">
          Anuluj
        </button>
        {hasDrafts && <span className="text-xs text-zinc-500">Szkice AI tego planu dostaną tę samą nową nazwę.</span>}
      </span>
      {message?.error && <span className="text-sm text-red-600">{message.error}</span>}
    </form>
  );
}
