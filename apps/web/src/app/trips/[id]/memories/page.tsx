import type { Metadata } from "next";
import {
  dayLabel,
  type DayMap,
  dayMap,
  formatKm,
  formatMoney,
  GUIDE_SITE,
  guideFor,
  type GuideRow,
  memoryTimeline,
  type TimelineEntry,
  type TimelineJournal,
  type TimelinePoint,
  type TripDocument,
  tripMemories,
  walletSummary,
} from "@expeditionplan/core";
import { dbLoadError, type PullPayload, refIndex, stateFromPayload } from "@expeditionplan/sync";
import Link from "next/link";
import { notFound } from "next/navigation";
import { type ReactNode, Suspense } from "react";

import { MemoriesMap } from "@/components/memories-map";
import { MemoryDayMap } from "@/components/memory-day-map";
import { PrintButton } from "@/components/print-button";
import { Settlement } from "@/components/settlement";
import { Loading, Shell } from "@/components/shell";
import { Stat } from "@/components/stat";
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

/** Ślad trasy bez kafelków — do druku: linie i pinezki w rzucie z poprawką na szerokość geograficzną. */
function RouteTrace({ map, height = 380 }: { map: DayMap; height?: number }) {
  const lines = map.lines.filter((line) => !line.transit).map((line) => line.coordinates);
  const pins = map.pins.filter((pin) => !pin.transit);
  const points = [...lines.flat(), ...pins.map((pin): [number, number] => [pin.lng, pin.lat])];
  if (points.length < 2) return null;
  const lngs = points.map((point) => point[0]);
  const lats = points.map((point) => point[1]);
  const [west, east, south, north] = [Math.min(...lngs), Math.max(...lngs), Math.min(...lats), Math.max(...lats)];
  const squeeze = Math.cos((((south + north) / 2) * Math.PI) / 180);
  const spanX = Math.max((east - west) * squeeze, 1e-4);
  const spanY = Math.max(north - south, 1e-4);
  const scale = Math.min(780 / spanX, height / spanY);
  const x = (lng: number) => 10 + (lng - west) * squeeze * scale;
  const y = (lat: number) => 10 + (north - lat) * scale;
  return (
    <svg viewBox={`0 0 800 ${Math.ceil(spanY * scale) + 20}`} className="hidden w-full break-inside-avoid print:block" role="img" aria-label="Ślad trasy">
      {lines.map((line, index) => (
        <polyline key={index} points={line.map((point) => `${x(point[0]).toFixed(1)},${y(point[1]).toFixed(1)}`).join(" ")} fill="none" stroke="#2E7D74" strokeWidth="2" />
      ))}
      {pins.map((pin) => (
        <circle key={pin.placeRef} cx={x(pin.lng)} cy={y(pin.lat)} r="4" fill="#E2622B" />
      ))}
    </svg>
  );
}

/** Węzeł osi czasu: kółko na linii po lewej, treść po prawej. */
function Node({ mark, accent = false, children }: { mark: ReactNode; accent?: boolean; children: ReactNode }) {
  return (
    <li className="relative pb-10 pl-10 last:pb-0">
      <span
        className={`absolute top-0 left-0 flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ring-4 ring-[var(--background)] ${accent ? "bg-signal text-white" : "bg-sea text-white"}`}
        aria-hidden
      >
        {mark}
      </span>
      <div className="flex flex-col gap-3">{children}</div>
    </li>
  );
}

function Status({ point }: { point: TimelinePoint }) {
  if (point.status === "done") return <span className="text-sea" title="zrobione">✓</span>;
  if (point.status === "skipped") return <span className="text-xs text-zinc-400">pominięte</span>;
  return null;
}

