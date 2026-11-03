import { flightLine, flightOf, GUIDE_SITE, guideLinkTargets, type GuideRow, guideFor, guideRowFor, type GuideSegment, itemIcon, linkGuideText, legLabel, type TripDocument } from "@expeditionplan/core";
import { refIndex, stateFromPayload } from "@expeditionplan/sync";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { GuideButtons } from "@/components/guide-button";
import { Loading, Shell } from "@/components/shell";
import { requireUser } from "@/lib/auth";
import { ITEM_KIND } from "@/lib/labels";

/**
 * Karta punktu planu: wszystko o punkcie (kiedy, gdzie, opis, notatki, linki, rezerwacja) i przewodnik
 * po miejscu — opis, ciekawostki, historia i zdjęcia z Wikipedii/Commons z atrybucją (M8, etap 1).
 */
export default function ItemPage(props: PageProps<"/trips/[id]/item/[ref]">) {
  return (
    <Shell>
      <Suspense fallback={<Loading />}>
        <ItemCard params={props.params} />
      </Suspense>
    </Shell>
  );
}

const weekday = (date: string) =>
  new Intl.DateTimeFormat("pl-PL", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`)).replace(/^./, (first) => first.toUpperCase());

async function ItemCard({ params }: { params: Promise<{ id: string; ref: string }> }) {
  const { id, ref: rawRef } = await params;
  const ref = decodeURIComponent(rawRef);
  const { supabase } = await requireUser(`/trips/${id}/item/${rawRef}`);
  const [{ data, error }, membership] = await Promise.all([
    supabase.rpc("pull_changes", { p_trip: id, p_since: 0 }),
    supabase.from("my_trips").select("role").eq("id", id).maybeSingle(),
  ]);
  if (error) return <p className="text-sm text-red-600">{error.message}</p>;
  if (data === null) notFound();
  const payload = data as Parameters<typeof stateFromPayload>[0];
  let doc: TripDocument;
  try {
    doc = stateFromPayload(payload).doc;
  } catch (e) {
    return <p className="text-sm text-red-600">Plan w bazie nie przechodzi walidacji: {e instanceof Error ? e.message : String(e)}</p>;
  }
  const item = doc.items.find((each) => each.ref === ref);
  if (item === undefined) notFound();
  const canEdit = membership.data?.role === "owner" || membership.data?.role === "editor";
  const ids = refIndex(payload.tables);
  const dayIndex = doc.days.findIndex((day) => day.ref === item.dayRef);
  const day = doc.days[dayIndex];
  const placeRef = item.leg?.toPlaceRef ?? item.placeRef;
  const place = placeRef === undefined ? undefined : doc.places.find((each) => each.ref === placeRef);
  const booking = item.bookingRef === undefined ? undefined : doc.bookings.find((each) => each.ref === item.bookingRef);
  const flight = flightOf(doc, item);
  const leg = legLabel(item);
  const rows = (payload.tables as unknown as { audio_guides?: GuideRow[] }).audio_guides ?? [];
  const guide = guideFor(rows, ids[item.ref], placeRef === undefined ? undefined : ids[placeRef]);
  // Nazwy innych opisanych miejsc w treści — odnośniki do ich kart (raz na miejsce w całym opisie).
  const targets = guide === null ? [] : guideLinkTargets(doc, rows, ids, item.ref);
  const used = new Set<string>();
  const linked = (text: string) => <Linked tripId={id} segments={linkGuideText(text, targets, used)} />;
  const guideRow = guide === null ? undefined : guideRowFor(rows, ids[item.ref], placeRef === undefined ? undefined : ids[placeRef]);
  const time = item.time && "start" in item.time ? `${item.time.precision === "approx" ? "ok. " : ""}${item.time.start}${"end" in item.time && item.time.end ? `–${item.time.end}` : ""}` : null;
  const notes = doc.notes.filter((note) => note.scope === "item" && note.targetRef === item.ref);

  return (
    <>
      <div className="flex flex-col gap-1">
        <Link href={`/trips/${id}/plan?day=${encodeURIComponent(item.dayRef ?? "pool")}`} className="text-sm text-zinc-500 underline">
          ← Plan: {doc.trip.title}
        </Link>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <span aria-hidden="true">{itemIcon(doc, item)}</span>
          {item.title}
        </h1>
        <p className="text-sm text-zinc-500">
          {ITEM_KIND[item.kind]}
          {day ? ` · Dzień ${dayIndex + 1}, ${weekday(day.date)}` : " · w puli (poza dniami)"}
          {time ? ` · ${time}` : ""}
          {item.durationMin ? ` · ${item.durationMin} min` : ""}
        </p>
      </div>

      <section className="card flex flex-col gap-2 p-4 text-sm">
        {place && (
          <p>
            <strong>{place.name}</strong>
            {place.address ? <span className="text-zinc-500"> · {place.address}</span> : null}
            {place.lat !== undefined && place.lng !== undefined && (
              <>
                {" · "}
                <a href={`https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lng}`} target="_blank" rel="noreferrer" className="underline">
                  nawiguj
                </a>
              </>
            )}
          </p>
        )}
        {leg && <p>{leg}</p>}
        {flight && <p>✈ {flightLine(flight)}</p>}
        {booking && (
          <p>
            Rezerwacja: <strong>{booking.title}</strong>
            {booking.confirmationCode ? <span className="font-mono"> · {booking.confirmationCode}</span> : null}
          </p>
        )}
        {item.activity && (item.activity.distanceKm || item.activity.ascentM) && (
          <p>
            {item.activity.distanceKm ? `${item.activity.distanceKm} km` : ""}
            {item.activity.ascentM ? ` · ↑ ${item.activity.ascentM} m` : ""}
            {item.activity.difficulty ? ` · ${item.activity.difficulty}` : ""}
          </p>
        )}
        {item.description && <p className="whitespace-pre-line">{item.description}</p>}
        {[...item.notes, ...notes.map((note) => (note.title ? `${note.title}: ${note.body}` : note.body))].map((note, i) => (
          <p key={i} className="text-zinc-600 dark:text-zinc-400">
            • {note}
          </p>
        ))}
        {item.links.length > 0 && (
          <p className="flex flex-wrap gap-x-3">
            {item.links.map((link) => (
              <a key={link.url} href={link.url} target="_blank" rel="noreferrer" className="underline">
                {link.label || link.url}
              </a>
            ))}
          </p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Przewodnik</h2>
        {guide === null ? (
          <p className="text-sm text-zinc-500">
            Brak opisu.
            {canEdit ? " Opis powstaje z artykułu w Wikipedii albo Wikivoyage o tym miejscu (ciekawostki, historia, zdjęcia)." : " Organizator może go przygotować na webie."}
          </p>
        ) : (
          <article className="card flex flex-col gap-3 p-4 text-sm">
            <p className="text-base">{linked(guide.summary)}</p>
            {guide.images.length > 0 && (
              <div className="grid grid-cols-2 gap-2">
                {guide.images.map((image) => (
                  <figure key={image.url} className="flex flex-col gap-1">
                    <a href={image.sourceUrl} target="_blank" rel="noreferrer">
                      {/* Zdjęcia z Commons (upload.wikimedia.org) — zwykły <img>, miniatura 960 px. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={image.thumbUrl} alt={image.title} loading="lazy" className="aspect-[4/3] w-full rounded-lg object-cover" />
                    </a>
                    <figcaption className="text-[11px] leading-tight text-zinc-500">
                      {image.author ? `${image.author}, ` : ""}
                      {image.licenseUrl ? (
                        <a href={image.licenseUrl} target="_blank" rel="noreferrer" className="underline">
                          {image.license}
                        </a>
                      ) : (
                        image.license
                      )}
                      , Wikimedia Commons
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}
            {guide.facts.length > 0 && (
              <div>
                <h3 className="font-semibold">Ciekawostki</h3>
                <ul className="ml-5 list-disc">
                  {guide.facts.map((fact) => (
                    <li key={fact}>{linked(fact)}</li>
                  ))}
                </ul>
              </div>
            )}
            {guide.history && (
              <div>
                <h3 className="font-semibold">Historia</h3>
                <p>{linked(guide.history)}</p>
              </div>
            )}
            {guide.tips.length > 0 && (
              <div>
                <h3 className="font-semibold">Na miejscu</h3>
                <ul className="ml-5 list-disc">
                  {guide.tips.map((tip) => (
                    <li key={tip}>{linked(tip)}</li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-xs text-zinc-500">
              Na podstawie artykułu{" "}
              <a href={guide.article.url} target="_blank" rel="noreferrer" className="underline">
                „{guide.article.title}”
              </a>{" "}
              z {GUIDE_SITE[guide.article.site]} ({guide.article.lang}), licencja{" "}
              <a href="https://creativecommons.org/licenses/by-sa/4.0/deed.pl" target="_blank" rel="noreferrer" className="underline">
                CC BY-SA 4.0
              </a>
              ; streszczenie: AI.
            </p>
          </article>
        )}
        {canEdit && <GuideButtons tripId={id} itemRef={item.ref} guideId={guideRow?.id ?? null} hint={guide?.hint} />}
      </section>
    </>
  );
}

/** Tekst przewodnika z odnośnikami do kart innych opisanych miejsc. */
function Linked({ tripId, segments }: { tripId: string; segments: GuideSegment[] }) {
  return segments.map((segment, i) =>
    segment.ref ? (
      <Link key={i} href={`/trips/${tripId}/item/${encodeURIComponent(segment.ref)}`} className="font-medium text-sea underline decoration-sea/40 underline-offset-2 hover:decoration-sea">
        {segment.text}
      </Link>
    ) : (
      <span key={i}>{segment.text}</span>
    ),
  );
}
