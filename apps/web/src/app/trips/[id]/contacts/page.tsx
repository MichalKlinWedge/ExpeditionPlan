import type { Metadata } from "next";
import type { TripDocument } from "@expeditionplan/core";
import { dbLoadError, type PullPayload, stateFromPayload } from "@expeditionplan/sync";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { EditToggle, editMode } from "@/components/edit-toggle";
import { Contacts } from "@/components/logistics-editors";
import { Loading, Shell } from "@/components/shell";
import { requireUser } from "@/lib/auth";
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
        <View params={props.params} searchParams={props.searchParams} />
      </Suspense>
    </Shell>
  );
}

async function View({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const wantsEdit = await editMode(searchParams);
  const { supabase } = await requireUser(`/trips/${id}/contacts`);
  const [{ data, error }, membership] = await Promise.all([
    supabase.rpc("pull_changes", { p_trip: id, p_since: 0 }),
    supabase.from("my_trips").select("role").eq("id", id).maybeSingle(),
  ]);
  if (error) return <p className="text-sm text-red-600">{dbLoadError(error)}</p>;
  if (data === null) notFound();
  const payload = data as PullPayload;
  let doc: TripDocument;
  try {
    doc = stateFromPayload(payload).doc;
  } catch (e) {
    return <p className="text-sm text-red-600">Plan w bazie nie przechodzi walidacji: {e instanceof Error ? e.message : String(e)}</p>;
  }
  const mayEdit = membership.data?.role === "owner" || membership.data?.role === "editor";
  const canEdit = mayEdit && wantsEdit;
  const emergency = doc.contacts.filter((contact) => contact.role === "emergency");
  const others = doc.contacts.filter((contact) => contact.role !== "emergency");
  const bookings = planChoices(doc).bookings;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-col gap-1">
          <Link href={`/trips/${id}`} className="back-link">
            ← {doc.trip.title}
          </Link>
          <h1 className="text-2xl font-semibold">Kontakty</h1>
        </div>
        {mayEdit && <EditToggle href={`/trips/${id}/contacts`} editing={canEdit} />}
      </div>

      {(emergency.length > 0 || canEdit) && (
        <section className="flex flex-col gap-2 card p-4">
          <h2 className="text-lg font-semibold">Numery alarmowe</h2>
          {/* W edycji — lista z „edytuj / usuń” i dodawaniem; w podglądzie — duże numery do wybrania jednym dotknięciem. */}
          {canEdit ? (
            <Contacts tripId={id} contacts={emergency} bookings={bookings} canEdit defaultRole="emergency" addLabel="+ Dodaj numer alarmowy" />
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
        <h2 className="text-lg font-semibold">Gospodarze, wypożyczalnie i inne ({others.length})</h2>
        <Contacts tripId={id} contacts={others} bookings={bookings} canEdit={canEdit} />
      </section>
    </>
  );
}
