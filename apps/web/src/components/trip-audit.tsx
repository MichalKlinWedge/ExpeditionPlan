"use client";

import { AUDIT_CATEGORY, AUDIT_SEVERITY, type StoredAudit } from "@expeditionplan/core";
import Link from "next/link";
import { useActionState, useState, useTransition } from "react";

import type { FormState } from "@/app/actions";
import { dismissAuditFinding, runTripAudit } from "@/app/audit-actions";
import { bookingAnchor } from "@/lib/booking-link";

type Run = { id: string; createdAt: string; stored: StoredAudit };
type Names = { days: Record<string, string>; items: Record<string, string>; bookings: Record<string, string> };

const ORDER = { error: 0, warning: 1, tip: 2 } as const;
const TONE = { error: "msg-error", warning: "text-amber-700 dark:text-amber-400", tip: "text-zinc-500" } as const;

/**
 * „Sprawdź wyjazd” (strona dostrajania): kontrola całego wyjazdu z AI — spójność, błędy, zagrożenia
 * (`app/audit-actions.ts`). Uwagi tylko do przeczytania, z przyciskami do dnia, punktów i rezerwacji; plan zmienia człowiek.
 */
export function TripAudit({ tripId, run, names }: { tripId: string; run: Run | null; names: Names }) {
  const [state, action, pending] = useActionState(runTripAudit.bind(null, tripId), {});
  const [dismissState, setDismissState] = useState<FormState>({});
  const [dismissing, start] = useTransition();
  const findings = run === null ? [] : [...run.stored.audit.findings].filter((each) => !run.stored.dismissed.includes(each.id)).sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
  const hidden = run === null ? 0 : run.stored.dismissed.length;
  return (
    <section className="card flex flex-col gap-3 p-4 text-sm">
      <h2 className="card-title">Sprawdź wyjazd</h2>
      <p className="text-zinc-600 dark:text-zinc-400">
        AI czyta cały wyjazd — dni z godzinami, noclegi, rezerwacje i braki z „Gotowości” — i wypisuje niespójności, błędy i zagrożenia. Niczego nie zmienia w planie.
      </p>
      <form action={action} className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-60 flex-1 flex-col gap-1 text-xs text-zinc-500">
          Na co zwrócić uwagę (opcjonalnie)
          <input name="note" maxLength={500} placeholder="np. dzieci, wcześnie rano lot, jazda nocą" className="field px-2 py-1 text-sm" disabled={pending} />
        </label>
        <button disabled={pending} className="btn-primary btn-sm">
          {pending ? "Sprawdzam… (do 2 min)" : run === null ? "Sprawdź wyjazd z AI" : "Sprawdź od nowa"}
        </button>
      </form>
      {state.error && <p className="text-xs msg-error">{state.error}</p>}
      {state.ok && <p className="text-xs msg-ok">{state.ok}</p>}

      {run !== null && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-zinc-500">
            Kontrola z {new Date(run.createdAt).toLocaleString("pl-PL", { dateStyle: "medium", timeStyle: "short" })} — plan mógł się od tego czasu zmienić.
            {hidden > 0 ? ` Odrzucone: ${hidden}.` : ""}
          </p>
          <p className="panel-ai p-3">{run.stored.audit.summary}</p>
          {findings.length === 0 ? (
            <p className="text-zinc-500">Brak otwartych uwag.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {findings.map((finding) => (
                <li key={finding.id} className="panel flex flex-col gap-1 p-3">
                  <p className="flex flex-wrap items-baseline gap-2">
                    <span className={`text-xs font-semibold uppercase ${TONE[finding.severity]}`}>{AUDIT_SEVERITY[finding.severity]}</span>
                    <span className="text-xs text-zinc-500">{AUDIT_CATEGORY[finding.category]}</span>
                    <strong className="flex-1">{finding.title}</strong>
                    <button
                      type="button"
                      disabled={dismissing}
                      onClick={() => start(async () => setDismissState(await dismissAuditFinding(tripId, run.id, finding.id)))}
                      title="Nie dotyczy albo już poprawione — ukryj tę uwagę"
                      className="btn-mini btn-mini-danger">
                      odrzuć
                    </button>
                  </p>
                  <p>{finding.detail}</p>
                  {finding.suggestion && <p className="text-zinc-600 dark:text-zinc-400">→ {finding.suggestion}</p>}
                  {(finding.dayRef || finding.itemRefs.length > 0 || finding.bookingRef) && (
                    <p className="flex flex-wrap items-center gap-1">
                      {finding.dayRef && names.days[finding.dayRef] && (
                        <Link href={`/trips/${tripId}/plan?day=${encodeURIComponent(finding.dayRef)}`} className="btn-mini">
                          {names.days[finding.dayRef]}
                        </Link>
                      )}
                      {finding.itemRefs.map((ref) =>
                        names.items[ref] ? (
                          <Link key={ref} href={`/trips/${tripId}/item/${encodeURIComponent(ref)}`} title="Karta punktu" className="btn-mini">
                            {names.items[ref]}
                          </Link>
                        ) : null,
                      )}
                      {finding.bookingRef && names.bookings[finding.bookingRef] && (
                        <Link href={`/trips/${tripId}/logistics#${bookingAnchor(finding.bookingRef)}`} title="Rezerwacja" className="btn-mini">
                          🎫 {names.bookings[finding.bookingRef]}
                        </Link>
                      )}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
          {dismissState.error && <p className="text-xs msg-error">{dismissState.error}</p>}
          <p className="text-xs text-zinc-500">Uwagi pisze AI na podstawie planu — sprawdź je, zanim coś zmienisz. Godziny otwarcia i przepisy weryfikuj u źródła.</p>
        </div>
      )}
    </section>
  );
}
