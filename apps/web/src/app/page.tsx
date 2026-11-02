import Link from "next/link";
import { Suspense } from "react";

import { SamplesButton } from "@/components/forms";
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
          <Link href="/trips/new" className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
            Nowy wyjazd
          </Link>
        )}
      </div>
      {data.length === 0 ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          {canCreateTrips ? "Nie masz jeszcze wyjazdów." : "Nie masz jeszcze dostępu do żadnego wyjazdu. Poproś organizatora o link zaproszenia i otwórz go, będąc zalogowanym."}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
          {data.map((trip) => (
            <li key={trip.id}>
              <Link href={`/trips/${trip.id}`} className="flex items-baseline justify-between gap-4 py-3 hover:opacity-80">
                <span className="font-medium">{trip.title}</span>
                <span className="text-right text-sm text-zinc-500">
                  {tripDates(trip.start_date!, trip.end_date!)} · {ROLE[trip.role!]}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {canCreateTrips && <SamplesButton />}
    </>
  );
}
