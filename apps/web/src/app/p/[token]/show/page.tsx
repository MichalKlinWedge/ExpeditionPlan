import type { Metadata } from "next";
import { Suspense } from "react";

import { PublicTripHeader } from "@/components/public-trip-header";
import { Loading, Shell } from "@/components/shell";
import { ShowPlayer } from "@/components/show-player";
import { tripDates } from "@/lib/labels";
import { EXPIRED_LINK } from "@/lib/public-trip";
import { loadPublicShow } from "@/lib/trip-show";

/**
 * Pokaz z lektorem pod publicznym linkiem: ten sam film co w aplikacji (mapy, zdjęcia, napisy, głos), gdy właściciel się
 * na to zgodził (`public_shares.show`). Bez zgody albo po wyłączeniu linku strona mówi tylko, że pokazu nie ma.
 */

// Link prywatny — nie do wyszukiwarek.
export const metadata: Metadata = { title: "Pokaz z lektorem — Expedition Planner", robots: { index: false, follow: false } };

export default function PublicShowPage(props: PageProps<"/p/[token]/show">) {
  return (
    <Shell wide>
      <Suspense fallback={<Loading />}>
        <PublicShow params={props.params} />
      </Suspense>
    </Shell>
  );
}

async function PublicShow({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const loaded = await loadPublicShow(token);
  if (loaded === null) return <p className="card p-5 text-zinc-600 dark:text-zinc-400">{EXPIRED_LINK} Albo pokazu z lektorem pod nim nie ma.</p>;
  const { doc, credits, player, music } = loaded;
  return (
    <>
      <PublicTripHeader token={token} trip={doc.trip} active="show" show />
      <ShowPlayer scenes={player} credits={credits} {...(music ? { music } : {})} trip={{ title: doc.trip.title, dates: tripDates(doc.trip.startDate, doc.trip.endDate) }} />
    </>
  );
}
