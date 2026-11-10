"use client";

import { documentProblem, isTransit, type PlanEdit, type TripDocument, updateItem } from "@expeditionplan/core";
import { savePlanEdit } from "@expeditionplan/sync";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { ItemEditor } from "@/components/item-editor";
import { ItemLegEditor } from "@/components/item-leg";
import { ItemPlaceEditor } from "@/components/item-place";
import { createClient } from "@/lib/supabase/client";

/**
 * Edycja nagłówka punktu na jego karcie (nazwa, rodzaj, godzina, czas trwania, bufor, priorytet) —
 * ten sam formularz i ta sama droga zapisu co w planie (`updateItem` → `savePlanEdit`, `user_locked`).
 * Widoczna w trybie edycji (wspólny, `lib/edit-mode.ts`) dla organizatora i edytora.
 */
export function ItemHeaderEditor({ tripId, doc, ids, itemRef }: { tripId: string; doc: TripDocument; ids: Record<string, string>; itemRef: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const item = doc.items.find((each) => each.ref === itemRef);
  if (item === undefined) return null;

  const save = (edit: PlanEdit | null, done?: () => void) => {
    if (edit === null) return done?.();
    const invalid = documentProblem(edit.doc);
    if (invalid !== null) return setError(`Nie zapisano: ${invalid}`);
    start(async () => {
      try {
        await savePlanEdit(createClient(), tripId, edit, ids);
        setError(null);
        done?.();
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-secondary btn-sm self-start">
        Edytuj nagłówek punktu
      </button>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <ItemEditor
        item={item}
        transitNow={isTransit(doc, item)}
        onCancel={() => setOpen(false)}
        onSave={(patch) => save(updateItem(doc, itemRef, patch), () => setOpen(false))}
      />
      {item.kind === "transport" ? (
        <ItemLegEditor tripId={tripId} doc={doc} item={item} onEdit={save} disabled={pending} />
      ) : (
        <ItemPlaceEditor key={item.placeRef ?? "brak"} tripId={tripId} doc={doc} item={item} onEdit={(edit) => save(edit)} disabled={pending} />
      )}
      {pending && <p className="text-xs text-zinc-500">Zapisuję…</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
