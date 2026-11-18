import type { Metadata } from "next";
import { activeVariants, dayLabel, dayMap, formatKm, guideFor, type GuideRow, memoryTimeline, type TripDocument, tripMemories } from "@expeditionplan/core";
import { dbLoadError, type PullPayload, refIndex, stateFromPayload } from "@expeditionplan/sync";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { MemoriesMap } from "@/components/memories-map";
import { PageHeader } from "@/components/page-header";
import { PrintButton } from "@/components/print-button";
import { Loading, Shell } from "@/components/shell";
import { Stat } from "@/components/stat";
import { ApproachMap, DayNode, Node, RouteTrace, TimelineList } from "@/components/trip-timeline";
import { requireUser } from "@/lib/auth";
import { tripDates } from "@/lib/labels";
import { chosenVariantsFromCookie } from "@/lib/plan-variants-server";

export const metadata: Metadata = { title: "Oś czasu — Expedition Planner" };

/**
 * Oś czasu: cały plan jedną długą listą z góry na dół, jak „Pamiątka z wyjazdu”, ale bez dziennika i rozliczeń —
 * mapa dojazdu, dzień po dniu mapa dnia z godzinami z silnika, najważniejsze atrakcje ze zdjęciem i skrótem opisu
 * miejsca, reszta planu w linijce, mapa powrotu (`memoryTimeline` z pustym dziennikiem). Warianty te same co w widoku
 * planu (ciasteczko `saveChosenVariants` na wybranych w terenie i w planie). Do oglądania i do druku / PDF.
 */
export default function TimelinePage(props: PageProps<"/trips/[id]/timeline">) {
  return (
    <Shell>
      <Suspense fallback={<Loading />}>
        <Timeline params={props.params} />
      </Suspense>
    </Shell>
  );
}

/** Wybrane warianty planu („tytuł grupy: wariant”) — bez porównań rezerwacji i ankiet, które planu nie zmieniają. */
function variantLines(doc: TripDocument, chosen: Record<string, string>): string[] {
  const active = activeVariants(doc, chosen);
  return doc.variantGroups
    .filter((group) => group.scope !== "booking" && group.scope !== "poll")
    .flatMap((group) => {
      const variant = doc.variants.find((each) => each.groupRef === group.ref && active.has(each.ref));
      return variant === undefined ? [] : [`${group.title}: ${variant.label}`];
    });
}

async function Timeline({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireUser(`/trips/${id}/timeline`);
  const [{ data, error }, chosen] = await Promise.all([supabase.rpc("pull_changes", { p_trip: id, p_since: 0 }), chosenVariantsFromCookie(id)]);
  if (error) return <p className="text-sm msg-error">{dbLoadError(error)}</p>;
  if (data === null) notFound();
  const payload = data as PullPayload;
  let doc: TripDocument;
  let inputs: ReturnType<typeof stateFromPayload>["inputs"];
  try {
    ({ doc, inputs } = stateFromPayload(payload));
  } catch (e) {
    return <p className="text-sm msg-error">Plan w bazie nie przechodzi walidacji: {e instanceof Error ? e.message : String(e)}</p>;
  }
  const tables = payload.tables as unknown as Record<string, unknown[] | undefined>;
  const guides = (tables.audio_guides ?? []) as GuideRow[];
  const ids = refIndex(payload.tables);
  // Jak w widoku planu: wybory z terenu, na nich wybrane w planie (ciasteczko).
  const field = { ...inputs, activeVariants: { ...inputs.activeVariants, ...chosen } };
  const stats = tripMemories(doc, field);
  const map = dayMap(doc, stats.routeRefs);
  const timeline = memoryTimeline(doc, {
    ...field,
    guideOf: (item) => {
      if (item.kind === "lodging") return null;
      const placeRef = item.leg?.toPlaceRef ?? item.placeRef;
      return guideFor(guides, ids[item.ref], placeRef === undefined ? undefined : ids[placeRef]);
    },
    journal: [],
  });
  const variants = variantLines(doc, field.activeVariants);

  if (doc.days.length === 0) {
    return (
      <>
        <PageHeader back={{ href: `/trips/${id}`, label: doc.trip.title }} title="Oś czasu" />
        <p className="text-sm text-zinc-500">Plan nie ma jeszcze dni.</p>
      </>
    );
  }

  return (
    <>
      <PageHeader
        back={{ href: `/trips/${id}`, label: doc.trip.title }}
        title="Oś czasu"
        actions={<PrintButton />}
        intro={`${tripDates(doc.trip.startDate, doc.trip.endDate)} · cały plan dzień po dniu: mapy, godziny i najważniejsze atrakcje ze zdjęciem i krótkim opisem.`}>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
          <span className="text-sm">Warianty jak w widoku planu{variants.length > 0 ? ":" : "."}</span>
          {variants.map((line) => (
            <span key={line} className="rounded-full bg-zinc-100 px-2 py-0.5 dark:bg-zinc-800">
              {line}
            </span>
          ))}
          <Link href={`/trips/${id}/plan`} className="btn-mini print:hidden">
            zmień w planie
          </Link>
        </div>
      </PageHeader>

      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat value={String(stats.days)} label="dni" />
        <Stat value={String(stats.planned - stats.skipped)} label="punktów w planie" />
        {stats.footKm > 0 && <Stat value={formatKm(stats.footKm)} label={stats.ascentM > 0 ? `pieszo · ↑ ${stats.ascentM.toLocaleString("pl-PL")} m` : "pieszo"} />}
        {stats.driveKm > 0 && <Stat value={formatKm(stats.driveKm)} label="autem" />}
        {stats.transitKm > 0 && <Stat value={formatKm(stats.transitKm)} label="komunikacją" />}
        {stats.flightKm > 0 && <Stat value={formatKm(stats.flightKm)} label="samolotem" />}
      </section>

      {map.pins.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">Trasa</h2>
          <div className="print:hidden lg:[&>div]:h-96">
            <MemoriesMap map={map} />
          </div>
          <RouteTrace map={map} />
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Dzień po dniu</h2>
        <TimelineList>
          <Node mark="▶" accent>
            <h2 className="text-lg font-semibold">Wyjazd · {dayLabel(doc.trip.startDate)}</h2>
            {(doc.trip.goal || doc.trip.summary) && <p className="text-sm text-zinc-600 dark:text-zinc-400">{doc.trip.summary ?? doc.trip.goal}</p>}
            <ApproachMap doc={doc} approach={timeline.outbound} />
          </Node>
          {timeline.days.map((day) => (
            <DayNode key={day.ref} day={day} doc={doc} tripId={id} />
          ))}
          <Node mark="■" accent>
            <h2 className="text-lg font-semibold">Powrót · {dayLabel(doc.trip.endDate)}</h2>
            <ApproachMap doc={doc} approach={timeline.back} />
          </Node>
        </TimelineList>
      </section>
    </>
  );
}
