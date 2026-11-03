import Link from "next/link";
import { Suspense } from "react";

import { PeakIcon, PlusIcon } from "@/components/icons";
import { Loading, Shell } from "@/components/shell";
import { requireUser } from "@/lib/auth";
import { ROLE, tripDates } from "@/lib/labels";

/**
 * Lista moich wyjazdów z moją rolą (widok `my_trips`). „Nowy wyjazd” i przykłady tylko dla kont,
 * które mogą zakładać wyjazdy; konto bez zaproszenia dostaje informację, jak wejść do planu.
 */
export default function Home() {
  return (
    <Shell>
      <Suspense fallback={<Loading />}>
        <TripList />
      </Suspense>
    </Shell>
  );
}

async function TripList() {
  const { supabase, canCreateTrips } = await requireUser("/");
  const { data, error } = await supabase.from("my_trips").select("*").order("start_date");
  if (error) return <p className="text-sm text-red-600">{error.message}</p>;
  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Wyjazdy</h1>
        {canCreateTrips && (
          <Link href="/trips/new" className="btn-primary">
            <PlusIcon className="size-4" />
            Nowy wyjazd
          </Link>
        )}
      </div>
      {data.length === 0 ? (
        <div className="card flex flex-col items-center gap-3 px-6 py-10 text-center">
          <PeakIcon className="size-10 text-sea" />
          <p className="max-w-md text-zinc-600 dark:text-zinc-400">
            {canCreateTrips ? "Nie masz jeszcze wyjazdów — zacznij od nowego." : "Nie masz jeszcze dostępu do żadnego wyjazdu. Poproś organizatora o link zaproszenia i otwórz go, będąc zalogowanym."}
          </p>
          <Link href="/help" className="text-sm text-sea underline">
            Jak korzystać z aplikacji
          </Link>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {data.map((trip) => {
            const draft = trip.title!.startsWith(DRAFT);
            return (
              <li key={trip.id}>
                <Link
                  href={`/trips/${trip.id}`}
                  className={`card group flex h-full flex-col gap-2 p-4 transition hover:-translate-y-0.5 hover:border-sea ${draft ? "border-dashed" : ""}`}>
                  <span className="flex items-start justify-between gap-3">
                    <span className="font-display text-lg leading-snug font-semibold group-hover:text-sea">{draft ? trip.title!.slice(DRAFT.length) : trip.title}</span>
                    {draft ? <span className="chip shrink-0">szkic AI</span> : <Countdown start={trip.start_date!} end={trip.end_date!} />}
                  </span>
                  <span className="mt-auto text-sm text-zinc-500">
                    {tripDates(trip.start_date!, trip.end_date!)} · {ROLE[trip.role!]}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

const DRAFT = "Szkic AI: ";

/** „za 54 dni” / „trwa” / „za nami” — data dzisiejsza w strefie przeglądarki nie jest potrzebna, wystarczy dzień. */
function Countdown({ start, end }: { start: string; end: string }) {
  const today = new Date().toISOString().slice(0, 10);
  const days = Math.round((Date.parse(start) - Date.parse(today)) / 86_400_000);
  const label = today > end ? "za nami" : days <= 0 ? "trwa" : days === 1 ? "jutro" : `za ${days} dni`;
  const tone = today > end ? "bg-zinc-100 text-zinc-500 dark:bg-zinc-800" : days <= 0 ? "bg-signal text-white" : "";
  return <span className={`chip shrink-0 ${tone}`}>{label}</span>;
}
