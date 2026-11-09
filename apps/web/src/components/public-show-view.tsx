import type { ShowKind } from "@expeditionplan/core";

import { PublicTripHeader } from "@/components/public-trip-header";
import { ShowPlayer } from "@/components/show-player";
import { tripDates } from "@/lib/labels";
import { EXPIRED_LINK } from "@/lib/public-trip";
import { SHOW_PAGES } from "@/lib/show-pages";
import { loadPublicShow, publicShowsOn } from "@/lib/trip-show";

/** Pokaz z lektorem danego rodzaju pod publicznym linkiem (`/p/[token]/show` zapowiedź, `/p/[token]/film` film). */
export async function PublicShowView({ params, kind }: { params: Promise<{ token: string }>; kind: ShowKind }) {
  const { token } = await params;
  const [loaded, on] = await Promise.all([loadPublicShow(token, kind), publicShowsOn(token)]);
  if (loaded === null) return <p className="card p-5 text-zinc-600 dark:text-zinc-400">{EXPIRED_LINK} Albo tego pokazu pod nim nie ma.</p>;
  const { doc, credits, player, music } = loaded;
  return (
    <>
      <PublicTripHeader token={token} trip={doc.trip} active={kind === "film" ? "film" : "show"} shows={on} />
      <ShowPlayer scenes={player} credits={credits} {...(music ? { music } : {})} trip={{ title: doc.trip.title, dates: tripDates(doc.trip.startDate, doc.trip.endDate), label: SHOW_PAGES[kind].label }} />
    </>
  );
}
