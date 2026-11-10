import type { Metadata } from "next";
import { Suspense } from "react";

import { ImportTripForm, NewTripForm } from "@/components/forms";
import { Loading, Shell } from "@/components/shell";
import { PageHeader } from "@/components/page-header";
import { NO_CREATE, requireUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Nowy wyjazd — Expedition Planner" };

export default function NewTripPage() {
  return (
    <Shell>
      <PageHeader back={{ href: "/", label: "Wyjazdy" }} title="Nowy wyjazd" />
      <Suspense fallback={<Loading />}>
        <NewTrip />
      </Suspense>
    </Shell>
  );
}

async function NewTrip() {
  const { canCreateTrips } = await requireUser("/trips/new");
  if (!canCreateTrips) return <p className="text-zinc-600 dark:text-zinc-400">{NO_CREATE}</p>;
  return (
    <>
      <NewTripForm />
      <section className="mt-8 flex flex-col gap-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <h2 className="text-lg font-semibold">…albo z pliku</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Plan pobrany przyciskiem „Pobierz JSON” na stronie wyjazdu (np. z lokalnej bazy) trafi tu jako nowy wyjazd.</p>
        <ImportTripForm />
      </section>
    </>
  );
}
