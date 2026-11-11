import type { Metadata } from "next";
import { DRAFT_PREFIX, draftNameScore, draftsForPlan, type GuideRow, ROUTABLE_MODES, StoredReview, undescribedSights } from "@expeditionplan/core";
import { dbLoadError, lockedRefs, type PullPayload, refIndex, stateFromPayload } from "@expeditionplan/sync";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { CompareView } from "@/components/compare-view";
import { ReviewBoard } from "@/components/review-board";
import { Loading, Shell } from "@/components/shell";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth";
import { reviewView } from "@/lib/review-view";

export async function generateMetadata(props: PageProps<"/trips/[id]/compare">): Promise<Metadata> {
  const review = (await props.searchParams).review !== undefined;
  return { title: `${review ? "Propozycje AI" : "Porównanie ze szkicem"} — Expedition Planner` };
}

// „Przejrzyj plan z AI” i „Zastosuj” (akcje serwera na tej stronie): AI i wyszukiwanie miejsc, zwykle 20–60 s.
export const maxDuration = 120;

/**
 * Szkic AI obok planu (`?draft=<id wyjazdu ze szkicem>`) albo plan obok siebie po propozycjach
 * z przeglądu AI (`?review=1`). Oba dokumenty idą drogą planu
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
  const query = await searchParams;
  const draftId = query.draft;
  const { supabase } = await requireUser(`/trips/${id}`);
  if (query.review !== undefined) return <Review id={id} supabase={supabase} />;
  if (typeof draftId !== "string" || draftId === id) return <ChooseDraft id={id} supabase={supabase} />;
  const [planRes, draftRes, membership] = await Promise.all([
    supabase.rpc("pull_changes", { p_trip: id, p_since: 0 }),
    supabase.rpc("pull_changes", { p_trip: draftId, p_since: 0 }),
    supabase.from("my_trips").select("role").eq("id", id).maybeSingle(),
  ]);
  const error = planRes.error ?? draftRes.error;
  if (error) return <p className="text-sm msg-error">{dbLoadError(error)}</p>;
  if (planRes.data === null || draftRes.data === null) notFound();
  const role = membership.data?.role;
  if (role !== "owner" && role !== "editor") return <p className="text-sm text-zinc-500">Przenosić punkty do planu może organizator albo edytor.</p>;

  let plan: ReturnType<typeof stateFromPayload>;
  let draft: ReturnType<typeof stateFromPayload>;
  try {
    plan = stateFromPayload(planRes.data as Payload);
    draft = stateFromPayload(draftRes.data as Payload);
  } catch (e) {
    return <p className="text-sm msg-error">Plan w bazie nie przechodzi walidacji: {e instanceof Error ? e.message : String(e)}</p>;
  }
  const tables = (planRes.data as { tables: Parameters<typeof refIndex>[0] }).tables;
  const locked = [...lockedRefs(tables)];

  return (
    <>
      <PageHeader
        back={{ href: `/trips/${id}`, label: plan.doc.trip.title }}
        title="Porównanie ze szkicem"
        intro={<>Z prawej „{draft.doc.trip.title}”. Przenoś punkty pojedynczo, brakujące z całego dnia albo zastąp dzień — punkty zmienione ręcznie (✎) zostają.</>}
      />
      <CompareView
        // Nowa wersja planu albo szkicu z serwera = nowy stan widoku (patrz `useRefreshOnReturn`).
        key={`${(planRes.data as { version: number }).version}-${(draftRes.data as { version: number }).version}`}
        tripId={id} plan={plan.doc} ids={refIndex(tables)} locked={locked} draft={draft.doc} draftTripId={draftId} />
    </>
  );
}

type Supabase = Awaited<ReturnType<typeof requireUser>>["supabase"];

/** Przegląd planu z AI: najnowszy otwarty przegląd liczony na aktualnym planie (✓/✗ od nowa przy każdym wejściu). */
async function Review({ id, supabase }: { id: string; supabase: Supabase }) {
  const [pulled, membership, runRow] = await Promise.all([
    supabase.rpc("pull_changes", { p_trip: id, p_since: 0 }),
    supabase.from("my_trips").select("role").eq("id", id).maybeSingle(),
    supabase.from("ai_runs").select("id, output").eq("trip_id", id).eq("stage", "review").eq("status", "ok").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (pulled.error) return <p className="text-sm msg-error">{dbLoadError(pulled.error)}</p>;
  if (pulled.data === null) notFound();
  const role = membership.data?.role;
  if (role !== "owner" && role !== "editor") return <p className="text-sm text-zinc-500">Przeglądać plan z AI może organizator albo edytor.</p>;
  const payload = pulled.data as Payload;
  let doc: ReturnType<typeof stateFromPayload>["doc"];
  try {
    doc = stateFromPayload(payload).doc;
  } catch (e) {
    return <p className="text-sm msg-error">Plan w bazie nie przechodzi walidacji: {e instanceof Error ? e.message : String(e)}</p>;
  }
  const locked = lockedRefs(payload.tables);
  const stored = StoredReview.safeParse(runRow.data?.output);
  const view = runRow.data && stored.success ? reviewView(doc, stored.data, locked) : null;
  const used = new Set(doc.items.flatMap((item) => [item.placeRef, item.leg?.fromPlaceRef, item.leg?.toPlaceRef]));
  const guides = (payload.tables as unknown as { audio_guides?: GuideRow[] }).audio_guides ?? [];
  const checks = {
    tripId: id,
    placesOffMap: doc.places.filter((place) => place.lat === undefined && used.has(place.ref)).length,
    legsWithoutTime: doc.items.filter((item) => item.dayRef !== undefined && item.leg !== undefined && ROUTABLE_MODES.has(item.leg.mode) && !item.leg.routed && !locked.has(item.ref)).length,
    sightsWithoutGuide: undescribedSights(doc, guides, refIndex(payload.tables)).length,
  };
  return (
    <>
      <PageHeader
        back={{ href: `/trips/${id}`, label: doc.trip.title }}
        title="Propozycje AI"
        intro={<>Z lewej plan, z prawej ten sam plan po propozycjach: harmonogram, trasy i przejazdy, mapa, opisy, posiłki, plan B. Punkty zmienione ręcznie zostają nietknięte.</>}
      />
      <ReviewBoard tripId={id} runId={view ? runRow.data!.id : null} view={view} checks={checks} />
    </>
  );
}

/** Bez `?draft=`: wybór szkicu — tylko szkice AI, od najlepiej pasującego nazwą do tego planu, ten wyróżniony. */
async function ChooseDraft({ id, supabase }: { id: string; supabase: Supabase }) {
  const [trip, mine] = await Promise.all([supabase.from("my_trips").select("title").eq("id", id).maybeSingle(), supabase.from("my_trips").select("id, title").neq("id", id).order("start_date")]);
  if (trip.data === null) notFound();
  const title = trip.data.title!;
  const { drafts, best } = draftsForPlan(title, mine.data ?? []);
  return (
    <>
      <PageHeader back={{ href: `/trips/${id}`, label: title }} title="Porównanie ze szkicem" intro={<>Wybierz szkic (np. z „Zaplanuj z AI”) — zobaczysz go obok planu i przeniesiesz punkty.</>} />
      <Link href={`/trips/${id}/compare?review=1`} className="card flex flex-col gap-1 border-dashed p-4 transition hover:-translate-y-0.5 hover:border-sea">
        <span className="font-semibold">Propozycje AI do tego planu</span>
        <span className="text-xs text-zinc-500">przegląd planu: harmonogram, trasy, mapa, opisy — każda zmiana obok planu, do zastosowania osobno</span>
      </Link>
      {drafts.length === 0 ? (
        <p className="card p-5 text-zinc-600 dark:text-zinc-400">Nie masz szkiców do porównania. Szkic powstaje z „Zaplanuj z AI” albo z „Importuj z pliku” na stronie „Nowy wyjazd”.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {drafts.map((other) => (
            <li key={other.id}>
              <Link
                href={`/trips/${id}/compare?draft=${other.id}`}
                className={`card flex h-full flex-col gap-1 p-4 transition hover:-translate-y-0.5 hover:border-sea ${other === best ? "border-2 border-sea" : "border-dashed"}`}
              >
                <span className="font-semibold">{other.title!.slice(DRAFT_PREFIX.length)}</span>
                <span className="text-xs text-zinc-500">{other === best ? (draftNameScore(title, other.title!) === 1 ? "szkic AI tego planu" : "szkic AI — najbardziej pasuje nazwą") : "szkic AI"}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
