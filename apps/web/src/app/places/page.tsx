import type { Metadata } from "next";
import { Suspense } from "react";

import { AllPlacesView } from "@/components/all-places-view";
import { Loading, Shell } from "@/components/shell";
import { PageHeader } from "@/components/page-header";
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
  const { places: shared, memories, visited } = loaded;

  return (
    <>
      <PageHeader
        back={{ href: "/", label: "Wyjazdy" }}
        title="Wszystkie miejsca"
        intro={<>Miejsca ze wszystkich Twoich wyjazdów, bez szkiców AI. Wyjazd przy miejscu otwiera je na stronie „Miejsca” tego wyjazdu. Ocenić „warto / nie warto” można miejsce, w którym już byliście (punkt planu, którego data i godzina minęły); notatkę na przyszłość zawsze. Widzą je uczestnicy wyjazdów z tym miejscem i bierze je pod uwagę „Zaplanuj z AI”.</>}
      />
      {shared.length === 0 ? <p className="text-sm text-zinc-500">Twoje wyjazdy nie mają jeszcze miejsc.</p> : <AllPlacesView places={shared} memories={memories} me={userId} visited={visited} />}
    </>
  );
}
