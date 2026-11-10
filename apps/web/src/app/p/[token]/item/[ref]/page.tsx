import { dayLabel, guideFor, guideLinkTargets, type GuideRow, ITEM_KIND, itemIcon, itemKindLabel } from "@expeditionplan/core";
import { type PullPayload, refIndex, stateFromPayload } from "@expeditionplan/sync";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { GuideArticle } from "@/components/guide-article";
import { Loading, Shell } from "@/components/shell";
import { PageHeader } from "@/components/page-header";
import { createClient } from "@/lib/supabase/server";

/**
 * Opis punktu z publicznego linku (`public_trip`), bez logowania. Tylko nazwa, miejsce i przewodnik:
 * notatki, linki i rezerwacje zostają na karcie punktu dla uczestników.
 */

// Link prywatny — nie do wyszukiwarek.
export const metadata: Metadata = { title: "Opis punktu — Expedition Planner", robots: { index: false, follow: false } };

export default function PublicItemPage(props: PageProps<"/p/[token]/item/[ref]">) {
  return (
    <Shell>
      <Suspense fallback={<Loading />}>
        <PublicItem params={props.params} />
      </Suspense>
    </Shell>
  );
}


async function PublicItem({ params }: { params: Promise<{ token: string; ref: string }> }) {
  const { token, ref: rawRef } = await params;
  const ref = decodeURIComponent(rawRef);
  const { data, error } = await (await createClient()).rpc("public_trip", { p_token: token });
  if (error || data === null) {
    return <p className="card p-5 text-zinc-600 dark:text-zinc-400">Ten link do planu wygasł albo organizator go wyłączył.</p>;
  }
  const payload = data as PullPayload;
  const doc = stateFromPayload(payload).doc;
  const item = doc.items.find((each) => each.ref === ref);
  if (item === undefined) notFound();
  const ids = refIndex(payload.tables);
  const rows = (payload.tables as unknown as { audio_guides?: GuideRow[] }).audio_guides ?? [];
  const placeRef = item.leg?.toPlaceRef ?? item.placeRef;
  const guide = item.kind === "lodging" ? null : guideFor(rows, ids[item.ref], placeRef === undefined ? undefined : ids[placeRef]);
  const place = placeRef === undefined ? undefined : doc.places.find((each) => each.ref === placeRef);
  const dayIndex = doc.days.findIndex((day) => day.ref === item.dayRef);
  const day = doc.days[dayIndex];
  return (
    <>
      <PageHeader
        back={{ href: `/p/${encodeURIComponent(token)}/plan?day=${encodeURIComponent(item.dayRef ?? "pool")}`, label: `Plan: ${doc.trip.title}` }}
        title={
          <>
            <span aria-hidden="true">{itemIcon(doc, item)}</span>
            {item.title}
          </>
        }
        intro={
          <>
            {itemKindLabel(item, ITEM_KIND)}
            {day ? ` · Dzień ${dayIndex + 1}, ${dayLabel(day.date)}` : " · w puli (poza dniami)"}
            {place ? ` · ${place.name}` : ""}
          </>
        }
      />
      {guide === null ? (
        <p className="text-sm text-zinc-500">Ten punkt nie ma opisu.</p>
      ) : (
        <GuideArticle guide={guide} title={guide.title} heading="Opis miejsca" targets={guideLinkTargets(doc, rows, ids, item.ref)} itemBase={`/p/${encodeURIComponent(token)}/item/`} />
      )}
    </>
  );
}
