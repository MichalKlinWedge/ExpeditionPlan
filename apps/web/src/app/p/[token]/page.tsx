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
export const metadata: Metadata = { title: "Plan wyjazdu — ExpeditionPlan", robots: { index: false, follow: false } };

export default function PublicPlanPage(props: PageProps<"/p/[token]">) {
  return (
    <Shell wide>
      <Suspense fallback={<Loading />}>
        <PublicPlan params={props.params} />
      </Suspense>
    </Shell>
  );
}

async function PublicPlan({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { data, error } = await (await createClient()).rpc("public_trip", { p_token: token });
  if (error || data === null) {
    return <p className="card p-5 text-zinc-600 dark:text-zinc-400">Ten link do planu wygasł albo właściciel go wyłączył.</p>;
  }
  const payload = data as Parameters<typeof stateFromPayload>[0] & { trip: { id: string } };
  const state = stateFromPayload(payload);
  const trip = state.doc.trip;
  return (
    <>
      <section className="topo flex flex-col gap-2 rounded-2xl px-6 py-6 shadow-md">
        <span className="chip self-start bg-signal! text-white!">Podgląd planu</span>
        <h1 className="text-3xl font-bold text-white">{trip.title}</h1>
        <p className="text-zinc-200">{tripDates(trip.startDate, trip.endDate)} · tylko do odczytu</p>
      </section>
      <PlanView state={state} tripId={payload.trip.id} ids={refIndex(payload.tables)} canEdit={false} />
    </>
  );
}
