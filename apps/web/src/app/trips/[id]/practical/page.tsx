import { PracticalInfo } from "@expeditionplan/core";
import type { SourceCheck } from "@expeditionplan/planner";
import { stateFromPayload } from "@expeditionplan/sync";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { draftPractical } from "@/app/practical-actions";
import { PlanActionButton } from "@/components/plan-action-button";
import { PracticalReview } from "@/components/practical-review";
import { Loading, Shell } from "@/components/shell";
import { requireUser } from "@/lib/auth";

/**
 * Informacje praktyczne wyjazdu: notatki ogólne, kontakty i źródła z planu, a dla organizatora
 * i edytora — etap 5 AI (szkic do akceptacji). Pakowanie i zadania z AI lądują w swoich miejscach
 * (lista pakowania w telefonie, zadania na stronie rezerwacji i zadań).
 */

// „Przygotuj z AI” (akcja serwera na tej stronie): AI i sprawdzanie źródeł, zwykle 20–60 s.
export const maxDuration = 120;

export default function PracticalPage(props: PageProps<"/trips/[id]/practical">) {
  return (
    <Shell>
      <Suspense fallback={<Loading />}>
        <Practical params={props.params} />
      </Suspense>
    </Shell>
  );
}

const card = "flex flex-col gap-3 card p-4";

async function Practical({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireUser(`/trips/${id}/practical`);
  const [{ data, error }, membership, draftRow] = await Promise.all([
    supabase.rpc("pull_changes", { p_trip: id, p_since: 0 }),
    supabase.from("my_trips").select("role").eq("id", id).maybeSingle(),
    supabase
      .from("ai_runs")
      .select("id, output, created_at, status")
      .eq("trip_id", id)
      .eq("stage", "practical")
      .in("status", ["ok", "accepted"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (error) return <p className="text-sm text-red-600">{error.message}</p>;
  if (data === null) notFound();
  const doc = stateFromPayload(data as Parameters<typeof stateFromPayload>[0]).doc;
  const canEdit = membership.data?.role === "owner" || membership.data?.role === "editor";
  const output = draftRow.data?.output as { info?: unknown; sources?: SourceCheck[] } | null | undefined;
  const draft = PracticalInfo.safeParse(output?.info);
  const notes = doc.notes.filter((note) => note.scope === "trip");

  return (
    <>
      <div className="flex flex-col gap-1">
        <Link href={`/trips/${id}`} className="back-link">
          ← {doc.trip.title}
        </Link>
        <h1 className="text-2xl font-semibold">Informacje praktyczne</h1>
      </div>

      {canEdit && (
        <PlanActionButton
          run={draftPractical.bind(null, id)}
          label={draft.success ? "Przygotuj nowy szkic z AI" : "Przygotuj z AI"}
          note="Notatki, kontakty alarmowe, pakowanie, zadania i źródła — szkic do akceptacji (Gemini, ok. 30 s)"
        />
      )}
      {canEdit && draft.success && draftRow.data?.status === "ok" && <PracticalReview tripId={id} runId={draftRow.data.id} info={draft.data} checks={output?.sources ?? []} />}
      {/* Po „Dodaj zaznaczone” szkic znika z odświeżonej strony — potwierdzenie zostaje tutaj. */}
      {canEdit && draftRow.data?.status === "accepted" && <p className="text-sm text-green-700 dark:text-green-400">Ostatni szkic AI dodany do planu — notatki, kontakty i źródła są niżej, pakowanie w telefonie, zadania na stronie rezerwacji i zadań.</p>}

      <section className={card}>
        <h2 className="text-lg font-semibold">Notatki ({notes.length})</h2>
        {notes.length === 0 ? (
          <p className="text-sm text-zinc-500">Plan nie ma ogólnych notatek.</p>
        ) : (
          <ul className="flex flex-col gap-3 text-sm">
            {notes.map((note, i) => (
              <li key={note.ref ?? i}>
                {note.title && <span className="font-medium">{note.title}</span>}
                <span className="block whitespace-pre-line text-zinc-600 dark:text-zinc-400">{note.body}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Link href={`/trips/${id}/contacts`} className="btn-secondary self-start">
        Kontakty i numery alarmowe ({doc.contacts.length}) →
      </Link>

      {doc.sources.length > 0 && (
        <section className={card}>
          <h2 className="text-lg font-semibold">Źródła ({doc.sources.length})</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {doc.sources.map((source) => (
              <li key={source.ref}>
                {source.url ? (
                  <a href={source.url} target="_blank" rel="noreferrer" className="underline">
                    {source.title}
                  </a>
                ) : (
                  source.title
                )}
                {source.checkedAt ? <span className="text-xs text-zinc-500"> · sprawdzone {source.checkedAt}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
