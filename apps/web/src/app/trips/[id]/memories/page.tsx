import type { Metadata } from "next";
import { dayLabel, dayMap, formatKm, formatMoney, guideFor, type GuideRow, memoryTimeline, type TripDocument, tripMemories, walletSummary } from "@expeditionplan/core";
import { dbLoadError, type PullPayload, refIndex, stateFromPayload } from "@expeditionplan/sync";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { MemoriesMap } from "@/components/memories-map";
import { PrintButton } from "@/components/print-button";
import { Settlement } from "@/components/settlement";
import { Loading, Shell } from "@/components/shell";
import { Stat } from "@/components/stat";
import { ApproachMap, DayNode, JournalCard, Node, RouteTrace, TimelineList, timelineAnchors } from "@/components/trip-timeline";
import { requireUser } from "@/lib/auth";
import { tripDates } from "@/lib/labels";

export const metadata: Metadata = { title: "Pamiątka z wyjazdu — Expedition Planner" };

/**
 * Pamiątka z wyjazdu: liczby (punkty, kilometry, wydatki), mapa całej trasy, a pod nią oś czasu z góry na dół —
 * dzień po dniu mapa dnia, najważniejsze punkty ze skrótem opisu i zdjęciem, reszta planu w linijce i wpisy z dziennika
 * w kolejności godzin (`memoryTimeline`) — oraz rozliczenie. Do oglądania i do druku / PDF; na papierze mapy
 * z kafelkami zastępuje sam ślad trasy (płótno MapLibre nie drukuje się).
 */
export default function MemoriesPage(props: PageProps<"/trips/[id]/memories">) {
  return (
    <Shell>
      <Suspense fallback={<Loading />}>
        <Memories params={props.params} />
      </Suspense>
    </Shell>
  );
}

type JournalRow = { id: string; day_id: string | null; item_id: string | null; body: string; photo_path: string | null; taken_at: string; created_by: string | null; deleted_at: string | null };
type TravelerRow = { name: string; user_id: string | null; deleted_at: string | null };
type ExpenseRow = { amount_minor: number; currency: string; category: string | null; deleted_at: string | null };

