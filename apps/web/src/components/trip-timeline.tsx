import { type DayMap, dayMap, GUIDE_SITE, type MemoryTimeline, type ShowApproach, type TimelineDay, type TimelineEntry, type TimelineJournal, type TimelinePoint, type TripDocument } from "@expeditionplan/core";
import Link from "next/link";
import type { ReactNode } from "react";

import { MemoryDayMap } from "@/components/memory-day-map";
import { WalkProfile } from "@/components/walk-profile";

/**
 * Oś czasu wyjazdu z `memoryTimeline` (core) — wspólna dla „Pamiątki z wyjazdu” (z dziennikiem i statusami z terenu)
 * i „Osi czasu” (sam plan w wariantach z widoku planu): węzły na pionowej linii, dzień z mapą, najważniejsze punkty
 * ze zdjęciem i skrótem opisu, reszta w linijce. Mapy MapLibre nie drukują się — na papierze zastępuje je `RouteTrace`.
 */

/** Ślad trasy bez kafelków — do druku: linie i pinezki w rzucie z poprawką na szerokość geograficzną. */
export function RouteTrace({ map, height = 380 }: { map: DayMap; height?: number }) {
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

/** Mapa dojazdu albo powrotu: cała, z lotem i lotniskiem w domu (tu dojazd jest tematem, nie tło). */
function approachMap(map: DayMap): DayMap {
  return { ...map, lines: map.lines.map((line) => ({ ...line, transit: false })), pins: map.pins.map((pin) => ({ ...pin, transit: false })) };
}

/** Początek i koniec osi: karta „Dojazd” / „Powrót” z trasą i jej mapą. */
export function ApproachMap({ doc, approach }: { doc: TripDocument; approach: ShowApproach | undefined }) {
  if (approach === undefined) return null;
  const map = approachMap(dayMap(doc, approach.refs));
  if (map.pins.length === 0) return null;
  return (
    <>
      <p className="text-sm">
        <span className="font-semibold">{approach.label}:</span> {approach.title}
        {approach.facts && <span className="text-zinc-500"> · {approach.facts}</span>}
      </p>
      <MemoryDayMap map={map} />
      <RouteTrace map={map} height={220} />
    </>
  );
}

/** Węzeł osi czasu: kółko na linii po lewej, treść po prawej. */
export function Node({ id, mark, accent = false, children }: { id?: string; mark: ReactNode; accent?: boolean; children: ReactNode }) {
  return (
    <li id={id} className="relative scroll-mt-28 pb-10 pl-10 last:pb-0">
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
export function JournalCard({ entry, time, compact = false }: { entry: TimelineJournal; time?: string; compact?: boolean }) {
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

/** Trekking na karcie punktu: mapa samej trasy (ślad GPX albo trasa po drogach) i profil wysokości, gdy ślad go ma. */
function WalkSection({ point, doc }: { point: TimelinePoint; doc: TripDocument }) {
  const walk = point.walk;
  if (walk === undefined) return null;
  const route = dayMap(doc, [point.ref]);
  const mapped = route.lines.some((line) => line.track || line.routed);
  if (!mapped && walk.profile === undefined) return null;
  return (
    <div className={`grid gap-3 ${mapped && walk.profile ? "sm:grid-cols-[minmax(0,18rem)_1fr] sm:items-center" : ""}`}>
      {mapped && (
        <div className={walk.profile ? "" : "sm:max-w-sm"}>
          <MemoryDayMap map={route} square />
          <RouteTrace map={route} height={260} />
        </div>
      )}
      {walk.profile && walk.minEle !== undefined && walk.maxEle !== undefined && (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-semibold text-zinc-500">Profil wysokości</p>
          <WalkProfile profile={walk.profile} minEle={walk.minEle} maxEle={walk.maxEle} />
        </div>
      )}
    </div>
  );
}

/** Najważniejszy punkt: zdjęcie z opisu miejsca, skrót opisu, trasa trekkingu z profilem i wpisy przypięte do punktu. */
function KeyPoint({ point, tripId, doc }: { point: TimelinePoint; tripId: string; doc: TripDocument }) {
  const skipped = point.status === "skipped";
  return (
    <article id={pointAnchor(point.ref)} className={`card flex scroll-mt-28 break-inside-avoid flex-col overflow-hidden transition sm:flex-row ${skipped ? "opacity-60" : ""}`}>
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
      <div className="flex min-w-0 flex-1 flex-col gap-1 p-4">
        <p className="text-xs font-semibold tracking-wide text-signal uppercase">{point.walk ? "⛰ trasa" : "★ najważniejsze"}{point.time ? ` · ${point.time}` : ""}</p>
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
        <WalkSection point={point} doc={doc} />
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
        <li key={point.ref} id={pointAnchor(point.ref)} className={`scroll-mt-28 rounded ${point.status === "skipped" ? "text-zinc-400 line-through" : ""}`}>
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
function DayEntries({ entries, tripId, doc }: { entries: TimelineEntry[]; tripId: string; doc: TripDocument }) {
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
          <KeyPoint key={block.entry.ref} point={block.entry} tripId={tripId} doc={doc} />
        ) : (
          <JournalCard key={block.entry.id} entry={block.entry} time={block.entry.time} />
        ),
      )}
    </>
  );
}

/** Dzień na osi: nagłówek, opis, liczby i nocleg, mapa dnia i punkty z wpisami. Pusty dzień bez mapy — nic. */
export function DayNode({ day, doc, tripId }: { day: TimelineDay; doc: TripDocument; tripId: string }) {
  const dayPins = dayMap(doc, day.routeRefs);
  const shown = dayPins.pins.some((pin) => !pin.transit) ? dayPins : null;
  if (day.entries.length === 0 && shown === null) return null;
  return (
    <Node id={dayAnchor(day.ref)} mark={day.no}>
      <div className="flex flex-col gap-0.5 break-after-avoid">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
            Dzień {day.no} · {day.label}
          </p>
          {/* Szczegóły dnia w planie (ten sam dzień wybrany w widoku planu). */}
          <Link href={`/trips/${tripId}/plan?day=${encodeURIComponent(day.ref)}`} className="btn-mini print:hidden">
            plan dnia
          </Link>
        </div>
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
      <DayEntries entries={day.entries} tripId={tripId} doc={doc} />
    </Node>
  );
}

const pointAnchor = (ref: string) => `punkt-${ref}`;
const dayAnchor = (ref: string) => `dzien-${ref}`;

/**
 * Kotwice dla mapy całej trasy (`MemoriesMap anchors`): numer na mapie prowadzi do punktu na osi, a punkt bez własnego
 * wiersza (nocleg, podpunkt) albo dzień bez punktów — do swojego dnia.
 */
export function timelineAnchors(doc: TripDocument, timeline: MemoryTimeline): Record<string, string> {
  const shown = new Set(timeline.days.flatMap((day) => day.entries.flatMap((entry) => (entry.kind === "point" ? [entry.ref] : []))));
  const days = new Set(timeline.days.map((day) => day.ref));
  return Object.fromEntries(
    doc.items.flatMap((item) => (shown.has(item.ref) ? [[item.ref, pointAnchor(item.ref)]] : item.dayRef !== undefined && days.has(item.dayRef) ? [[item.ref, dayAnchor(item.dayRef)]] : [])),
  );
}

/** Pionowa linia osi; węzły to `Node` i `DayNode`. */
export function TimelineList({ children }: { children: ReactNode }) {
  return <ol className="relative before:absolute before:top-4 before:bottom-4 before:left-[15px] before:w-0.5 before:bg-zinc-200 dark:before:bg-zinc-800">{children}</ol>;
}
