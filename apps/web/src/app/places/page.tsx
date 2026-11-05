import { isDraft, placesAcrossTrips } from "@expeditionplan/core";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { AllPlacesView } from "@/components/all-places-view";
import { Loading, Shell } from "@/components/shell";
import { requireUser } from "@/lib/auth";

/** Miejsca ze wszystkich moich wyjazdów, bez szkiców AI. Tylko do przeglądania: poprawia się je na stronie „Miejsca” wyjazdu. */

export const metadata: Metadata = { title: "Wszystkie miejsca — Expedition Planner" };

/** Tyle wierszy naraz oddaje baza (`max_rows`), więc listę czytamy stronami. */
const PAGE = 1000;

async function allRows<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (;;) {
    const { data, error } = await page(rows.length, rows.length + PAGE - 1);
    if (error !== null) throw new Error(error.message);
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE) return rows;
  }
}

export default function AllPlacesPage() {
  return (
    <Shell>
      <Suspense fallback={<Loading />}>
        <View />
      </Suspense>
    </Shell>
  );
}

async function View() {
  const { supabase } = await requireUser("/places");
  const { data: mine, error } = await supabase.from("my_trips").select("id, title, start_date").order("start_date", { ascending: false });
  if (error) return <p className="text-sm text-red-600">{error.message}</p>;
  const trips = mine.filter((trip) => !isDraft(trip)).map((trip) => ({ id: trip.id!, title: trip.title! }));
  const ids = trips.map((trip) => trip.id);

  let shared;
  try {
    const [places, items, guides] = await Promise.all([
      allRows((from, to) => supabase.from("places").select("id, trip_id, ref, name, address, lat, lng").in("trip_id", ids).is("deleted_at", null).order("id").range(from, to)),
      allRows((from, to) => supabase.from("items").select("id, trip_id, kind, place_id, leg").in("trip_id", ids).is("deleted_at", null).order("id").range(from, to)),
      allRows((from, to) => supabase.from("audio_guides").select("id, place_id, item_id, audience").in("trip_id", ids).is("deleted_at", null).order("id").range(from, to)),
    ]);
    shared = placesAcrossTrips({ trips, places, items, guides });
  } catch (e) {
    return <p className="text-sm text-red-600">{e instanceof Error ? e.message : String(e)}</p>;
  }

  return (
    <>
      <div className="flex flex-col gap-1">
        <Link href="/" className="back-link">
          ← Wyjazdy
        </Link>
        <h1 className="text-2xl font-semibold">Wszystkie miejsca</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Miejsca ze wszystkich Twoich wyjazdów, bez szkiców AI. Wyjazd przy miejscu otwiera je na stronie „Miejsca” tego wyjazdu.</p>
      </div>
      {shared.length === 0 ? <p className="text-sm text-zinc-500">Twoje wyjazdy nie mają jeszcze miejsc.</p> : <AllPlacesView places={shared} />}
    </>
  );
}
