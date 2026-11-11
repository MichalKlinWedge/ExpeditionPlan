import type { Metadata } from "next";
import { Suspense } from "react";

import { PublicShowView } from "@/components/public-show-view";
import { Loading, Shell } from "@/components/shell";

/**
 * Film z wyjazdu pod publicznym linkiem, po osobnej zgodzie właściciela (`public_shares.film`). Zdjęcia z dziennika bez
 * podpisów: treść wpisów nie wychodzi pod link (`public_show`).
 */

// Link prywatny — nie do wyszukiwarek.
export const metadata: Metadata = { title: "Film z wyjazdu — Expedition Planner", robots: { index: false, follow: false } };

export default function PublicFilmPage(props: PageProps<"/p/[token]/film">) {
  return (
    <Shell>
      <Suspense fallback={<Loading />}>
        <PublicShowView params={props.params} kind="film" />
      </Suspense>
    </Shell>
  );
}
