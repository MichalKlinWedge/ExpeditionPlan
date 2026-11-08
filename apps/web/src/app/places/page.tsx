import { localToday } from "@expeditionplan/core";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { AllPlacesView } from "@/components/all-places-view";
import { Loading, Shell } from "@/components/shell";
import { requireUser } from "@/lib/auth";
import { loadPlacesAcross } from "@/lib/places-across";

/**
 * Miejsca ze wszystkich moich wyjazdów, bez szkiców AI. Plan poprawia się na stronie „Miejsca” wyjazdu; tutaj
 * jest pamięć miejsc między wyjazdami: ocena każdego uczestnika, notatka na przyszłość i lata wizyt.
 */

export const metadata: Metadata = { title: "Wszystkie miejsca — Expedition Planner" };

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
  const { supabase, userId } = await requireUser("/places");
  let loaded;
  try {
    loaded = await loadPlacesAcross(supabase);
  } catch (e) {
    return <p className="text-sm text-red-600">{e instanceof Error ? e.message : String(e)}</p>;
  }
  const { places: shared, memories } = loaded;

  return (
    <>
      <div className="flex flex-col gap-1">
        <Link href="/" className="back-link">
          ← Wyjazdy
        </Link>
        <h1 className="text-2xl font-semibold">Wszystkie miejsca</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Miejsca ze wszystkich Twoich wyjazdów, bez szkiców AI. Wyjazd przy miejscu otwiera je na stronie „Miejsca” tego wyjazdu. Ocenę „warto / nie warto” i notatkę na przyszłość widzą uczestnicy wyjazdów z tym miejscem; bierze je pod uwagę także „Zaplanuj z AI”.</p>
      </div>
      {shared.length === 0 ? <p className="text-sm text-zinc-500">Twoje wyjazdy nie mają jeszcze miejsc.</p> : <AllPlacesView places={shared} memories={memories} me={userId} today={localToday()} />}
    </>
  );
}
