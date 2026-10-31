import { stateFromPayload } from "@expeditionplan/sync";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PlanView } from "@/components/plan-view";
import { Loading, Shell } from "@/components/shell";
import { requireUser } from "@/lib/auth";

/**
 * Plan dzień po dniu. Dane idą tą samą drogą co na telefon: `pull_changes` → `stateFromPayload`
 * (dokument + zdarzenia z trasy), a harmonogram liczy silnik w przeglądarce.
 */
export default function PlanPage(props: PageProps<"/trips/[id]/plan">) {
  return (
    <Shell>
      <Suspense fallback={<Loading />}>
        <Plan params={props.params} />
      </Suspense>
    </Shell>
  );
}

async function Plan({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireUser(`/trips/${id}/plan`);
  const { data, error } = await supabase.rpc("pull_changes", { p_trip: id, p_since: 0 });
  if (error) return <p className="text-sm text-red-600">{error.message}</p>;
  if (data === null) notFound();
  let state: ReturnType<typeof stateFromPayload>;
  try {
    state = stateFromPayload(data as Parameters<typeof stateFromPayload>[0]);
  } catch (e) {
    return <p className="text-sm text-red-600">Plan w bazie nie przechodzi walidacji: {e instanceof Error ? e.message : String(e)}</p>;
  }
  return (
    <>
      <div className="flex flex-col gap-1">
        <Link href={`/trips/${id}`} className="text-sm text-zinc-500 underline">
          ← {state.doc.trip.title}
        </Link>
        <h1 className="text-2xl font-semibold">Plan dzień po dniu</h1>
      </div>
      <PlanView state={state} />
    </>
  );
}
