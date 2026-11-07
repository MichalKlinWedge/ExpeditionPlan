import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { AiPlanButton } from "@/components/ai-plan-button";
import { BriefForm, type BriefDraft } from "@/components/brief-form";
import { Loading, Shell } from "@/components/shell";
import { aiAccessError } from "@/lib/ai";
import { requireUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Brief wyjazdu — Expedition Planner" };

/** Kreator briefu wyjazdu (MVP-2) i „Zaplanuj z AI” — gdy brief jest zapisany. */

// Planowanie z AI (akcja serwera na tej stronie) trwa do kilku minut.
export const maxDuration = 300;

export default function BriefPage(props: PageProps<"/trips/[id]/brief">) {
  return (
    <Shell>
      <Suspense fallback={<Loading />}>
        <Brief params={props.params} />
      </Suspense>
    </Shell>
  );
}

async function Brief({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireUser(`/trips/${id}/brief`);
  const [trip, brief, travelers, aiDenied] = await Promise.all([
    supabase.from("my_trips").select("*").eq("id", id).maybeSingle(),
    supabase.from("trip_brief").select("brief").eq("trip_id", id).maybeSingle(),
    supabase.from("travelers").select("id", { count: "exact", head: true }).eq("trip_id", id).is("deleted_at", null),
    aiAccessError(),
  ]);
  if (trip.data === null) notFound();
  const canEdit = trip.data.role === "owner" || trip.data.role === "editor";
  const saved = (brief.data?.brief ?? null) as Partial<BriefDraft> | null;
  const initial: BriefDraft = {
    goal: saved?.goal ?? "",
    location: saved?.location ?? { kind: "city", countries: [], places: [] },
    profiles: saved?.profiles ?? [],
    transport: saved?.transport ?? [],
    budget: saved?.budget ?? { level: "medium", currency: trip.data.base_currency! },
    constraints: {
      pace: "normal",
      noDrivingAfterDark: false,
      diet: [],
      allergies: [],
      accessibility: [],
      notes: [],
      ...saved?.constraints,
    },
    fixed: saved?.fixed ?? [],
    mustSee: saved?.mustSee ?? [],
    avoid: saved?.avoid ?? [],
    notes: saved?.notes ?? [],
  };

  return (
    <>
      <div className="flex flex-col gap-1">
        <Link href={`/trips/${id}`} className="back-link">
          ← {trip.data.title}
        </Link>
        <h1 className="text-2xl font-semibold">Brief wyjazdu</h1>
        <p className="text-sm text-zinc-500">
          Założenia dla AI. Daty ({trip.data.start_date} – {trip.data.end_date}) i uczestnicy pochodzą z wyjazdu.
        </p>
      </div>
      {canEdit && brief.data !== null && (
        <AiPlanButton tripId={id}>
          {aiDenied === null && (
            <p className="text-xs text-zinc-500">
              Na swoim komputerze przez Claude Code:{" "}
              <a href={`/trips/${id}/brief/download`} className="underline hover:text-sea">
                pobierz brief (JSON)
              </a>
              , uruchom <code>npm run plan-ai -- --brief plik.json</code>, a wynik wczytaj przez „Importuj z pliku” na stronie nowego wyjazdu.
            </p>
          )}
        </AiPlanButton>
      )}
      {canEdit ? (
        <BriefForm tripId={id} tripTz={trip.data.primary_tz!} initial={initial} travelers={travelers.count ?? 0} />
      ) : (
        <p className="text-sm">Brief może zmieniać organizator albo edytor wyjazdu.</p>
      )}
    </>
  );
}
