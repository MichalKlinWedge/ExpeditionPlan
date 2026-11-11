"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import type { FormState } from "@/app/actions";
import { attachItemRoute, detachItemRoute, saveItemCarRoute } from "@/app/route-actions";

export type RouteOption = { ref: string; name: string; facts: string; variant: boolean };

/**
 * Trasa punktu z „Tras” wyjazdu (`core/route-library.ts`): która jest podpięta (link do „Tras”), podpięcie innej
 * (najpierw warianty tej samej drogi), odpięcie i — przy przejeździe autem — zapis jego przebiegu jako trasy.
 * Poprzednia trasa zostaje w „Trasach”. Zmiany tylko w trybie edycji.
 */
export function RoutePick({
  tripId,
  itemRef,
  current,
  options,
  editing,
  canSave,
}: {
  tripId: string;
  itemRef: string;
  current?: { ref: string; name: string };
  options: RouteOption[];
  editing: boolean;
  /** Przejazd autem z przebiegiem, którego jeszcze nie ma w „Trasach”. */
  canSave: boolean;
}) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<FormState>({});
  const [chosen, setChosen] = useState(options[0]?.ref ?? "");
  const run = (action: () => Promise<FormState>) =>
    start(async () => {
      setMessage({});
      setMessage(await action());
    });
  const href = (ref: string) => `/trips/${tripId}/routes/${encodeURIComponent(ref)}`;
  const variants = options.filter((option) => option.variant);
  const others = options.filter((option) => !option.variant);
  const label = (option: RouteOption) => `${option.name}${option.facts ? ` · ${option.facts}` : ""}`;

  if (!editing && current === undefined) return null;
  return (
    <div className="flex flex-col gap-2">
      <p className="flex flex-wrap items-center gap-1">
        {current !== undefined ? (
          <>
            <span>Z „Tras”:</span>
            <Link href={href(current.ref)} className="btn-mini">
              {current.name}
            </Link>
            {editing && (
              <button type="button" onClick={() => run(() => detachItemRoute(tripId, itemRef))} disabled={pending} className="btn-mini">
                odepnij
              </button>
            )}
          </>
        ) : (
          canSave && <span className="text-zinc-500">Przebieg tego przejazdu nie jest w „Trasach”.</span>
        )}
        {editing && canSave && current === undefined && (
          <button type="button" onClick={() => run(() => saveItemCarRoute(tripId, itemRef))} disabled={pending} className="btn-secondary btn-sm">
            Zapisz w „Trasach”
          </button>
        )}
      </p>
      {editing && options.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <select value={chosen} onChange={(event) => setChosen(event.target.value)} disabled={pending} aria-label="Trasa z „Tras” do podpięcia" className="field max-w-full px-2 py-1 text-sm">
            {variants.length > 0 && (
              <optgroup label="Warianty tej samej drogi">
                {variants.map((option) => (
                  <option key={option.ref} value={option.ref}>
                    {label(option)}
                  </option>
                ))}
              </optgroup>
            )}
            {others.length > 0 && (
              <optgroup label={variants.length > 0 ? "Inne trasy" : "Trasy wyjazdu"}>
                {others.map((option) => (
                  <option key={option.ref} value={option.ref}>
                    {label(option)}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <button type="button" onClick={() => run(() => attachItemRoute(tripId, itemRef, chosen))} disabled={pending || chosen === ""} className="btn-primary btn-sm">
            {current === undefined ? "Podepnij" : "Zamień"}
          </button>
        </div>
      )}
      {message.error && <p className="text-sm msg-error">{message.error}</p>}
      {message.ok && <p className="text-sm msg-ok">{message.ok}</p>}
    </div>
  );
}
