"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import type { FormState } from "@/app/actions";
import { saveLegEnds } from "@/app/leg-ends-actions";
import { DialogTitle } from "@/components/dialog-title";

/** Wiersz okna: przejazd z brakami i propozycja dla każdego brakującego końca (`checkLegEnds` liczone na stronie planu). */
export type LegEndsRow = {
  itemRef: string;
  title: string;
  day: string;
  ends: { end: "from" | "to"; proposal?: { key: string; place: string; created: boolean; pinned: boolean; source: string; detail?: string } }[];
};

const END = { from: "Skąd", to: "Dokąd" } as const;

/**
 * „Sprawdź skąd i dokąd” w narzędziach planu: czy każdy przejazd ma miejsce startu i celu, a gdzie nie —
 * propozycje ze śladów i „Tras”, nazwy punktu i sąsiednich punktów dnia. Zapis tylko zaznaczonych (`saveLegEnds`).
 */
export function LegEndsCheck({ tripId, rows, checked, withoutLeg }: { tripId: string; rows: LegEndsRow[]; checked: number; withoutLeg: number }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const proposals = rows.flatMap((row) => row.ends.flatMap((each) => (each.proposal ? [each.proposal.key] : [])));
  const [picked, setPicked] = useState<Set<string>>(new Set(proposals));
  const [result, setResult] = useState<FormState | null>(null);
  const [pending, start] = useTransition();
  const unknown = rows.reduce((sum, row) => sum + row.ends.filter((each) => each.proposal === undefined).length, 0);

  const open = () => {
    setPicked(new Set(proposals));
    setResult(null);
    dialog.current?.showModal();
  };
  const toggle = (key: string) =>
    setPicked((now) => {
      const next = new Set(now);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const save = () =>
    start(async () => {
      const answer = await saveLegEnds(tripId, [...picked]);
      setResult(answer);
      if (answer.ok) router.refresh();
    });

  return (
    <div className="flex flex-col items-end gap-0.5 text-right text-sm">
      <button type="button" onClick={open} className="btn-secondary btn-sm">
        Sprawdź skąd i dokąd przejazdów{rows.length > 0 ? ` (${rows.length})` : ""}
      </button>
      <span className="text-xs text-zinc-500">Ze śladów, „Tras” i miejsc planu</span>
      {result?.ok && <p className="msg-ok">{result.ok}</p>}

      <dialog ref={dialog} onClick={(event) => event.target === dialog.current && !pending && dialog.current.close()} aria-label="Skąd i dokąd przejazdów" className="card dialog text-left">
        <div className="flex flex-col gap-3 text-sm">
          <DialogTitle onClose={() => dialog.current?.close()} disabled={pending}>
            <h2>Skąd i dokąd przejazdów</h2>
            <p className="text-xs text-zinc-500">
              Sprawdzono przejazdy w dniach planu: {checked}.{" "}
              {rows.length === 0 ? "Każdy ma miejsce startu i celu." : `Bez startu albo celu: ${rows.length}.`}
              {withoutLeg > 0 ? ` Bez rodzaju przejazdu (pominięte): ${withoutLeg}.` : ""}
            </p>
          </DialogTitle>

          {rows.length > 0 && (
            <>
              <p className="text-zinc-600 dark:text-zinc-400">
                Propozycje po kolei: końce śladu GPX albo trasy z „Tras”, linia przejazdu na mapie, nazwa w tytule punktu, a na końcu sąsiednie punkty dnia i nocleg. Odznacz to, co nie pasuje.
              </p>
              <ul className="flex flex-col gap-2">
                {rows.map((row) => (
                  <li key={row.itemRef} className="panel flex flex-col gap-1 p-3">
                    <p className="flex flex-wrap items-baseline gap-2">
                      <span className="text-xs text-zinc-500">{row.day}</span>
                      <Link href={`/trips/${tripId}/item/${encodeURIComponent(row.itemRef)}`} onClick={() => dialog.current?.close()} className="btn-mini">
                        {row.title}
                      </Link>
                    </p>
                    {row.ends.map(({ end, proposal }) =>
                      proposal === undefined ? (
                        <p key={end} className="text-zinc-500">
                          {END[end]}: nie ma podpowiedzi — wskaż je na karcie punktu.
                        </p>
                      ) : (
                        <label key={end} className="flex items-baseline gap-2">
                          <input type="checkbox" checked={picked.has(proposal.key)} onChange={() => toggle(proposal.key)} disabled={pending} />
                          <span>
                            {END[end]}: <strong>{proposal.place}</strong>
                            {proposal.created ? " (nowe miejsce)" : proposal.pinned ? " (dostanie współrzędne ze śladu)" : ""}
                            <span className="text-xs text-zinc-500">
                              {" "}
                              — {proposal.source}
                              {proposal.detail ? `: ${proposal.detail}` : ""}
                            </span>
                          </span>
                        </label>
                      ),
                    )}
                  </li>
                ))}
              </ul>
              {unknown > 0 && <p className="text-xs text-zinc-500">Bez podpowiedzi: {unknown}. Takie końce ustawisz w nagłówku punktu („Skąd”, „Dokąd”) albo wgrywając ślad GPX.</p>}
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={save} disabled={pending || picked.size === 0} className="btn-primary btn-sm">
                  {pending ? "Zapisuję…" : `Zastosuj zaznaczone (${picked.size})`}
                </button>
                <button type="button" onClick={() => dialog.current?.close()} disabled={pending} className="btn-secondary btn-sm">
                  Anuluj
                </button>
              </div>
            </>
          )}
          {result?.error && <p className="msg-error">{result.error}</p>}
          {result?.ok && <p className="msg-ok">{result.ok}</p>}
        </div>
      </dialog>
    </div>
  );
}
