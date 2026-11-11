import type { Metadata } from "next";
import { Suspense } from "react";

import { PublicShowView } from "@/components/public-show-view";
import { Loading, Shell } from "@/components/shell";

/**
 * Zapowiedź z lektorem pod publicznym linkiem: ten sam film co w aplikacji (mapy, zdjęcia, napisy, głos), gdy właściciel się
 * na to zgodził (`public_shares.show`). Bez zgody albo po wyłączeniu linku strona mówi tylko, że pokazu nie ma.
 */

// Link prywatny — nie do wyszukiwarek.
export const metadata: Metadata = { title: "Film zapowiedź — Expedition Planner", robots: { index: false, follow: false } };

export default function PublicShowPage(props: PageProps<"/p/[token]/show">) {
  return (
    <Shell>
      <Suspense fallback={<Loading />}>
        <PublicShowView params={props.params} kind="preview" />
      </Suspense>
    </Shell>
  );
}
