import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { EditToggle, editMode } from "@/components/edit-toggle";
import { InviteForm, RemoveTripForm, TravelerList } from "@/components/forms";
import { PublicShare } from "@/components/public-share";
import { Loading, Shell } from "@/components/shell";
import { requireUser } from "@/lib/auth";
import { ROLE } from "@/lib/labels";

/**
 * Uczestnicy i dostęp: kto jedzie (uczestnicy), kto ma dostęp do planu (role), zaproszenie linkiem,
 * publiczny link „tylko podgląd” i na dole usunięcie wyjazdu (właściciel) albo wyjście z niego.
 * Domyślnie podgląd; zmiany po „Edytuj” (`?edit=1`).
 */
export default function PeoplePage(props: PageProps<"/trips/[id]/people">) {
  return (
    <Shell>
      <Suspense fallback={<Loading />}>
        <People params={props.params} searchParams={props.searchParams} />
      </Suspense>
    </Shell>
  );
}

const section = "card flex flex-col gap-3 p-5";
const heading = "text-xl font-semibold";

async function People({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const wantsEdit = await editMode(searchParams);
  const { supabase } = await requireUser(`/trips/${id}/people`);
  const [trip, members, travelers, share] = await Promise.all([
    supabase.from("my_trips").select("title, role").eq("id", id).maybeSingle(),
    supabase.from("trip_members").select("user_id, role, can_add_expenses, profiles(display_name)").eq("trip_id", id).order("created_at"),
    supabase.from("travelers").select("id, name, nickname, age, household, guardian_id, is_driver").eq("trip_id", id).is("deleted_at", null).order("sort_key"),
    supabase.from("public_shares").select("enabled, hide").eq("trip_id", id).maybeSingle(),
  ]);
  if (trip.data === null) notFound();
  const role = trip.data.role!;
  const canEdit = role === "owner" || role === "editor";
  const editing = canEdit && wantsEdit;
  const title = trip.data.title!;

  return (
    <>
      <div className="flex flex-col gap-1">
        <Link href={`/trips/${id}`} className="back-link">
          ← {title}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h1 className="text-3xl font-bold">Uczestnicy i dostęp</h1>
          {canEdit && <EditToggle href={`/trips/${id}/people`} editing={editing} />}
        </div>
      </div>

      <section className={section}>
        <h2 className={heading}>Uczestnicy</h2>
        <TravelerList tripId={id} people={travelers.data ?? []} canEdit={editing} />
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
        {role === "owner" && editing && <InviteForm tripId={id} />}
        {role === "owner" && !editing && <p className="text-xs text-zinc-500">Zaproszenie linkiem — po „Edytuj”.</p>}
      </section>

      {role === "owner" && (
        <section className={section}>
          <h2 className={heading}>Publiczny link (tylko podgląd)</h2>
          {editing ? (
            <PublicShare tripId={id} enabled={share.data?.enabled === true} hide={(share.data?.hide as { costs?: boolean; names?: boolean; lodgingAddress?: boolean } | null) ?? null} />
          ) : (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">{share.data?.enabled ? "Włączony — plan dnia i mapa pod linkiem, bez logowania." : "Wyłączony."} Zmiana po „Edytuj”.</p>
          )}
        </section>
      )}

      <section className={section}>
        <RemoveTripForm tripId={id} title={title} owner={role === "owner"} />
      </section>
    </>
  );
}
