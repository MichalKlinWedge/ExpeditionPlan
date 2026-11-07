"use client";

import { copyFromDraft, dayLabel, type DaySchedule, documentProblem, inAllVariants, type MergeEdit, pairDays, type PlanItem as Item, replaceDayFromDraft, scheduleDay, SLACK_LABEL, type TripDocument } from "@expeditionplan/core";
import { saveMergeEdit, uuidv7 } from "@expeditionplan/sync";
import Link from "next/link";
import { useState } from "react";

import { createClient } from "@/lib/supabase/client";
import { useHydrated } from "@/lib/use-hydrated";
import { useRefreshOnReturn } from "@/lib/use-refresh-on-return";

/**
 * Szkic AI obok planu, dzień po dniu (po dacie). Z prawej kolumny punkty przechodzą do planu
 * pojedynczo, cały dzień naraz albo zastępują dzień planu. Godziny i zapas liczy silnik dla obu
 * stron, więc widać, czy dzień ze szkicu się spina. Zmienia się tylko plan — szkic zostaje.
 */

type Props = {
  tripId: string;
  plan: TripDocument;
  ids: Record<string, string>;
  /** Punkty planu zmienione ręcznie (`user_locked`) — zastąpienie dnia ich nie usuwa. */
  locked: string[];
  draft: TripDocument;
  draftTripId: string;
};

