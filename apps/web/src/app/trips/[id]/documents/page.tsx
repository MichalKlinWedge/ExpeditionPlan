import type { Metadata } from "next";
import { dayLabelShort, type TripDocument, vaultDocument, type VaultDocument } from "@expeditionplan/core";
import { dbLoadError, type PullPayload, stateFromPayload } from "@expeditionplan/sync";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { EditToggle } from "@/components/edit-toggle";
import { editMode } from "@/lib/edit-mode";
import { Loading, Shell } from "@/components/shell";
import { Vault } from "@/components/vault";
import { requireUser } from "@/lib/auth";
import { bookingHref } from "@/lib/booking-link";

export const metadata: Metadata = { title: "Sejf dokumentów — Expedition Planner" };

/**
 * Sejf dokumentów (MVP-3, SPECYFIKACJA M11): bilety, vouchery i potwierdzenia przy rezerwacji
 * albo punkcie, z widocznością i kodem do pokazania przy bramce. Lista z `pull_changes` (RLS
 * odcina dokumenty, których ktoś nie powinien widzieć), pliki z prywatnego bucketu `documents`.
 */
export default function DocumentsPage(props: PageProps<"/trips/[id]/documents">) {
  return (
    <Shell>
      <Suspense fallback={<Loading />}>
        <Documents params={props.params} />
      </Suspense>
    </Shell>
  );
}

async function Documents({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const wantsEdit = await editMode();
  const { supabase, userId } = await requireUser(`/trips/${id}/documents`);
  const [{ data, error }, membership, members] = await Promise.all([
    supabase.rpc("pull_changes", { p_trip: id, p_since: 0 }),
    supabase.from("my_trips").select("role").eq("id", id).maybeSingle(),
    supabase.from("trip_members").select("user_id, role, profiles(display_name)").eq("trip_id", id).order("created_at"),
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
  const role = membership.data?.role;
  const mayEdit = role === "owner" || role === "editor";
  const editing = mayEdit && wantsEdit;
  const documents = (payload.tables.documents ?? []).map((row) => vaultDocument(row as Record<string, unknown>)).filter((each): each is VaultDocument => each !== null);
  // Rezerwacje i punkty po id wiersza (dokument wskazuje wiersze, nie `ref`); wiersz bez `ref` ma w planie `id-<id>`.
  const rowId = new Map<string, string>();
  for (const table of ["bookings", "items"] as const) for (const row of payload.tables[table] ?? []) rowId.set(`${table}:${typeof row.ref === "string" ? row.ref : `id-${String(row.id)}`}`, String(row.id));
  const bookings = doc.bookings
    .filter((booking) => booking.status !== "candidate" && booking.status !== "idea")
    .flatMap((booking) => (rowId.get(`bookings:${booking.ref}`) ? [{ id: rowId.get(`bookings:${booking.ref}`)!, title: booking.title, code: booking.confirmationCode ?? null, href: bookingHref(id, booking) }] : []));
  // Punkty planu dzień po dniu, w kolejności planu; na końcu dnia nocleg (rezerwacja obejmująca tę noc).
  const items = doc.days.flatMap((day, index) => {
    const label = `Dzień ${index + 1} · ${dayLabelShort(day.date)}`;
    const points = doc.items
      .filter((item) => item.dayRef === day.ref && rowId.has(`items:${item.ref}`))
      .sort((a, b) => (a.sortKey ?? "").localeCompare(b.sortKey ?? ""))
      .map((item) => ({ id: rowId.get(`items:${item.ref}`)!, title: `dz. ${index + 1} · ${item.title}`, label: item.title, day: label }));
    const nights = doc.bookings
      .filter((booking) => (booking.kind === "lodging" || booking.lodging !== undefined) && booking.start?.date !== undefined && booking.start.date <= day.date && day.date < (booking.end?.date ?? booking.start.date))
      .flatMap((booking) => bookings.filter((each) => each.id === rowId.get(`bookings:${booking.ref}`)))
      .map((booking) => ({ id: booking.id, title: booking.title, label: `nocleg · ${booking.title}`, day: label, booking: true }));
    return [...points, ...nights];
  });
  const people = (members.data ?? []).map((member) => ({ userId: member.user_id, name: member.profiles?.display_name ?? "?", role: member.role }));

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-col gap-1">
          <Link href={`/trips/${id}`} className="back-link">
            ← {doc.trip.title}
          </Link>
          <h1 className="text-2xl font-semibold">Sejf dokumentów</h1>
        </div>
        {mayEdit && <EditToggle editing={editing} />}
      </div>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Bilety, vouchery i potwierdzenia. Kod (QR, Aztec, PDF417) odczytany z pliku pokażesz przy bramce — także na telefonie bez internetu, jeśli dokument jest oznaczony „offline”.
      </p>
      <Vault tripId={id} documents={documents} bookings={bookings} items={items} people={people} userId={userId} owner={role === "owner"} editing={editing} />
    </>
  );
}
