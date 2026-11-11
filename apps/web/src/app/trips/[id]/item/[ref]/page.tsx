import type { Metadata } from "next";
import { bookingContacts, dayLabel, flightLine, flightOf, footRouteUrl, formatMinutes, guideFor, guideLinkTargets, type GuideRow, guideRowFor, isFootRouteItem, isTransitItem, ITEM_KIND, itemIcon, itemKindLabel, legLabel, legRouteLink, lodgingBooking, lodgingDetails, lodgingLink, routeLinkLabel, stopsLabel, transitDetailRows, transitRouteUrl, transitShapeRequest, type TripDocument } from "@expeditionplan/core";
import { bookingDetails, itemBookingRef, localToday, vaultDocument, type VaultDocument } from "@expeditionplan/core";
import { dbLoadError, type PullPayload, refIndex, stateFromPayload, type TripState } from "@expeditionplan/sync";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { BookingButton } from "@/components/booking-dialog";
import { EditToggle } from "@/components/edit-toggle";
import { editMode } from "@/lib/edit-mode";
import { GuideArticle } from "@/components/guide-article";
import { ItemEatOut } from "@/components/item-eat-out";
import { GuideButtons } from "@/components/guide-button";
import { ItemHeaderEditor } from "@/components/item-header";
import { ItemPlanNav } from "@/components/item-plan-nav";
import { JournalNew } from "@/components/journal-editor";
import { JournalEntry } from "@/components/journal-entry";
import { JournalLink } from "@/components/journal-link";
import { journalCards } from "@/lib/journal";
import { ItemTexts } from "@/components/item-texts";
import { LodgingEditor } from "@/components/lodging-editor";
import { RouteEstimate } from "@/components/route-estimate";
import { TrackProfile } from "@/components/track-profile";
import { TrackUpload } from "@/components/track-upload";
import { TransitDetails, TransitEditor } from "@/components/transit-editor";
import { Loading, Shell } from "@/components/shell";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Punkt planu — Expedition Planner" };