const SLACK: Record<string, { label: string; tone: string }> = {
  large: { label: SLACK_LABEL.large, tone: "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200" },
  small: { label: SLACK_LABEL.small, tone: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" },
  none: { label: SLACK_LABEL.none, tone: "bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-200" },
  negative: { label: SLACK_LABEL.negative, tone: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200" },
};


const button = "btn-secondary btn-sm";
const key = (title: string) => title.trim().toLocaleLowerCase("pl");

function schedule(doc: TripDocument, dayRef: string | undefined): DaySchedule | null {
  if (dayRef === undefined) return null;
  try {
    return scheduleDay(doc, dayRef);
  } catch {
    return null;
  }
}

export function CompareView({ tripId, plan: initialPlan, ids: initialIds, locked: initialLocked, draft, draftTripId }: Props) {
  const [plan, setPlan] = useState(initialPlan);
  const [ids, setIds] = useState(initialIds);
  const [locked] = useState(() => new Set(initialLocked));
  const [status, setStatus] = useState<{ pending: boolean; error?: string; ok?: string }>({ pending: false });
  const hydrated = useHydrated();
  useRefreshOnReturn();

  /** Zmiana w pamięci od razu, zapis w tle; błąd cofa plan. Jedna zmiana naraz (ids rosną). */
  const apply = (edit: MergeEdit, ok: string) => {
    const invalid = documentProblem(edit.doc);
    if (invalid !== null) return setStatus({ pending: false, error: `Nie zapisano: ${invalid}` });
    const before = plan;
    setPlan(edit.doc);
    setStatus({ pending: true });
    saveMergeEdit(createClient(), tripId, edit, ids).then(
      (next) => {
        setIds(next);
        const kept = edit.kept.length > 0 ? ` Zostały: ${edit.kept.map((each) => `„${each.title}” (${each.reason})`).join("; ")}.` : "";
        setStatus({ pending: false, ok: ok + kept });
      },
      (error: unknown) => {
        setPlan(before);
        setStatus({ pending: false, error: error instanceof Error ? error.message : String(error) });
      },
    );
  };

  const copy = (refs: string[], date: string | null) =>
    apply(copyFromDraft(plan, draft, refs, date, uuidv7), refs.length === 1 ? "Przeniesiono punkt do planu." : `Przeniesiono ${refs.length} punktów do planu.`);

  const replace = (date: string, planCount: number) => {
    if (planCount > 0 && !window.confirm(`Zastąpić ${planCount} punktów planu z ${dayLabel(date)} punktami szkicu? Punkty zmienione ręcznie i powiązane z budżetem, zadaniami czy ograniczeniami zostaną.`)) return;
    apply(replaceDayFromDraft(plan, draft, date, locked, uuidv7), `Dzień ${dayLabel(date)} zastąpiony szkicem.`);
  };

  const pairs = pairDays(plan, draft);
  const pool = draft.items.filter((item) => item.dayRef === undefined);
  const inPool = new Set(plan.items.filter((item) => item.dayRef === undefined).map((item) => key(item.title)));
  const planPlaces = new Map(plan.places.map((place) => [place.ref, place.name]));
  const draftPlaces = new Map(draft.places.map((place) => [place.ref, place.name]));

  return (
    <div className="flex flex-col gap-6">
      <p className="sticky top-0 z-10 -mx-4 bg-[var(--background)] px-4 py-1 text-xs text-zinc-500">
        {status.pending ? "Zapisuję…" : status.error ? <span className="text-red-600">{status.error}</span> : status.ok ? <span className="text-green-700 dark:text-green-400">{status.ok}</span> : "Zmienia się tylko plan — szkic zostaje bez zmian."}
      </p>

      {pairs.map((pair) => {
        // Godziny tylko w przeglądarce — patrz `useHydrated`.
        const planSchedule = hydrated ? schedule(plan, pair.planDay?.ref) : null;
        const draftSchedule = hydrated ? schedule(draft, pair.draftDay?.ref) : null;
        const inPlan = new Set(pair.plan.map((item) => key(item.title)));
        const missing = pair.draft.filter((item) => inAllVariants(item) && !inPlan.has(key(item.title)));
        return (
          <section key={pair.date} className="flex flex-col gap-3 card p-4">
            <header className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold first-letter:uppercase">{dayLabel(pair.date)}</h2>
              {pair.draft.length > 0 && (
                <div className="flex gap-2">
                  <button disabled={status.pending || missing.length === 0} onClick={() => copy(missing.map((item) => item.ref), pair.date)} className={button}>
                    Dodaj brakujące ze szkicu ({missing.length})
                  </button>
                  <button disabled={status.pending} onClick={() => replace(pair.date, pair.plan.length)} className={button}>
                    Zastąp dzień szkicem
                  </button>
                </div>
              )}
            </header>
            <div className="grid gap-4 md:grid-cols-2">
              <Column
                label="Plan"
                title={pair.planDay?.title}
                items={pair.plan}
                schedule={planSchedule}
                places={planPlaces}
                empty={pair.planDay ? "Dzień bez punktów." : "Plan nie ma tego dnia — powstanie przy przeniesieniu."}
                marker={(item) => (locked.has(item.ref) ? <span title="Zmieniony ręcznie — zastąpienie dnia go zostawi">✎</span> : null)}
              />
              <Column
                label="Szkic AI"
                title={pair.draftDay?.title}
                items={pair.draft}
                schedule={draftSchedule}
                places={draftPlaces}
                empty="Szkic nie ma punktów tego dnia."
                marker={(item) =>
                  inPlan.has(key(item.title)) ? (
                    <span className="text-xs text-green-700 dark:text-green-400">✓ w planie</span>
                  ) : (
                    <button disabled={status.pending} onClick={() => copy([item.ref], pair.date)} className={button}>
                      → do planu
                    </button>
                  )
                }
              />
            </div>
          </section>
        );
      })}

      {pool.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">Pula szkicu — pomysły poza dniami ({pool.length})</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {pool.map((item) => (
              <li key={item.ref} className="flex flex-wrap items-center gap-2">
                <span>{item.title}</span>
                {item.area && <span className="text-zinc-500">· {item.area}</span>}
                {inPool.has(key(item.title)) ? (
                  <span className="text-xs text-green-700 dark:text-green-400">✓ w puli planu</span>
                ) : (
                  <button disabled={status.pending} onClick={() => copy([item.ref], null)} className={button}>
                    → do puli planu
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="flex flex-wrap gap-2">
        <Link href={`/trips/${tripId}/plan`} className="btn-secondary btn-sm">
          Plan dzień po dniu
        </Link>
        <Link href={`/trips/${draftTripId}/plan`} className="btn-secondary btn-sm">
          Szkic dzień po dniu
        </Link>
      </p>
    </div>
  );
}

type ColumnProps = {
  label: string;
  title: string | undefined;
  items: Item[];
  schedule: DaySchedule | null;
  places: Map<string, string>;
  empty: string;
  marker: (item: Item) => React.ReactNode;
};

function Column({ label, title, items, schedule, places, empty, marker }: ColumnProps) {
  const times = new Map(schedule?.items.map((each) => [each.ref, each]) ?? []);
  const slack = schedule?.slack ? SLACK[schedule.slack] : undefined;
  const last = schedule?.items.at(-1);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{label}</span>
        {title && <span className="text-zinc-500">· {title}</span>}
        {slack && <span className={`rounded-full px-2 py-0.5 text-xs ${slack.tone}`}>{slack.label}</span>}
        {last && <span className="text-xs text-zinc-500">koniec ok. {last.endLocal}</span>}
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-zinc-500">{empty}</p>
      ) : (
        <ol className="flex flex-col gap-1 text-sm">
          {items.map((item) => {
            const at = times.get(item.ref);
            const place = item.placeRef === undefined ? undefined : places.get(item.placeRef);
            return (
              <li key={item.ref} className="flex items-start gap-2">
                <span className="w-12 shrink-0 tabular-nums text-zinc-500">{at?.startLocal ?? "—"}</span>
                <span className="flex-1">
                  {item.title}
                  {item.durationMin !== undefined && <span className="text-zinc-500"> · {item.durationMin} min</span>}
                  {!inAllVariants(item) && <span className="text-xs text-zinc-500"> · tylko w wariancie</span>}
                  {place && place !== item.title && <span className="block text-xs text-zinc-500">{place}</span>}
                </span>
                <span className="shrink-0">{marker(item)}</span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
