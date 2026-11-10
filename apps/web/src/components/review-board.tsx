"use client";

import { dayLabel, REVIEW_CATEGORY } from "@expeditionplan/core";
import Link from "next/link";
import { useActionState, useState, useTransition } from "react";

import type { FormState } from "@/app/actions";
import { applySuggestions, dismissSuggestions, proposeReview } from "@/app/review-actions";
import { SparkIcon } from "@/components/icons";
import type { ReviewRow, ReviewSuggestionView, ReviewView } from "@/lib/review-view";

/**
 * Przegląd planu z AI na porównaniu: z lewej plan, z prawej plan po wszystkich nierozstrzygniętych
 * propozycjach (godziny i zapas z silnika). Każdą propozycję stosuje się albo odrzuca osobno albo
 * zaznaczone naraz; do planu trafia dopiero po „zastosuj”.
 */

export type ReviewChecks = { tripId: string; placesOffMap: number; legsWithoutTime: number; sightsWithoutGuide: number };

const FOCUS = ["schedule", "routes", "map", "descriptions", "meals", "variants"] as const;

const MARK: Record<string, { label: string; tone: string }> = {
  new: { label: "nowy", tone: "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200" },
  changed: { label: "zmiana", tone: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" },
  removed: { label: "wypada", tone: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200" },
};

export function ReviewBoard({ tripId, runId, view, checks }: { tripId: string; runId: string | null; view: ReviewView | null; checks: ReviewChecks }) {
  const [state, action, asking] = useActionState(proposeReview.bind(null, tripId), {});
  const [selected, setSelected] = useState<string[]>([]);
  const [decision, setDecision] = useState<FormState>({});
  const [deciding, start] = useTransition();
  const byId = new Map(view?.suggestions.map((each) => [each.id, each]) ?? []);
  const live = selected.filter((id) => byId.has(id));

  const decide = (kind: "apply" | "dismiss", ids: string[]) => {
    if (runId === null || ids.length === 0) return;
    start(async () => {
      const result = kind === "apply" ? await applySuggestions(tripId, runId, ids) : await dismissSuggestions(tripId, runId, ids);
      setDecision(result);
      if (!result.error) setSelected((current) => current.filter((id) => !ids.includes(id)));
    });
  };
  const toggle = (id: string) => setSelected((current) => (current.includes(id) ? current.filter((each) => each !== id) : [...current, id]));

  const card = (suggestion: ReviewSuggestionView) => (
    <SuggestionCard
      key={suggestion.id}
      suggestion={suggestion}
      checked={live.includes(suggestion.id)}
      disabled={deciding}
      onToggle={() => toggle(suggestion.id)}
      onApply={() => decide("apply", [suggestion.id])}
      onDismiss={() => decide("dismiss", [suggestion.id])}
    />
  );

  return (
    <div className="flex flex-col gap-6 text-sm">
      <form action={action} className="card flex flex-col gap-3 p-4">
        <p className="text-zinc-600 dark:text-zinc-400">
          AI przegląda plan razem z faktami z kodu (godziny i ostrzeżenia silnika, odległości, miejsca poza mapą, punkty bez opisu) i proponuje zmiany. Każdą zobaczysz obok planu, zanim ją zastosujesz.
        </p>
        <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
          <legend className="mb-1 text-xs text-zinc-500">Na co patrzeć (nic nie zaznaczone = na wszystko):</legend>
          {FOCUS.map((each) => (
            <label key={each} className="flex items-center gap-1.5">
              <input type="checkbox" name="focus" value={each} />
              {REVIEW_CATEGORY[each]}
            </label>
          ))}
        </fieldset>
        <input name="note" maxLength={500} placeholder="Coś szczególnego? Np. „dzieci 6 i 9 lat, mniej chodzenia”" className="field px-3 py-2" />
        <div className="flex flex-wrap items-center gap-3">
          <button disabled={asking} className="btn-primary">
            <SparkIcon className="size-4" />
            {asking ? "AI przegląda plan…" : view ? "Przejrzyj od nowa" : "Przejrzyj plan z AI"}
          </button>
          {view && <span className="text-xs text-zinc-500">Nowy przegląd zastępuje obecne propozycje.</span>}
        </div>
        {state.error && <p className="msg-error">{state.error}</p>}
        {state.ok && <p className="msg-ok">{state.ok}</p>}
      </form>

      <Checks checks={checks} />

      {view && (
        <>
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold">Propozycje AI</h2>
            <p className="text-zinc-700 dark:text-zinc-300">{view.summary}</p>
            {(view.decided.applied > 0 || view.decided.dismissed > 0) && (
              <p className="text-xs text-zinc-500">
                Zastosowane: {view.decided.applied} · odrzucone: {view.decided.dismissed}
              </p>
            )}
          </div>

          <div className="sticky top-0 z-10 -mx-4 flex flex-wrap items-center gap-3 bg-[var(--background)] px-4 py-2">
            {view.suggestions.length > 0 && (
              <>
                <button type="button" disabled={deciding} onClick={() => setSelected(live.length === view.suggestions.length ? [] : view.suggestions.map((each) => each.id))} className="btn-mini">
                  {live.length === view.suggestions.length ? "odznacz wszystkie" : "zaznacz wszystkie"}
                </button>
                <button type="button" disabled={deciding || live.length === 0} onClick={() => decide("apply", live)} className="btn-primary">
                  {deciding ? "Zapisuję…" : `Zastosuj zaznaczone (${live.length})`}
                </button>
                <button type="button" disabled={deciding || live.length === 0} onClick={() => decide("dismiss", live)} className="btn-mini btn-mini-danger">
                  Odrzuć zaznaczone
                </button>
              </>
            )}
            {decision.error && <span className="msg-error">{decision.error}</span>}
            {decision.ok && <span className="msg-ok">{decision.ok}</span>}
          </div>

          {view.suggestions.length === 0 && <p className="card p-4 text-zinc-600 dark:text-zinc-400">Wszystkie propozycje są rozstrzygnięte.</p>}

          {view.tripWide.length > 0 && (
            <section className="card flex flex-col gap-3 p-4">
              <h3 className="card-title">Mapa i cały wyjazd</h3>
              <div className="flex flex-col gap-2">{view.tripWide.flatMap((id) => (byId.has(id) ? [card(byId.get(id)!)] : []))}</div>
            </section>
          )}

          {view.days.map((day) => (
            <section key={day.date} className="card flex flex-col gap-3 p-4">
              <h3 className="card-title first-letter:uppercase">
                {dayLabel(day.date)}
                {day.title && <span className="font-normal text-zinc-500"> · {day.title}</span>}
              </h3>
              {day.suggestionIds.length > 0 && <div className="flex flex-col gap-2">{day.suggestionIds.flatMap((id) => (byId.has(id) ? [card(byId.get(id)!)] : []))}</div>}
              <div className="grid gap-4 md:grid-cols-2">
                <Column label="Plan" summary={day.before} rows={day.plan} />
                <Column label="Po propozycjach" summary={day.afterSummary} rows={day.after} />
              </div>
            </section>
          ))}
        </>
      )}

      <p className="flex flex-wrap gap-2">
        <Link href={`/trips/${tripId}/plan`} className="btn-secondary btn-sm">
          Plan dzień po dniu
        </Link>
        <Link href={`/trips/${tripId}/tune`} className="btn-secondary btn-sm">
          Dostrajanie z AI
        </Link>
      </p>
    </div>
  );
}

function SuggestionCard(props: { suggestion: ReviewSuggestionView; checked: boolean; disabled: boolean; onToggle: () => void; onApply: () => void; onDismiss: () => void }) {
  const { suggestion, checked, disabled } = props;
  const possible = suggestion.results.some((each) => each.ok);
  return (
    <div className="flex gap-3 panel-ai p-3">
      <input type="checkbox" checked={checked} disabled={disabled || !possible} onChange={props.onToggle} className="mt-1" aria-label={`Zaznacz: ${suggestion.title}`} />
      <div className="flex flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="chip">{REVIEW_CATEGORY[suggestion.category] ?? suggestion.category}</span>
          <span className="font-medium">{suggestion.title}</span>
        </div>
        <p className="text-zinc-600 dark:text-zinc-400">{suggestion.why}</p>
        <ul className="flex flex-col gap-0.5 text-xs">
          {suggestion.results.map((result, i) => (
            <li key={i} className={result.ok ? "" : "text-zinc-500 line-through decoration-zinc-400"}>
              {result.ok ? "✓ " : "✗ "}
              {result.text}
            </li>
          ))}
        </ul>
        {suggestion.dates.length > 1 && <p className="text-xs text-zinc-500">Dotyczy dni: {suggestion.dates.map((date) => dayLabel(date)).join(", ")}</p>}
        <div className="flex flex-wrap gap-2 pt-1">
          <button type="button" disabled={disabled || !possible} onClick={props.onApply} className="btn-mini">
            zastosuj
          </button>
          <button type="button" disabled={disabled} onClick={props.onDismiss} className="btn-mini btn-mini-danger">
            odrzuć
          </button>
        </div>
      </div>
    </div>
  );
}

function Column({ label, summary, rows }: { label: string; summary: string; rows: ReviewRow[] }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{label}</span>
        <span className="text-xs text-zinc-500">{summary}</span>
      </div>
      {rows.length === 0 ? (
        <p className="text-zinc-500">Dzień bez punktów.</p>
      ) : (
        <ol className="flex flex-col gap-1">
          {rows.map((row) => (
            <li key={row.ref} className={`flex items-start gap-2 ${row.mark === "removed" ? "text-zinc-500 line-through decoration-zinc-400" : ""}`}>
              <span className="w-12 shrink-0 tabular-nums text-zinc-500">{row.time ?? "—"}</span>
              <span className="flex-1">
                {row.title}
                {row.detail && <span className="text-zinc-500"> · {row.detail}</span>}
                {row.changes && <span className="block text-xs text-amber-800 dark:text-amber-300">{row.changes.join("; ")}</span>}
              </span>
              {row.mark && <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs no-underline ${MARK[row.mark]!.tone}`}>{MARK[row.mark]!.label}</span>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** To, co poprawia kod bez AI — z przejściem do strony, która to robi. */
function Checks({ checks }: { checks: ReviewChecks }) {
  const rows = [
    checks.placesOffMap > 0 && { text: `Miejsca poza mapą: ${checks.placesOffMap}`, href: `/trips/${checks.tripId}/places`, label: "Miejsca" },
    checks.legsWithoutTime > 0 && { text: `Przejazdy bez czasu z trasy: ${checks.legsWithoutTime}`, href: `/trips/${checks.tripId}/plan`, label: "Plan: „Przelicz przejazdy”" },
    checks.sightsWithoutGuide > 0 && { text: `Miejsca do zwiedzania bez opisu z Wikipedii: ${checks.sightsWithoutGuide}`, href: `/trips/${checks.tripId}/guides`, label: "Opisy miejsc" },
  ].filter((row) => row !== false);
  if (rows.length === 0) return null;
  return (
    <section className="flex flex-col gap-1">
      <h2 className="text-xs text-zinc-500">Bez AI (dane z usług map i Wikipedii):</h2>
      <ul className="flex flex-col gap-1">
        {rows.map((row) => (
          <li key={row.href} className="flex flex-wrap items-center gap-2">
            {row.text}
            <Link href={row.href} className="btn-mini">
              {row.label}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
