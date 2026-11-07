import type { Metadata } from "next";
import { dayLabel, type DayMap, dayMap, formatKm, formatMoney, instantToZoned, isRouteStop, itemIcon, itemsForDay, type TripDocument, tripMemories, walletSummary } from "@expeditionplan/core";
import { dbLoadError, type PullPayload, refIndex, stateFromPayload } from "@expeditionplan/sync";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { MemoriesMap } from "@/components/memories-map";
import { PrintButton } from "@/components/print-button";
import { Settlement } from "@/components/settlement";
import { Loading, Shell } from "@/components/shell";
import { Stat } from "@/components/stat";
import { requireUser } from "@/lib/auth";
import { tripDates } from "@/lib/labels";

export const metadata: Metadata = { title: "Pamiątka z wyjazdu — Expedition Planner" };

/**
 * Pamiątka z wyjazdu: liczby (punkty, kilometry, wydatki), mapa trasy, dzień po dniu — co zrobione
 * i wpisy z dziennika ze zdjęciami — oraz rozliczenie. Do oglądania i do druku / PDF; na papierze
 * mapę z kafelkami zastępuje sam ślad trasy (płótno MapLibre nie drukuje się).
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

type JournalRow = { id: string; day_id: string | null; body: string; photo_path: string | null; taken_at: string; created_by: string | null; deleted_at: string | null };
type TravelerRow = { name: string; user_id: string | null; deleted_at: string | null };
type ExpenseRow = { amount_minor: number; currency: string; category: string | null; deleted_at: string | null };


/** Ślad trasy bez kafelków — do druku: linie i pinezki w rzucie z poprawką na szerokość geograficzną. */
function RouteTrace({ map }: { map: DayMap }) {
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
  const scale = Math.min(780 / spanX, 380 / spanY);
  const x = (lng: number) => 10 + (lng - west) * squeeze * scale;
  const y = (lat: number) => 10 + (north - lat) * scale;
  return (
    <svg viewBox={`0 0 800 ${Math.ceil(spanY * scale) + 20}`} className="hidden w-full print:block" role="img" aria-label="Ślad trasy wyjazdu">
      {lines.map((line, index) => (
        <polyline key={index} points={line.map((point) => `${x(point[0]).toFixed(1)},${y(point[1]).toFixed(1)}`).join(" ")} fill="none" stroke="#2E7D74" strokeWidth="2" />
      ))}
      {pins.map((pin) => (
        <circle key={pin.placeRef} cx={x(pin.lng)} cy={y(pin.lat)} r="4" fill="#E2622B" />
      ))}
    </svg>
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
  const done = new Set(inputs.done.map((each) => each.itemRef));
  const skipped = new Set(inputs.skipRefs);
  const options = { activeVariants: inputs.activeVariants, pulled: inputs.pulled };
  const days = [...doc.days].sort((a, b) => a.date.localeCompare(b.date));

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

      {days.map((day, index) => {
        const items = itemsForDay(doc, day.ref, options).filter((item) => item.parentRef === undefined || isRouteStop(doc, item));
        const rows = entries.filter((row) => row.day_id === ids[day.ref]);
        if (items.length === 0 && rows.length === 0) return null;
        return (
          <section key={day.ref} className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold break-after-avoid">
              Dzień {index + 1} · {dayLabel(day.date)}
              {day.title ? ` — ${day.title}` : ""}
            </h2>
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {items.map((item) => (
                <li key={item.ref} className={skipped.has(item.ref) ? "text-zinc-400 line-through" : ""}>
                  {done.has(item.ref) ? "✓" : itemIcon(doc, item)} {item.title}
                </li>
              ))}
            </ul>
            {rows.length > 0 && (
              <div className="grid gap-3 sm:grid-cols-2">
                {rows.map((row) => (
                  <article key={row.id} className="card flex break-inside-avoid flex-col gap-2 overflow-hidden">
                    {row.photo_path && urls.has(row.photo_path) && (
                      // Podpisany URL z bucketu — zwykły <img>, bez optymalizacji Next (adres wygasa). Bez `lazy`: wszystkie mają wejść do PDF-a.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={urls.get(row.photo_path)} alt={row.body || "Zdjęcie z wyjazdu"} className="max-h-96 w-full object-cover" />
                    )}
                    <div className="flex flex-col gap-1 px-4 pb-3 first:pt-3">
                      {row.body && <p className="whitespace-pre-line text-sm">{row.body}</p>}
                      <p className="text-xs text-zinc-500">
                        {instantToZoned(Date.parse(row.taken_at), day.tz).time} · {author(row)}
                      </p>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        );
      })}

      <Settlement doc={doc} tables={payload.tables as unknown as Parameters<typeof Settlement>[0]["tables"]} />
    </>
  );
}
