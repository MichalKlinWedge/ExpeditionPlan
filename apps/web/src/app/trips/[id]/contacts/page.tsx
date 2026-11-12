import type { Metadata } from "next";
import { itemsOfBooking, type TripDocument } from "@expeditionplan/core";
import { dbLoadError, type PullPayload, stateFromPayload } from "@expeditionplan/sync";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { EditToggle } from "@/components/edit-toggle";
import { editMode } from "@/lib/edit-mode";
import { Contacts, ContactsEditor, HashFocus } from "@/components/logistics-editors";
import { Loading, Shell } from "@/components/shell";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth";
import { bookingHref } from "@/lib/booking-link";
import { planChoices } from "@/lib/tasks";

export const metadata: Metadata = { title: "Kontakty — Expedition Planner" };

/**
 * Kontakty wyjazdu w jednym miejscu (wcześniej w logistyce i w informacjach praktycznych): numery
 * alarmowe na górze, dużymi cyframi, potem gospodarze, wypożyczalnie, obiekty — z rezerwacją, której
 * dotyczą. Dodawanie, edycja i usuwanie po „Edytuj” (organizator, edytor). Na telefonie: zakładka Info.
 */

export default function ContactsPage(props: PageProps<"/trips/[id]/contacts">) {
  return (
    <Shell>
      <Suspense fallback={<Loading />}>
        <View params={props.params} />
      </Suspense>
    </Shell>
  );
}

async function View({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const wantsEdit = await editMode();
  const { supabase } = await requireUser(`/trips/${id}/contacts`);
  const [{ data, error }, membership] = await Promise.all([
    supabase.rpc("pull_changes", { p_trip: id, p_since: 0 }),
    supabase.from("my_trips").select("role").eq("id", id).maybeSingle(),
  ]);
  if (error) return <p className="text-sm msg-error">{dbLoadError(error)}</p>;
  if (data === null) notFound();
  const payload = data as PullPayload;
  let doc: TripDocument;
  try {
    doc = stateFromPayload(payload).doc;
  } catch (e) {
    return <p className="text-sm msg-error">Plan w bazie nie przechodzi walidacji: {e instanceof Error ? e.message : String(e)}</p>;
  }
  const mayEdit = membership.data?.role === "owner" || membership.data?.role === "editor";
  const canEdit = mayEdit && wantsEdit;
  const emergency = doc.contacts.filter((contact) => contact.role === "emergency");
  const others = doc.contacts.filter((contact) => contact.role !== "emergency");
  const bookings = planChoices(doc).bookings;
  const bookingItems = Object.fromEntries(
    [...new Set(doc.contacts.flatMap((contact) => (contact.bookingRef ? [contact.bookingRef] : [])))].map((ref) => [ref, itemsOfBooking(doc, ref).map((item) => ({ ref: item.ref, title: item.title }))]),
  );
  const bookingHrefs = Object.fromEntries(doc.bookings.flatMap((booking) => (bookingHref(id, booking) === null ? [] : [[booking.ref, bookingHref(id, booking)!]])));

  return (
    <>
      <PageHeader back={{ href: `/trips/${id}`, label: doc.trip.title }} title="Kontakty" actions={mayEdit && <EditToggle editing={canEdit} />} />

      {/* Dodawanie na górze, nowy kontakt i edycja w osobnej karcie (`ContactsEditor`). */}
      <ContactsEditor tripId={id} contacts={doc.contacts} bookings={bookings} canEdit={canEdit}>
      {(emergency.length > 0 || canEdit) && (
        <section className="flex flex-col gap-2 card p-4">
          <h2 className="card-title">Numery alarmowe</h2>
          {/* W edycji — lista z „edytuj / usuń” i dodawaniem; w podglądzie — duże numery do wybrania jednym dotknięciem. */}
          {canEdit ? (
            <Contacts tripId={id} contacts={emergency} bookings={bookings} canEdit bookingHrefs={bookingHrefs} bookingItems={bookingItems} />
          ) : (
            <ul className="flex flex-wrap gap-3">
              {emergency
                .filter((contact) => contact.phone)
                .map((contact) => (
                  <li key={contact.ref}>
                    <a href={`tel:${contact.phone!.replace(/[^\d+]/g, "")}`} className="flex flex-col rounded-xl border border-red-200 px-4 py-2 hover:border-red-400 dark:border-red-900">
                      <span className="font-mono text-2xl font-semibold text-red-700 dark:text-red-400">{contact.phone}</span>
                      <span className="text-xs text-zinc-500">{contact.name}</span>
                    </a>
                  </li>
                ))}
            </ul>
          )}
        </section>
      )}

      <section className="flex flex-col gap-3 card p-4">
        <h2 className="card-title">Gospodarze, wypożyczalnie i inne ({others.length})</h2>
        <Contacts tripId={id} contacts={others} bookings={bookings} canEdit={canEdit} bookingHrefs={bookingHrefs} bookingItems={bookingItems} />
      </section>
      </ContactsEditor>
      <HashFocus />
    </>
  );
}