async function Memories({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, userId } = await requireUser(`/trips/${id}/memories`);
  const { data, error } = await supabase.rpc("pull_changes", { p_trip: id, p_since: 0 });
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
  const entries = ((tables.journal_entries ?? []) as JournalRow[]).filter((row) => row.deleted_at === null).sort((a, b) => a.taken_at.localeCompare(b.taken_at));
  const travelers = ((tables.travelers ?? []) as TravelerRow[]).filter((row) => row.deleted_at === null);
  const expenses = ((tables.expenses ?? []) as ExpenseRow[]).filter((row) => row.deleted_at === null);
  const guides = (tables.audio_guides ?? []) as GuideRow[];
  const author = (row: JournalRow) => travelers.find((each) => each.user_id === row.created_by)?.name ?? (row.created_by === userId ? "ja" : "uczestnik");

  const paths = entries.flatMap((row) => (row.photo_path ? [row.photo_path] : []));
  const urls = new Map<string, string>();
  if (paths.length > 0) {
    const { data: signed } = await supabase.storage.from("journal").createSignedUrls(paths, 3600);
    for (const each of signed ?? []) if (each.path && each.signedUrl && !each.error) urls.set(each.path, each.signedUrl);
  }

  const stats = tripMemories(doc, inputs);
  const map = dayMap(doc, stats.routeRefs);
  const spent = walletSummary(
    doc,
    expenses.map((row) => ({ amountMinor: row.amount_minor, currency: row.currency, ...(row.category ? { category: row.category } : {}) })),
  );
  const money = (minor: number) => formatMoney(minor, spent.currency);
  const ids = refIndex(payload.tables);
  const refOf = new Map(Object.entries(ids).map(([ref, rowId]) => [rowId, ref]));
  const timeline = memoryTimeline(doc, {
    ...inputs,
    guideOf: (item) => {
      if (item.kind === "lodging") return null;
      const placeRef = item.leg?.toPlaceRef ?? item.placeRef;
      return guideFor(guides, ids[item.ref], placeRef === undefined ? undefined : ids[placeRef]);
    },
    journal: entries.map((row) => {
      const dayRef = row.day_id === null ? undefined : refOf.get(row.day_id);
      const itemRef = row.item_id === null ? undefined : refOf.get(row.item_id);
      const photoUrl = row.photo_path ? urls.get(row.photo_path) : undefined;
      return {
        id: row.id,
        body: row.body,
        takenAt: Date.parse(row.taken_at),
        author: author(row),
        ...(dayRef !== undefined ? { dayRef } : {}),
        ...(itemRef !== undefined ? { itemRef } : {}),
        ...(photoUrl !== undefined ? { photoUrl } : {}),
      };
    }),
  });

  return (
    <>
      <div className="flex flex-col gap-1">
        <Link href={`/trips/${id}`} className="back-link print:hidden">
          ← {doc.trip.title}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h1 className="text-3xl font-bold">{doc.trip.title}</h1>
          <span className="print:hidden">
            <PrintButton />
          </span>
        </div>
        <p className="text-sm text-zinc-500">
          {tripDates(doc.trip.startDate, doc.trip.endDate)}
          {travelers.length > 0 && ` · ${travelers.map((each) => each.name).join(", ")}`}
        </p>
      </div>

      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat value={String(stats.days)} label="dni" />
        <Stat value={stats.done > 0 ? `${stats.done} z ${stats.planned}` : String(stats.planned)} label={stats.done > 0 ? "punktów zrobionych" : "punktów w planie"} />
        {stats.footKm > 0 && <Stat value={formatKm(stats.footKm)} label={stats.ascentM > 0 ? `pieszo · ↑ ${stats.ascentM.toLocaleString("pl-PL")} m` : "pieszo"} />}
        {stats.driveKm > 0 && <Stat value={formatKm(stats.driveKm)} label="autem" />}
        {stats.transitKm > 0 && <Stat value={formatKm(stats.transitKm)} label="komunikacją" />}
        {stats.flightKm > 0 && <Stat value={formatKm(stats.flightKm)} label="samolotem" />}
        {entries.length > 0 && <Stat value={String(entries.length)} label={`wpisów w dzienniku · 📷 ${paths.length}`} />}
        {spent.count > 0 && <Stat value={money(spent.spentMinor)} label={travelers.length > 1 ? `wydatki · ${money(Math.round(spent.spentMinor / travelers.length))} na osobę` : "wydatki"} />}
      </section>

      {map.pins.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">Trasa</h2>
          <div className="print:hidden lg:[&>div]:h-96">
            <MemoriesMap map={map} anchors={timelineAnchors(doc, timeline)} />
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
          {timeline.loose.length > 0 && (
            <Node mark="📓">
              <h2 className="text-lg font-semibold">Po powrocie</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {timeline.loose.map((entry) => (
                  <JournalCard key={entry.id} entry={entry} />
                ))}
              </div>
            </Node>
          )}
          <Node mark="■" accent>
            <h2 className="text-lg font-semibold">Powrót · {dayLabel(doc.trip.endDate)}</h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {[
                stats.done > 0 ? `zrobione ${stats.done} z ${stats.planned} punktów` : "",
                stats.footKm > 0 ? `pieszo ${formatKm(stats.footKm)}` : "",
                stats.driveKm > 0 ? `autem ${formatKm(stats.driveKm)}` : "",
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <ApproachMap doc={doc} approach={timeline.back} />
          </Node>
        </TimelineList>
      </section>

      <Settlement doc={doc} tables={payload.tables as unknown as Parameters<typeof Settlement>[0]["tables"]} />
    </>
  );
}
