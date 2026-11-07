import type { Metadata } from "next";
import { dbLoadError, lockedRefs, type PullPayload, refIndex, stateFromPayload } from "@expeditionplan/sync";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { CompareView } from "@/components/compare-view";
import { Loading, Shell } from "@/components/shell";
import { requireUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Porównanie ze szkicem — Expedition Planner" };

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

type Payload = PullPayload;

async function Compare({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const draftId = (await searchParams).draft;
  const { supabase } = await requireUser(`/trips/${id}`);
  if (typeof draftId !== "string" || draftId === id) return <ChooseDraft id={id} supabase={supabase} />;
  const [planRes, draftRes, membership] = await Promise.all([
    supabase.rpc("pull_changes", { p_trip: id, p_since: 0 }),
    supabase.rpc("pull_changes", { p_trip: draftId, p_since: 0 }),
    supabase.from("my_trips").select("role").eq("id", id).maybeSingle(),
  ]);
  const error = planRes.error ?? draftRes.error;
  if (error) return <p className="text-sm text-red-600">{dbLoadError(error)}</p>;
  if (planRes.data === null || draftRes.data === null) notFound();
  const role = membership.data?.role;
  if (role !== "owner" && role !== "editor") return <p className="text-sm text-zinc-500">Przenosić punkty do planu może organizator albo edytor.</p>;

  let plan: ReturnType<typeof stateFromPayload>;
  let draft: ReturnType<typeof stateFromPayload>;
  try {
    plan = stateFromPayload(planRes.data as Payload);
    draft = stateFromPayload(draftRes.data as Payload);
  } catch (e) {
    return <p className="text-sm text-red-600">Plan w bazie nie przechodzi walidacji: {e instanceof Error ? e.message : String(e)}</p>;
  }
  const tables = (planRes.data as { tables: Parameters<typeof refIndex>[0] }).tables;
  const locked = [...lockedRefs(tables)];

  return (
    <>
      <div className="flex flex-col gap-1">
        <Link href={`/trips/${id}`} className="back-link">
          ← {plan.doc.trip.title}
        </Link>
        <h1 className="text-2xl font-semibold">Porównanie ze szkicem</h1>
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

const DRAFT = "Szkic AI: ";

/** Bez `?draft=`: wybór szkicu — najpierw „Szkic AI: <ten plan>”, potem inne szkice, potem pozostałe wyjazdy. */
async function ChooseDraft({ id, supabase }: { id: string; supabase: Awaited<ReturnType<typeof requireUser>>["supabase"] }) {
  const [trip, mine] = await Promise.all([supabase.from("my_trips").select("title").eq("id", id).maybeSingle(), supabase.from("my_trips").select("id, title").neq("id", id).order("start_date")]);
  if (trip.data === null) notFound();
  const title = trip.data.title!;
  const rank = (other: { title: string | null }) => (other.title === `${DRAFT}${title}` ? 0 : other.title!.startsWith(DRAFT) ? 1 : 2);
  const others = [...(mine.data ?? [])].sort((a, b) => rank(a) - rank(b));
  return (
    <>
      <div className="flex flex-col gap-1">
        <Link href={`/trips/${id}`} className="back-link">
          ← {title}
        </Link>
        <h1 className="text-2xl font-semibold">Porównanie ze szkicem</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Wybierz szkic (np. z „Zaplanuj z AI”) — zobaczysz go obok planu i przeniesiesz punkty.</p>
      </div>
      {others.length === 0 ? (
        <p className="card p-5 text-zinc-600 dark:text-zinc-400">Nie masz innych wyjazdów ani szkiców do porównania.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {others.map((other) => (
            <li key={other.id}>
              <Link href={`/trips/${id}/compare?draft=${other.id}`} className={`card flex h-full flex-col gap-1 p-4 transition hover:-translate-y-0.5 hover:border-sea ${rank(other) < 2 ? "border-dashed" : ""}`}>
                <span className="font-semibold">{other.title!.startsWith(DRAFT) ? other.title!.slice(DRAFT.length) : other.title}</span>
                <span className="text-xs text-zinc-500">{rank(other) === 0 ? "szkic AI tego planu" : rank(other) === 1 ? "szkic AI" : "inny wyjazd"}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
