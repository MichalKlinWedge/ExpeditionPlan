import type { Metadata } from "next";
import { Suspense } from "react";

import { Loading, Shell } from "@/components/shell";
import { ShowView } from "@/components/show-view";

export const metadata: Metadata = { title: "Film z wyjazdu — Expedition Planner" };

/** Nagranie jednej sceny trwa kilka–kilkanaście sekund; szkic tekstu z AI do ok. minuty. */
export const maxDuration = 120;

/**
 * Film z wyjazdu (`core/trip-show.ts`, rodzaj `film`): ten sam pokaz z lektorem co zapowiedź, ale po powrocie —
 * czas przeszły, zdjęcia i wpisy z dziennika na pierwszym planie, własny tekst, głos, nagrania i podkład.
 */
export default function FilmPage(props: PageProps<"/trips/[id]/film">) {
  return (
    <Shell>
      <Suspense fallback={<Loading />}>
        <ShowView params={props.params} kind="film" />
      </Suspense>
    </Shell>
  );
}
