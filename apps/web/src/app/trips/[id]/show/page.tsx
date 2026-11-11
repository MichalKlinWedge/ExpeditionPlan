import type { Metadata } from "next";
import { Suspense } from "react";

import { Loading, Shell } from "@/components/shell";
import { ShowView } from "@/components/show-view";

export const metadata: Metadata = { title: "Film zapowiedź — Expedition Planner" };

/** Nagranie jednej sceny trwa kilka–kilkanaście sekund; szkic tekstu z AI do ok. minuty. */
export const maxDuration = 120;

/**
 * Pokaz z lektorem jako zapowiedź wyjazdu (`core/trip-show.ts`, rodzaj `preview`): czas przyszły, zdjęcia z opisów miejsc.
 * Ogląda każdy uczestnik; tekst lektora i nagrania przygotowuje organizator albo edytor w trybie edycji.
 */
export default function ShowPage(props: PageProps<"/trips/[id]/show">) {
  return (
    <Shell wide>
      <Suspense fallback={<Loading />}>
        <ShowView params={props.params} kind="preview" />
      </Suspense>
    </Shell>
  );
}
