import { guideFor, type GuideRow } from "@expeditionplan/core";
import { refIndex, stateFromPayload } from "@expeditionplan/sync";
import type { Metadata } from "next";
import { Suspense } from "react";

import { PlanView } from "@/components/plan-view";
import { Loading, Shell } from "@/components/shell";
import { tripDates } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";

/**
 * Publiczny podgląd planu z linku właściciela (`public_trip`) — bez logowania, tylko do odczytu.
 * Dane prywatne (kontakty, ceny, kody rezerwacji, budżet) odfiltrowuje baza, nie ta strona.
 */

// Link prywatny — nie do wyszukiwarek.
export const metadata: Metadata = { title: "Plan wyjazdu — Expedition Planner", robots: { index: false, follow: false } };

export default function PublicPlanPage(props: PageProps<"/p/[token]">) {
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
  const { data, error } = await (await createClient()).rpc("public_trip", { p_token: token });
  if (error || data === null) {
    return <p className="card p-5 text-zinc-600 dark:text-zinc-400">Ten link do planu wygasł albo właściciel go wyłączył.</p>;
  }
  const payload = data as Parameters<typeof stateFromPayload>[0] & { trip: { id: string } };
  const state = stateFromPayload(payload);
  const trip = state.doc.trip;
  const ids = refIndex(payload.tables);
  const rows = (payload.tables as unknown as { audio_guides?: GuideRow[] }).audio_guides ?? [];
  const guided = state.doc.items.flatMap((item) => {
    const placeRef = item.leg?.toPlaceRef ?? item.placeRef;
    return item.kind !== "lodging" && guideFor(rows, ids[item.ref], placeRef === undefined ? undefined : ids[placeRef]) !== null ? [item.ref] : [];
  });
  return (
    <>
      <section className="topo flex flex-col gap-2 rounded-2xl px-6 py-6 shadow-md">
        <span className="chip self-start bg-signal! text-white!">Podgląd planu</span>
        <h1 className="text-3xl font-bold text-white">{trip.title}</h1>
        <p className="text-zinc-200">{tripDates(trip.startDate, trip.endDate)} · tylko do odczytu</p>
      </section>
      <PlanView
        state={state}
        tripId={payload.trip.id}
        ids={ids}
        canEdit={false}
        itemBase={`/p/${encodeURIComponent(token)}/item/`}
        guided={guided}
        guidedOnly
        {...(typeof day === "string" ? { initialDay: day } : {})}
      />
    </>
  );
}
