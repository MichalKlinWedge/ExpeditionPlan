import { refIndex, stateFromPayload } from "@expeditionplan/sync";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { CompareView } from "@/components/compare-view";
import { Loading, Shell } from "@/components/shell";
import { requireUser } from "@/lib/auth";

/**
 * Szkic AI obok planu (`?draft=<id wyjazdu ze szkicem>`). Oba dokumenty idą drogą planu
 * (`pull_changes`); zmieniać wolno tylko plan, więc strona wymaga roli organizatora albo edytora.
 */
export default function ComparePage(props: PageProps<"/trips/[id]/compare">) {
  return (
    <Shell>
      <Suspense fallback={<Loading />}>
        <Compare params={props.params} searchParams={props.searchParams} />
      </Suspense>
    </Shell>
  );
}

type Payload = Parameters<typeof stateFromPayload>[0];
type Row = { id: string; ref: string | null; user_locked?: boolean; deleted_at: string | null };

async function Compare({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const draftId = (await searchParams).draft;
  const { supabase } = await requireUser(`/trips/${id}`);
  if (typeof draftId !== "string" || draftId === id) return <p className="text-sm text-red-600">Wybierz szkic do porównania na stronie wyjazdu.</p>;
  const [planRes, draftRes, membership] = await Promise.all([
    supabase.rpc("pull_changes", { p_trip: id, p_since: 0 }),
    supabase.rpc("pull_changes", { p_trip: draftId, p_since: 0 }),
    supabase.from("my_trips").select("role").eq("id", id).maybeSingle(),
  ]);
  const error = planRes.error ?? draftRes.error;
  if (error) return <p className="text-sm text-red-600">{error.message}</p>;
  if (planRes.data === null || draftRes.data === null) notFound();
  const role = membership.data?.role;
  if (role !== "owner" && role !== "editor") return <p className="text-sm text-red-600">Przenosić punkty do planu może organizator albo edytor.</p>;

  let plan: ReturnType<typeof stateFromPayload>;
  let draft: ReturnType<typeof stateFromPayload>;
  try {
    plan = stateFromPayload(planRes.data as Payload);
    draft = stateFromPayload(draftRes.data as Payload);
  } catch (e) {
    return <p className="text-sm text-red-600">Plan w bazie nie przechodzi walidacji: {e instanceof Error ? e.message : String(e)}</p>;
  }
  const tables = (planRes.data as { tables: Parameters<typeof refIndex>[0] }).tables;
  const locked = ((tables.items ?? []) as Row[]).filter((row) => row.user_locked && row.deleted_at === null).map((row) => row.ref ?? `id-${row.id}`);

  return (
    <>
      <div className="flex flex-col gap-1">
        <Link href={`/trips/${id}`} className="text-sm text-zinc-500 underline">
          ← {plan.doc.trip.title}
        </Link>
        <h1 className="text-2xl font-semibold">Szkic obok planu</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Z prawej „{draft.doc.trip.title}”. Przenoś punkty pojedynczo, brakujące z całego dnia albo zastąp dzień — punkty zmienione ręcznie (✎) zostają.
        </p>
      </div>
      <CompareView
        // Nowa wersja planu albo szkicu z serwera = nowy stan widoku (patrz `useRefreshOnReturn`).
        key={`${(planRes.data as { version: number }).version}-${(draftRes.data as { version: number }).version}`}
        tripId={id} plan={plan.doc} ids={refIndex(tables)} locked={locked} draft={draft.doc} draftTripId={draftId} />
    </>
  );
}
