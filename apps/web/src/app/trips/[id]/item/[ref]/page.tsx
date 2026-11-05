import { bookingContacts, legRouteLink, lodgingBooking, lodgingDetails, lodgingLink, flightLine, flightOf, isFootRouteItem, routeLinkLabel, guideLinkTargets, type GuideRow, guideFor, guideRowFor, itemIcon, itemKindLabel, legLabel, stopsLabel, type TripDocument } from "@expeditionplan/core";
import { refIndex, stateFromPayload } from "@expeditionplan/sync";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { EditToggle, editMode } from "@/components/edit-toggle";
import { GuideArticle } from "@/components/guide-article";
import { GuideButtons } from "@/components/guide-button";
import { ItemHeaderEditor } from "@/components/item-header";
import { LodgingEditor } from "@/components/lodging-editor";
import { RouteEstimate } from "@/components/route-estimate";
import { TrackUpload } from "@/components/track-upload";
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
        <ItemCard params={props.params} searchParams={props.searchParams} />
      </Suspense>
    </Shell>
  );
}

const weekday = (date: string) =>
  new Intl.DateTimeFormat("pl-PL", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`)).replace(/^./, (first) => first.toUpperCase());

async function ItemCard({ params, searchParams }: { params: Promise<{ id: string; ref: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id, ref: rawRef } = await params;
  const wantsEdit = await editMode(searchParams);
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
  // Domyślnie podgląd; edycja nagłówka po „Edytuj” (`?edit=1`) — ten sam tryb co w planie.
  const editing = canEdit && wantsEdit;
  const ids = refIndex(payload.tables);
  const dayIndex = doc.days.findIndex((day) => day.ref === item.dayRef);
  const day = doc.days[dayIndex];
  const placeRef = item.leg?.toPlaceRef ?? item.placeRef;
  const place = placeRef === undefined ? undefined : doc.places.find((each) => each.ref === placeRef);
  const booking = item.bookingRef === undefined ? undefined : doc.bookings.find((each) => each.ref === item.bookingRef);
  const flight = flightOf(doc, item);
  const leg = legLabel(item) ?? stopsLabel(item);
  const route = legRouteLink(doc, item);
  const rows = (payload.tables as unknown as { audio_guides?: GuideRow[] }).audio_guides ?? [];
  const guide = guideFor(rows, ids[item.ref], placeRef === undefined ? undefined : ids[placeRef]);
  const guideRow = guide === null ? undefined : guideRowFor(rows, ids[item.ref], placeRef === undefined ? undefined : ids[placeRef]);
  const time = item.time && "start" in item.time ? `${item.time.precision === "approx" ? "ok. " : ""}${item.time.start}${"end" in item.time && item.time.end ? `–${item.time.end}` : ""}` : null;
  const notes = doc.notes.filter((note) => note.scope === "item" && note.targetRef === item.ref);
  const track = item.activity?.trackRef === undefined ? undefined : doc.tracks.find((each) => each.ref === item.activity!.trackRef);
  const lodging = item.kind === "lodging" ? { lines: lodgingDetails(doc, item), contacts: bookingContacts(doc, lodgingBooking(doc, item)?.ref) } : null;

  return (
    <>
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* Powrót na ten sam dzień i w tym samym trybie (podgląd / edycja). */}
          <Link href={`/trips/${id}/plan?day=${encodeURIComponent(item.dayRef ?? "pool")}${editing ? "&edit=1" : ""}`} className="back-link">
            ← Plan: {doc.trip.title}
          </Link>
          {canEdit && <EditToggle href={`/trips/${id}/item/${rawRef}`} editing={editing} />}
        </div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <span aria-hidden="true">{itemIcon(doc, item)}</span>
          {item.title}
        </h1>
        <p className="text-sm text-zinc-500">
          {itemKindLabel(item, ITEM_KIND)}
          {day ? ` · Dzień ${dayIndex + 1}, ${weekday(day.date)}` : " · w puli (poza dniami)"}
          {time ? ` · ${time}` : ""}
          {item.durationMin ? ` · ${item.durationMin} min` : ""}
        </p>
        {editing && <ItemHeaderEditor tripId={id} doc={doc} ids={ids} itemRef={item.ref} />}
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
        {route && (
          <p>
            <a href={route.url} target="_blank" rel="noreferrer" className="underline">
              {route.label}
            </a>
          </p>
        )}
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

      {(track !== undefined || isFootRouteItem(item)) && (track?.geojson !== undefined || track?.url !== undefined || canEdit) && (
        <section className="card flex flex-col gap-2 p-4 text-sm">
          <h2 className="text-lg font-semibold">Trasa</h2>
          {track !== undefined && (
            <p>
              <strong>{track.name}</strong>
              {track.distanceKm !== undefined ? ` · ${track.distanceKm.toLocaleString("pl-PL")} km` : ""}
              {track.ascentM !== undefined ? ` · ↑ ${track.ascentM} m` : ""}
              {track.descentM !== undefined ? ` ↓ ${track.descentM} m` : ""}
              {track.durationMin !== undefined ? ` · ok. ${Math.floor(track.durationMin / 60)} h ${track.durationMin % 60} min` : ""}
            </p>
          )}
          {track?.url !== undefined && /^https?:\/\//i.test(track.url) && (
            <a href={track.url} target="_blank" rel="noreferrer" className="self-start text-sea underline">
              🗺 {routeLinkLabel(track.url)}
            </a>
          )}
          {track?.geojson !== undefined ? (
            <>
              {(track.difficulty || track.waymarking) && <p className="text-zinc-600 dark:text-zinc-400">{[track.difficulty, track.waymarking].filter(Boolean).join(" · ")}</p>}
              {item.dayRef && (
                <Link href={`/trips/${id}/plan?day=${encodeURIComponent(item.dayRef)}`} className="self-start text-sea underline">
                  Pokaż na mapie dnia
                </Link>
              )}
              <p className="text-xs text-zinc-500">Na telefonie ślad jest offline — „Gdzie jestem na śladzie” w szczegółach punktu.</p>
            </>
          ) : (
            canEdit && <p className="text-zinc-500">{track ? "Na mapie planu nie ma jeszcze linii tej trasy — da ją plik GPX." : "Brak trasy."}</p>
          )}
          {canEdit && (
            <RouteEstimate
              tripId={id}
              itemRef={item.ref}
              url={track?.url}
              current={{
                ...((item.leg?.distanceKm ?? item.activity?.distanceKm ?? track?.distanceKm) !== undefined ? { distanceKm: (item.leg?.distanceKm ?? item.activity?.distanceKm ?? track?.distanceKm)! } : {}),
                ...((item.durationMin ?? item.leg?.durationMin) !== undefined ? { durationMin: (item.durationMin ?? item.leg?.durationMin)! } : {}),
                ...((item.activity?.ascentM ?? track?.ascentM) !== undefined ? { ascentM: (item.activity?.ascentM ?? track?.ascentM)! } : {}),
              }}
              fromFile={
                track?.geojson === undefined
                  ? undefined
                  : {
                      ...(track.distanceKm !== undefined ? { distanceKm: track.distanceKm } : {}),
                      ...(track.durationMin !== undefined ? { durationMin: track.durationMin } : {}),
                      ...(track.ascentM !== undefined ? { ascentM: track.ascentM } : {}),
                    }
              }
            />
          )}
          {canEdit && <TrackUpload tripId={id} itemRef={item.ref} hasLine={track?.geojson !== undefined} />}
        </section>
      )}

      {lodging !== null && (editing || lodging.lines.length > 0 || lodging.contacts.length > 0) && (
        <section className="card flex flex-col gap-2 p-4 text-sm">
          <h2 className="text-lg font-semibold">Obiekt</h2>
          {lodging.lines.map((line) => (
            <p key={line}>{line}</p>
          ))}
          {lodging.contacts.map((contact) => (
            <p key={contact.ref}>
              <span className="text-zinc-500">{contact.name}</span>
              {contact.phone ? (
                <>
                  {" · "}
                  <a href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`} className="underline">
                    {contact.phone}
                  </a>
                </>
              ) : null}
              {contact.email ? ` · ${contact.email}` : null}
            </p>
          ))}
          {editing && <LodgingEditor tripId={id} itemRef={item.ref} link={lodgingLink(item)?.url} />}
        </section>
      )}

      {/* Przy noclegu zamiast przewodnika z Wikipedii jest sekcja „Obiekt”. */}
      {item.kind !== "lodging" && (
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Przewodnik</h2>
        {guide === null ? (
          <p className="text-sm text-zinc-500">
            Brak opisu.
            {canEdit ? " Opis powstaje z artykułu w Wikipedii albo Wikivoyage o tym miejscu (ciekawostki, historia, zdjęcia)." : " Organizator może go przygotować na webie."}
          </p>
        ) : (
          <GuideArticle guide={guide} targets={guideLinkTargets(doc, rows, ids, item.ref)} itemBase={`/trips/${id}/item/`} />
        )}
        {canEdit && <GuideButtons tripId={id} itemRef={item.ref} guideId={guideRow?.id ?? null} hint={guideRow?.place_id === null ? guide?.hint : undefined} />}
      </section>
      )}
    </>
  );
}
