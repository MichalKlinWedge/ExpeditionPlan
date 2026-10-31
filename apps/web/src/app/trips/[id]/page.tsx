import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { InviteForm, TravelerForm } from "@/components/forms";
import { Loading, Shell } from "@/components/shell";
import { requireUser } from "@/lib/auth";
import { ROLE, tripDates } from "@/lib/labels";

/** Wyjazd (MVP-1): podsumowanie planu, członkowie z rolami, uczestnicy, zaproszenie linkiem. */
export default function TripPage(props: PageProps<"/trips/[id]">) {
  return (
    <Shell>
      <Suspense fallback={<Loading />}>
        <TripDetails params={props.params} />
      </Suspense>
    </Shell>
  );
}

const section = "flex flex-col gap-3";
const heading = "text-lg font-semibold";

async function TripDetails({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireUser(`/trips/${id}`);
  const [trip, members, travelers, days, items, brief] = await Promise.all([
    supabase.from("my_trips").select("*").eq("id", id).maybeSingle(),
    supabase.from("trip_members").select("user_id, role, can_add_expenses, profiles(display_name)").eq("trip_id", id).order("created_at"),
    supabase.from("travelers").select("id, name, nickname, age, household, guardian_id, is_driver").eq("trip_id", id).is("deleted_at", null).order("sort_key"),
    supabase.from("days").select("id", { count: "exact", head: true }).eq("trip_id", id).is("deleted_at", null),
    supabase.from("items").select("id", { count: "exact", head: true }).eq("trip_id", id).is("deleted_at", null),
    supabase.from("trip_brief").select("id").eq("trip_id", id).maybeSingle(),
  ]);
  if (trip.data === null) notFound();
  const role = trip.data.role!;
  const canEdit = role === "owner" || role === "editor";
  const people = travelers.data ?? [];
  const nameOf = new Map(people.map((person) => [person.id, person.name]));

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{trip.data.title}</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          {tripDates(trip.data.start_date!, trip.data.end_date!)} · {trip.data.primary_tz} · {trip.data.base_currency} · Twoja rola: {ROLE[role]}
        </p>
        <p className="text-sm text-zinc-500">
          Plan: {days.count ?? 0} dni, {items.count ?? 0} punktów. Edytor planu przyjdzie w MVP-3.
        </p>
        <p className="flex gap-4 text-sm">
          {(days.count ?? 0) > 0 && (
            <Link href={`/trips/${id}/plan`} className="underline">
              Plan dzień po dniu
            </Link>
          )}
          <Link href={`/trips/${id}/brief`} className="underline">
            {brief.data ? "Brief wyjazdu — zmień" : "Uzupełnij brief wyjazdu (dla AI)"}
          </Link>
        </p>
      </div>

      <section className={section}>
        <h2 className={heading}>Uczestnicy</h2>
        {people.length === 0 ? (
          <p className="text-sm text-zinc-500">Brak uczestników.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {people.map((person) => (
              <li key={person.id}>
                <span className="font-medium">{person.name}</span>
                {person.nickname ? ` „${person.nickname}”` : ""}
                <span className="text-zinc-500">
                  {person.age !== null ? ` · ${person.age} l.` : ""}
                  {person.household ? ` · ${person.household}` : ""}
                  {person.guardian_id ? ` · pod opieką: ${nameOf.get(person.guardian_id) ?? "?"}` : ""}
                  {person.is_driver ? " · kierowca" : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
        {canEdit && <TravelerForm tripId={id} guardians={people.filter((person) => person.age === null || person.age >= 18)} />}
      </section>

      <section className={section}>
        <h2 className={heading}>Kto ma dostęp</h2>
        <ul className="flex flex-col gap-1 text-sm">
          {(members.data ?? []).map((member) => (
            <li key={member.user_id}>
              {member.profiles?.display_name ?? "?"} <span className="text-zinc-500">· {ROLE[member.role]}</span>
            </li>
          ))}
        </ul>
        {role === "owner" && <InviteForm tripId={id} />}
      </section>
    </>
  );
}