/**
 * Karta punktu planu: wszystko o punkcie (kiedy, gdzie, opis, notatki, linki, rezerwacja) i przewodnik
 * po miejscu — opis, ciekawostki, historia i zdjęcia z Wikipedii/Commons z atrybucją (M8, etap 1).
 * „Zdjęcia” na końcu karty: wpisy dziennika przy tym punkcie (`journal_entries.item_id`) — te same są w „Dzienniku” —
 * i łączenie z wpisami tego dnia dodanymi wcześniej bez punktu (`JournalLink`).
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


async function ItemCard({ params }: { params: Promise<{ id: string; ref: string }> }) {
  const { id, ref: rawRef } = await params;
  const wantsEdit = await editMode();
  const ref = decodeURIComponent(rawRef);
  const { supabase, userId } = await requireUser(`/trips/${id}/item/${rawRef}`);
  const [{ data, error }, membership] = await Promise.all([
    supabase.rpc("pull_changes", { p_trip: id, p_since: 0 }),
    supabase.from("my_trips").select("role").eq("id", id).maybeSingle(),
  ]);
  if (error) return <p className="text-sm msg-error">{dbLoadError(error)}</p>;
  if (data === null) notFound();
  const payload = data as PullPayload;
  let doc: TripDocument;
  let inputs: TripState["inputs"];
  try {
    ({ doc, inputs } = stateFromPayload(payload));
  } catch (e) {
    return <p className="text-sm msg-error">Plan w bazie nie przechodzi walidacji: {e instanceof Error ? e.message : String(e)}</p>;
  }
  const item = doc.items.find((each) => each.ref === ref);
  if (item === undefined) notFound();
  const canEdit = membership.data?.role === "owner" || membership.data?.role === "editor";
  // Domyślnie podgląd; edycja nagłówka po „Edytuj” (wspólny tryb edycji, `lib/edit-mode.ts`).
  const editing = canEdit && wantsEdit;
  const ids = refIndex(payload.tables);
  const dayIndex = doc.days.findIndex((day) => day.ref === item.dayRef);
  const day = doc.days[dayIndex];
  const placeRef = item.leg?.toPlaceRef ?? item.placeRef;
  const place = placeRef === undefined ? undefined : doc.places.find((each) => each.ref === placeRef);
  const bookingRef = itemBookingRef(doc, item);
  const booking = bookingRef === undefined ? null : bookingDetails(doc, bookingRef, localToday());
  // Dokumenty rezerwacji z sejfu do okna rezerwacji (RLS już odcięło te, których ktoś nie widzi).
  const bookingDocuments = booking === null || bookingRef === undefined || ids[bookingRef] === undefined ? [] : (payload.tables.documents ?? []).map((row) => vaultDocument(row as Record<string, unknown>)).filter((each): each is VaultDocument => each !== null && each.bookingId === ids[bookingRef]);
  const flight = flightOf(doc, item);
  const leg = legLabel(item) ?? stopsLabel(item);
  const route = legRouteLink(doc, item);
  const rows = (payload.tables as unknown as { audio_guides?: GuideRow[] }).audio_guides ?? [];
  const guide = guideFor(rows, ids[item.ref], placeRef === undefined ? undefined : ids[placeRef]);
  const guideRow = guide === null ? undefined : guideRowFor(rows, ids[item.ref], placeRef === undefined ? undefined : ids[placeRef]);
  const time =
    item.time?.precision === "by"
      ? `do ${item.time.end}`
      : item.time && "start" in item.time
        ? `${item.time.precision === "approx" ? "ok. " : ""}${item.time.start}${"end" in item.time && item.time.end ? `–${item.time.end}` : ""}`
        : null;
  const notes = doc.notes.filter((note) => note.scope === "item" && note.targetRef === item.ref);
  const track = item.activity?.trackRef === undefined ? undefined : doc.tracks.find((each) => each.ref === item.activity!.trackRef);
  const transit = isTransitItem(item) ? transitDetailRows(item) : null;
  // Bez miejsca, przejazdu, rezerwacji i opisu karta z podstawowymi danymi byłaby pusta.
  const hasInfo = place !== undefined || leg !== null || route !== null || flight !== undefined || booking !== null || Boolean(item.activity?.distanceKm || item.activity?.ascentM) || editing || Boolean(item.description) || item.notes.length > 0 || notes.length > 0 || item.links.length > 0;
  const lodging = item.kind === "lodging" ? { lines: lodgingDetails(doc, item), contacts: bookingContacts(doc, lodgingBooking(doc, item)?.ref) } : null;
  const itemId = ids[item.ref];
  // Wpisy przy punkcie i do połączenia: z dnia punktu i bez dnia, jednym podpisaniem zdjęć.
  const dayId = day === undefined ? undefined : ids[day.ref];
  const nearby = itemId === undefined ? [] : await journalCards(supabase, payload, userId, (row) => row.item_id === itemId || row.day_id === null || row.day_id === dayId);
  const photos = nearby.filter((entry) => entry.itemId === itemId);
  const titleById = new Map(doc.items.flatMap((each) => (ids[each.ref] === undefined ? [] : [[ids[each.ref]!, each.title] as const])));
  const linkable = nearby
    .filter((entry) => entry.itemId !== itemId)
    .map((entry) => ({ ...entry, canEdit: entry.mine || editing, ...(entry.itemId !== null && titleById.has(entry.itemId) ? { linkedTo: titleById.get(entry.itemId)! } : {}) }));
  const journalDay = day === undefined || ids[day.ref] === undefined ? [] : [{ id: ids[day.ref]!, label: dayLabel(day.date), date: day.date, tz: day.tz }];

  return (
    <>
      {/* Powrót na ten sam dzień i w tym samym trybie (podgląd / edycja). */}
      <PageHeader
        back={{ href: `/trips/${id}/plan?day=${encodeURIComponent(item.dayRef ?? "pool")}`, label: `Plan: ${doc.trip.title}` }}
        title={
          <>
            <span aria-hidden="true">{itemIcon(doc, item)}</span>
            {item.title}
          </>
        }
        actions={canEdit && <EditToggle editing={editing} />}
        intro={
          <>
            {itemKindLabel(item, ITEM_KIND)}
            {day ? ` · Dzień ${dayIndex + 1}, ${dayLabel(day.date)}` : " · w puli (poza dniami)"}
            {time ? ` · ${time}` : ""}
          </>
        }
      />

      <ItemPlanNav tripId={id} doc={doc} inputs={inputs} itemRef={item.ref} {...(editing ? { editor: <ItemHeaderEditor tripId={id} doc={doc} ids={ids} itemRef={item.ref} /> } : {})} />

      {hasInfo && (
      <section className="card flex flex-col gap-2 p-4 text-sm">
        <h2 className="card-title">Szczegóły</h2>
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
            Rezerwacja: <strong>{booking.booking.title}</strong>
            {booking.booking.confirmationCode ? <span className="font-mono"> · {booking.booking.confirmationCode}</span> : null}{" "}
            <BookingButton tripId={id} details={booking} documents={bookingDocuments} label={bookingDocuments.length > 0 ? `szczegóły i dokumenty (${bookingDocuments.length})` : "szczegóły"} />
          </p>
        )}
        {item.activity && (item.activity.distanceKm || item.activity.ascentM) && (
          <p>
            {item.activity.distanceKm ? `${item.activity.distanceKm} km` : ""}
            {item.activity.ascentM ? ` · ↑ ${item.activity.ascentM} m` : ""}
            {item.activity.difficulty ? ` · ${item.activity.difficulty}` : ""}
          </p>
        )}
        <ItemTexts tripId={id} doc={doc} ids={ids} itemRef={item.ref} editing={editing} />
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
      )}

      {item.kind === "meal" && !item.selfCooked && <ItemEatOut tripId={id} doc={doc} ids={ids} itemRef={item.ref} editing={editing} />}

      {(track !== undefined || isFootRouteItem(item)) && (track?.geojson !== undefined || track?.url !== undefined || canEdit) && (
        <section className="card flex flex-col gap-2 p-4 text-sm">
          <h2 className="card-title">Trasa</h2>
          {track !== undefined && (
            <p>
              <strong>{track.name}</strong>
              {track.distanceKm !== undefined ? ` · ${track.distanceKm.toLocaleString("pl-PL")} km` : ""}
              {track.ascentM !== undefined ? ` · ↑ ${track.ascentM} m` : ""}
              {track.descentM !== undefined ? ` ↓ ${track.descentM} m` : ""}
              {track.durationMin !== undefined ? ` · ok. ${formatMinutes(track.durationMin)}` : ""}
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
                <Link href={`/trips/${id}/plan?day=${encodeURIComponent(item.dayRef)}`} className="btn-secondary btn-sm self-start">
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
              plannerUrl={footRouteUrl(doc, item)}
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

      {track?.geojson !== undefined && <TrackProfile tripId={id} doc={doc} inputs={inputs} itemRef={item.ref} canEdit={canEdit} />}

      {transit !== null && (editing || transit.length > 0) && (
        <section id="przejazd-komunikacja" className="card flex scroll-mt-4 flex-col gap-2 p-4 text-sm">
          <h2 className="card-title">Przejazd komunikacją</h2>
          {editing ? (
            <TransitDetails tripId={id} itemRef={item.ref} rows={transit} />
          ) : (
            transit.map((row) => <p key={row.key}>{row.text}</p>)
          )}
          {item.leg?.geometry !== undefined && <p className="text-xs text-zinc-500">Na mapie dnia: przebieg linii z OpenStreetMap.</p>}
          {editing && <TransitEditor tripId={id} itemRef={item.ref} routeUrl={transitRouteUrl(doc, item) ?? undefined} canDraw={transitShapeRequest(doc, item) !== null} />}
        </section>
      )}

      {lodging !== null && (editing || lodging.lines.length > 0 || lodging.contacts.length > 0) && (
        <section className="card flex flex-col gap-2 p-4 text-sm">
          <h2 className="card-title">Obiekt</h2>
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
      guide === null ? (
        <section className="card flex flex-col gap-2 p-4 text-sm">
          <h2 className="card-title">Opis miejsca</h2>
          <p className="text-zinc-500">
            Brak opisu.
            {canEdit ? " Opis powstaje z artykułu w Wikipedii albo Wikivoyage o tym miejscu (ciekawostki, historia, zdjęcia)." : " Organizator może go przygotować na webie."}
          </p>
          {canEdit && <GuideButtons tripId={id} itemRef={item.ref} name={place?.name ?? item.title} guideId={guideRow?.id ?? null} />}
        </section>
      ) : (
        <GuideArticle guide={guide} title={guide.title} heading="Opis miejsca" targets={guideLinkTargets(doc, rows, ids, item.ref)} itemBase={`/trips/${id}/item/`}>
          {canEdit && <GuideButtons tripId={id} itemRef={item.ref} name={place?.name ?? item.title} guideId={guideRow?.id ?? null} hint={guideRow?.place_id === null ? guide.hint : undefined} />}
        </GuideArticle>
      )
      )}

      {/* Zdjęcia na końcu karty: wpisy dziennika przy punkcie, nowy wpis i połączenie z wpisami dodanymi wcześniej. */}
      {itemId !== undefined && day !== undefined && (
        <section className="card flex flex-col gap-3 p-4 text-sm">
          <div className="card-title flex flex-wrap items-center justify-between gap-2">
            <h2>Zdjęcia{photos.length > 0 ? ` (${photos.length})` : ""}</h2>
            <Link href={`/trips/${id}/journal`} className="btn-mini">
              cały dziennik
            </Link>
          </div>
          {photos.map((entry) => (
            <JournalEntry key={entry.id} entry={entry} tz={day.tz} canEdit={entry.mine || editing} days={journalDay} unlink />
          ))}
          <JournalNew tripId={id} days={journalDay} tz={day.tz} itemId={itemId} plannedTime={item.time && "start" in item.time ? item.time.start : undefined} label="+ Dodaj zdjęcia" />
          <JournalLink itemId={itemId} tz={day.tz} candidates={linkable} />
        </section>
      )}
    </>
  );
}