/** Wpis z dziennika: zdjęcie i tekst. */
function JournalCard({ entry, time, compact = false }: { entry: TimelineJournal; time?: string; compact?: boolean }) {
  const meta = [time, entry.author].filter(Boolean).join(" · ");
  return (
    <article className={`card flex break-inside-avoid flex-col overflow-hidden ${compact ? "" : "border-l-4 border-l-signal"}`}>
      {entry.photoUrl && (
        // Podpisany URL z bucketu — zwykły <img>, bez optymalizacji Next (adres wygasa). Bez `lazy`: wszystkie mają wejść do PDF-a.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={entry.photoUrl} alt={entry.body || "Zdjęcie z wyjazdu"} className={`w-full object-cover ${compact ? "max-h-56" : "max-h-96"}`} />
      )}
      <div className="flex flex-col gap-1 px-4 py-3">
        {entry.body && <p className="whitespace-pre-line text-sm">{entry.body}</p>}
        {meta && <p className="text-xs text-zinc-500">📓 {meta}</p>}
      </div>
    </article>
  );
}

/** Najważniejszy punkt: zdjęcie z opisu miejsca, skrót opisu i wpisy przypięte do punktu. */
function KeyPoint({ point, tripId }: { point: TimelinePoint; tripId: string }) {
  const skipped = point.status === "skipped";
  return (
    <article className={`card flex break-inside-avoid flex-col overflow-hidden sm:flex-row ${skipped ? "opacity-60" : ""}`}>
      {point.image && (
        <figure className="flex shrink-0 flex-col sm:w-56">
          {/* Miniatura z Commons; atrybucja pod zdjęciem. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={point.image.url} alt={point.image.caption} className="h-48 w-full object-cover sm:h-full sm:min-h-40" />
          <figcaption className="px-3 py-1 text-[10px] text-zinc-500">
            <a href={point.image.sourceUrl} target="_blank" rel="noreferrer" className="underline">
              fot. {point.image.credit ?? "Wikimedia Commons"}
            </a>
            {point.image.license ? `, ${point.image.license}` : ""}
          </figcaption>
        </figure>
      )}
      <div className="flex flex-col gap-1 p-4">
        <p className="text-xs font-semibold tracking-wide text-signal uppercase">★ najważniejsze{point.time ? ` · ${point.time}` : ""}</p>
        <h3 className={`text-base font-semibold ${skipped ? "line-through" : ""}`}>
          {point.icon} {point.title} <Status point={point} />
        </h3>
        {point.facts && <p className="text-sm text-zinc-600 dark:text-zinc-400">{point.facts}</p>}
        {point.summary && <p className="text-sm">{point.summary}</p>}
        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
          {point.source && (
            <span>
              Skrót opisu z{" "}
              <a href={point.source.url} target="_blank" rel="noreferrer" className="underline">
                {GUIDE_SITE[point.source.site]}
              </a>
              {point.source.site === "web" ? "" : ", CC BY-SA 4.0"}
            </span>
          )}
          <Link href={`/trips/${tripId}/item/${point.ref}`} className="btn-mini print:hidden">
            karta punktu
          </Link>
        </div>
        {point.journal.length > 0 && (
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {point.journal.map((entry) => (
              <JournalCard key={entry.id} entry={entry} compact />
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

/** Zwykłe punkty (dojazd, posiłek, sprawa) w jednej zwartej liście między dużymi kartami. */
function PlainPoints({ points }: { points: TimelinePoint[] }) {
  return (
    <ul className="flex flex-col gap-0.5 border-l border-dashed border-zinc-300 pl-3 text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
      {points.map((point) => (
        <li key={point.ref} className={point.status === "skipped" ? "text-zinc-400 line-through" : ""}>
          <span className="inline-block w-12 tabular-nums text-zinc-400">{point.time ?? ""}</span>
          {point.icon} {point.title}
          {point.facts ? <span className="text-zinc-400"> · {point.facts}</span> : null} <Status point={point} />
          {point.journal.length > 0 && (
            <div className="my-2 grid gap-2 sm:grid-cols-2">
              {point.journal.map((entry) => (
                <JournalCard key={entry.id} entry={entry} compact />
              ))}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Wpisy dnia po kolei; sąsiednie zwykłe punkty sklejone w jedną listę. */
function DayEntries({ entries, tripId }: { entries: TimelineEntry[]; tripId: string }) {
  const blocks: ({ kind: "plain"; points: TimelinePoint[] } | { kind: "one"; entry: TimelineEntry })[] = [];
  for (const entry of entries) {
    const last = blocks.at(-1);
    if (entry.kind === "point" && !entry.key) {
      if (last?.kind === "plain") last.points.push(entry);
      else blocks.push({ kind: "plain", points: [entry] });
    } else blocks.push({ kind: "one", entry });
  }
  return (
    <>
      {blocks.map((block) =>
        block.kind === "plain" ? (
          <PlainPoints key={`plain:${block.points[0]!.ref}`} points={block.points} />
        ) : block.entry.kind === "point" ? (
          <KeyPoint key={block.entry.ref} point={block.entry} tripId={tripId} />
        ) : (
          <JournalCard key={block.entry.id} entry={block.entry} time={block.entry.time} />
        ),
      )}
    </>
  );
}

async function Memories({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, userId } = await requireUser(`/trips/${id}/memories`);
  const { data, error } = await supabase.rpc("pull_changes", { p_trip: id, p_since: 0 });
  if (error) return <p className="text-sm text-red-600">{dbLoadError(error)}</p>;
  if (data === null) notFound();
  const payload = data as PullPayload;
  let doc: TripDocument;
  let inputs: ReturnType<typeof stateFromPayload>["inputs"];
  try {
    ({ doc, inputs } = stateFromPayload(payload));
  } catch (e) {
    return <p className="text-sm text-red-600">Plan w bazie nie przechodzi walidacji: {e instanceof Error ? e.message : String(e)}</p>;
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
            <MemoriesMap map={map} />
          </div>
          <RouteTrace map={map} />
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Dzień po dniu</h2>
        <ol className="relative before:absolute before:top-4 before:bottom-4 before:left-[15px] before:w-0.5 before:bg-zinc-200 dark:before:bg-zinc-800">
          <Node mark="▶" accent>
            <h2 className="text-lg font-semibold">Wyjazd · {dayLabel(doc.trip.startDate)}</h2>
            {(doc.trip.goal || doc.trip.summary) && <p className="text-sm text-zinc-600 dark:text-zinc-400">{doc.trip.summary ?? doc.trip.goal}</p>}
          </Node>
          {timeline.days.map((day) => {
            const dayPins = dayMap(doc, day.routeRefs);
            const shown = dayPins.pins.some((pin) => !pin.transit) ? dayPins : null;
            if (day.entries.length === 0 && shown === null) return null;
            return (
              <Node key={day.ref} mark={day.no}>
                <div className="flex flex-col gap-0.5 break-after-avoid">
                  <p className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                    Dzień {day.no} · {day.label}
                  </p>
                  {day.title && <h2 className="text-xl font-bold">{day.title}</h2>}
                </div>
                {day.summary && <p className="text-sm text-zinc-600 dark:text-zinc-400">{day.summary}</p>}
                {(day.stats.length > 0 || day.lodging) && (
                  <div className="flex flex-wrap gap-1.5 text-xs">
                    {day.stats.map((stat) => (
                      <span key={stat} className="rounded-full bg-zinc-100 px-2 py-0.5 dark:bg-zinc-800">
                        {stat}
                      </span>
                    ))}
                    {day.lodging && <span className="rounded-full bg-zinc-100 px-2 py-0.5 dark:bg-zinc-800">🛏️ {day.lodging}</span>}
                  </div>
                )}
                {shown && (
                  <>
                    <MemoryDayMap map={shown} />
                    <RouteTrace map={shown} height={220} />
                  </>
                )}
                <DayEntries entries={day.entries} tripId={id} />
              </Node>
            );
          })}
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
          </Node>
        </ol>
      </section>

      <Settlement doc={doc} tables={payload.tables as unknown as Parameters<typeof Settlement>[0]["tables"]} />
    </>
  );
}
