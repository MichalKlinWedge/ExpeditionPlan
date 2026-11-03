"use client";

import { useState, useTransition } from "react";

import type { FormState } from "@/app/actions";
import { removeMember, setMemberAccess } from "@/app/share-actions";

/**
 * Zmiana dostępu członka (organizator, w trybie edycji): widz ↔ edytor, „dodaje wydatki” przy widzu
 * (edytor dodaje zawsze) i „odbierz dostęp”. Zapis od razu po zmianie.
 */
export function MemberAccess({ tripId, userId, name, role, canAddExpenses }: { tripId: string; userId: string; name: string; role: "editor" | "viewer"; canAddExpenses: boolean }) {
  const [state, setState] = useState<FormState>({});
  const [pending, start] = useTransition();
  const run = (action: () => Promise<FormState>) => start(async () => setState(await action()));
  return (
    <span className="flex flex-col items-start gap-1">
      <select
        value={role}
        disabled={pending}
        onChange={(event) => run(() => setMemberAccess(tripId, userId, event.target.value as "editor" | "viewer", canAddExpenses))}
        aria-label={`Dostęp: ${name}`}
        className="field px-1.5 py-0.5 text-sm">
        <option value="viewer">widz — podgląd</option>
        <option value="editor">edytor — zmienia plan</option>
      </select>
      {role === "viewer" && (
        <label className="flex items-center gap-1 text-xs text-zinc-600 dark:text-zinc-400">
          <input type="checkbox" checked={canAddExpenses} disabled={pending} onChange={(event) => run(() => setMemberAccess(tripId, userId, "viewer", event.target.checked))} />
          dodaje wydatki
        </label>
      )}
      <button
        type="button"
        disabled={pending}
        onClick={() => window.confirm(`Odebrać dostęp do wyjazdu: ${name}?`) && run(() => removeMember(tripId, userId))}
        className="text-xs text-red-700 underline disabled:opacity-50 dark:text-red-400">
        odbierz dostęp
      </button>
      {pending && <span className="text-xs text-zinc-500">zapisuję…</span>}
      {state.error && <span className="text-xs text-red-600">{state.error}</span>}
    </span>
  );
}
