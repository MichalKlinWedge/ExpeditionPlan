import type { Metadata } from "next";
import { dayLabel, instantToZoned, type TripDocument } from "@expeditionplan/core";
import { dbLoadError, type PullPayload, refIndex, stateFromPayload } from "@expeditionplan/sync";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { Loading, Shell } from "@/components/shell";
import { requireUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Dziennik — Expedition Planner" };

/**
 * Dziennik wyjazdu: wpisy i zdjęcia z telefonów złożone w relację dzień po dniu. Wpisy powstają
 * w aplikacji (offline, w trasie); tu tylko odczyt. Zdjęcia z prywatnego bucketu `journal` przez
 * podpisane URL-e (ważne godzinę) — zdjęcie, które telefon jeszcze wysyła, ma opis zamiast obrazka.
 */
export default function JournalPage(props: PageProps<"/trips/[id]/journal">) {
  return (
    <Shell>
      <Suspense fallback={<Loading />}>
        <Journal params={props.params} />
      </Suspense>
    </Shell>
  );
}

type Row = { id: string; day_id: string | null; body: string; photo_path: string | null; taken_at: string; created_by: string | null; deleted_at: string | null };
type TravelerRow = { name: string; user_id: string | null; deleted_at: string | null };


async function Journal({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, userId } = await requireUser(`/trips/${id}/journal`);
  const { data, error } = await supabase.rpc("pull_changes", { p_trip: id, p_since: 0 });
  if (error) return <p className="text-sm text-red-600">{dbLoadError(error)}</p>;
  if (data === null) notFound();
  const payload = data as PullPayload;
  let doc: TripDocument;
  try {
    doc = stateFromPayload(payload).doc;
  } catch (e) {
    return <p className="text-sm text-red-600">Plan w bazie nie przechodzi walidacji: {e instanceof Error ? e.message : String(e)}</p>;
  }
  const tables = payload.tables as unknown as Record<string, unknown[] | undefined>;
  const rows = ((tables.journal_entries ?? []) as Row[]).filter((row) => row.deleted_at === null).sort((a, b) => a.taken_at.localeCompare(b.taken_at));
  const travelers = ((tables.travelers ?? []) as TravelerRow[]).filter((row) => row.deleted_at === null);
  const author = (row: Row) => (row.created_by === null ? "uczestnik" : row.created_by === userId ? "ja" : (travelers.find((each) => each.user_id === row.created_by)?.name ?? "uczestnik"));

  const paths = rows.flatMap((row) => (row.photo_path ? [row.photo_path] : []));
  const urls = new Map<string, string>();
  if (paths.length > 0) {
    const { data: signed } = await supabase.storage.from("journal").createSignedUrls(paths, 3600);
    for (const each of signed ?? []) if (each.path && each.signedUrl && !each.error) urls.set(each.path, each.signedUrl);
  }

  const ids = refIndex(payload.tables);
  const groups = [
    ...doc.days.map((day, index) => ({ key: day.ref, title: `Dzień ${index + 1} · ${dayLabel(day.date)}${day.title ? ` — ${day.title}` : ""}`, tz: day.tz, rows: rows.filter((row) => row.day_id === ids[day.ref]) })),
    { key: "none", title: "Bez dnia", tz: doc.trip.primaryTz, rows: rows.filter((row) => row.day_id === null || !doc.days.some((day) => ids[day.ref] === row.day_id)) },
  ].filter((group) => group.rows.length > 0);

  return (
    <>
      <div className="flex flex-col gap-1">
        <Link href={`/trips/${id}`} className="back-link">
          ← {doc.trip.title}
        </Link>
        <h1 className="text-2xl font-semibold">Dziennik</h1>
        <p className="text-sm text-zinc-500">Wpisy i zdjęcia dodaje się w aplikacji na telefonie (zakładka Plan → Dziennik) — także bez internetu.</p>
      </div>
      {groups.length === 0 && <p className="text-sm text-zinc-500">Dziennik jest jeszcze pusty.</p>}
      {groups.map((group) => (
        <section key={group.key} className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{group.title}</h2>
          {group.rows.map((row) => (
            <article key={row.id} className="card flex flex-col gap-2 overflow-hidden">
              {row.photo_path &&
                (urls.has(row.photo_path) ? (
                  // Podpisany URL z bucketu — zwykły <img>, bez optymalizacji Next (adres wygasa).
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={urls.get(row.photo_path)} alt={row.body || "Zdjęcie z wyjazdu"} loading="lazy" className="max-h-[70vh] w-full object-cover" />
                ) : (
                  <p className="px-4 pt-3 text-xs text-zinc-500">📷 Zdjęcie jeszcze się wysyła z telefonu.</p>
                ))}
              <div className="flex flex-col gap-1 px-4 pb-3 first:pt-3">
                {row.body && <p className="whitespace-pre-line">{row.body}</p>}
                <p className="text-xs text-zinc-500">
                  {instantToZoned(Date.parse(row.taken_at), group.tz).time} · {author(row)}
                </p>
              </div>
            </article>
          ))}
        </section>
      ))}
    </>
  );
}
