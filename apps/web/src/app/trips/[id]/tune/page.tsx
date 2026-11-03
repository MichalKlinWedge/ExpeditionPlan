import { PlanPatch, scheduleDay, type TripDocument } from "@expeditionplan/core";
import { applyPatch } from "@expeditionplan/planner";
import { stateFromPayload, uuidv7 } from "@expeditionplan/sync";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { Loading, Shell } from "@/components/shell";
import { type Preview, TuneChat } from "@/components/tune-chat";
import { requireUser } from "@/lib/auth";

/**
 * Dostrajanie planu z AI (etap 3): rozmowa i najnowsza propozycja łatki. Podgląd liczy się od nowa
 * na aktualnym planie — gdyby ktoś w międzyczasie coś zmienił, widać to od razu (✓/✗).
 */

// „Zaproponuj zmiany” i „Zastosuj” (akcje serwera na tej stronie): AI i ugruntowanie, zwykle 10–40 s.
export const maxDuration = 120;

export default function TunePage(props: PageProps<"/trips/[id]/tune">) {
  return (
    <Shell>
      <Suspense fallback={<Loading />}>
        <Tune params={props.params} />
      </Suspense>
    </Shell>
  );
}

const SLACK: Record<string, string> = { large: "duży zapas", small: "mały zapas", none: "bez zapasu", negative: "nie spina się" };

/** „koniec 19:30 · mały zapas” dla dnia; `—`, gdy silnik nie umie go policzyć. */
function daySummary(doc: TripDocument, dayRef: string): string {
  try {
    const schedule = scheduleDay(doc, dayRef);
    const last = schedule.items.at(-1);
    return [last ? `koniec ${last.endLocal}` : "bez punktów", schedule.slack ? SLACK[schedule.slack] : null].filter(Boolean).join(" · ");
  } catch {
    return "—";
  }
}

type Row = { id: string; ref: string | null; user_locked?: boolean; deleted_at: string | null };

async function Tune({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireUser(`/trips/${id}/tune`);
  const [{ data, error }, membership, messages, runRow] = await Promise.all([
    supabase.rpc("pull_changes", { p_trip: id, p_since: 0 }),
    supabase.from("my_trips").select("role").eq("id", id).maybeSingle(),
    supabase.from("ai_messages").select("role, content").eq("trip_id", id).order("created_at", { ascending: false }).limit(20),
    supabase.from("ai_runs").select("id, output").eq("trip_id", id).eq("stage", "tune").eq("status", "ok").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (error) return <p className="text-sm text-red-600">{error.message}</p>;
  if (data === null) notFound();
  const canEdit = membership.data?.role === "owner" || membership.data?.role === "editor";
  const payload = data as Parameters<typeof stateFromPayload>[0];
  const doc = stateFromPayload(payload).doc;
  if (!canEdit) return <p className="text-sm text-zinc-500">Dostrajać plan z AI może organizator albo edytor.</p>;

  let preview: Preview | null = null;
  const patch = PlanPatch.safeParse((runRow.data?.output as { patch?: unknown } | null)?.patch);
  if (runRow.data && patch.success) {
    const rows = (payload.tables.items ?? []) as unknown as Row[];
    const locked = new Set(rows.filter((row) => row.user_locked && row.deleted_at === null).map((row) => row.ref ?? `id-${row.id}`));
    const applied = applyPatch(doc, patch.data, locked, uuidv7);
    // Dni, których dotyczy łatka: gdzie punkt był albo gdzie jest po zmianie.
    const touched = new Set<string>();
    for (const item of applied.doc.items) {
      const before = doc.items.find((each) => each.ref === item.ref);
      if (before === undefined || JSON.stringify(before) !== JSON.stringify(item)) {
        if (item.dayRef) touched.add(item.dayRef);
        if (before?.dayRef) touched.add(before.dayRef);
      }
    }
    for (const item of doc.items) if (item.dayRef && !applied.doc.items.some((each) => each.ref === item.ref)) touched.add(item.dayRef);
    preview = {
      runId: runRow.data.id,
      results: applied.results.map(({ ok, text }) => ({ ok, text })),
      days: doc.days.filter((day) => touched.has(day.ref)).map((day) => ({ date: day.date, before: daySummary(doc, day.ref), after: daySummary(applied.doc, day.ref) })),
    };
  }

  return (
    <>
      <div className="flex flex-col gap-1">
        <Link href={`/trips/${id}`} className="back-link">
          ← {doc.trip.title}
        </Link>
        <h1 className="text-2xl font-semibold">Dostrajanie z AI</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Napisz, co zmienić. AI proponuje łatkę — konkretne operacje na punktach — a do planu trafia dopiero po „Zastosuj”. Punkty zmienione ręcznie zostają nietknięte.
        </p>
      </div>
      <TuneChat tripId={id} turns={(messages.data ?? []).reverse()} preview={preview} />
      <p className="text-sm">
        <Link href={`/trips/${id}/plan`} className="underline">
          Plan dzień po dniu
        </Link>
      </p>
    </>
  );
}
