import type { Metadata } from "next";
import { Suspense } from "react";

import { PlanView } from "@/components/plan-view";
import { PublicTripHeader } from "@/components/public-trip-header";
import { Loading, Shell } from "@/components/shell";
import { EXPIRED_LINK, loadPublicTrip } from "@/lib/public-trip";
import { publicShowOn } from "@/lib/trip-show";

/**
 * Publiczny podgląd planu z linku właściciela (`public_trip`) — bez logowania, tylko do odczytu.
 * Dane prywatne (kontakty, ceny, kody rezerwacji, budżet) odfiltrowuje baza, nie ta strona.
 */

// Link prywatny — nie do wyszukiwarek.
export const metadata: Metadata = { title: "Plan wyjazdu — Expedition Planner", robots: { index: false, follow: false } };

export default function PublicPlanPage(props: PageProps<"/p/[token]/plan">) {
  return (
    <Shell wide>
      <Suspense fallback={<Loading />}>
        <PublicPlan params={props.params} searchParams={props.searchParams} />
      </Suspense>
    </Shell>
  );
}

async function PublicPlan({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { token } = await params;
  const { day } = await searchParams;
  const loaded = await loadPublicTrip(token);
  if (loaded === null) return <p className="card p-5 text-zinc-600 dark:text-zinc-400">{EXPIRED_LINK}</p>;
  const { state, ids, tripId, guideOf } = loaded;
  // Plan nie pokazuje podsumowania, celu ani uwag do całego wyjazdu, a ręcznie wpisany tekst bywa z kwotami: nie idą do przeglądarki.
  const doc = { ...state.doc, trip: { ...state.doc.trip, summary: undefined, goal: undefined }, notes: state.doc.notes.filter((note) => note.scope !== "trip") };
  return (
    <>
      <PublicTripHeader token={token} trip={state.doc.trip} active="plan" show={await publicShowOn(token)} />
      <PlanView
        state={{ ...state, doc }}
        tripId={tripId}
        ids={ids}
        canEdit={false}
        itemBase={`/p/${encodeURIComponent(token)}/item/`}
        guided={state.doc.items.flatMap((item) => (guideOf(item) !== null ? [item.ref] : []))}
        guidedOnly
        {...(typeof day === "string" ? { initialDay: day } : {})}
      />
    </>
  );
}
