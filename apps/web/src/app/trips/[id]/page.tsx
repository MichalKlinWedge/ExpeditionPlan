import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { AiPlanButton } from "@/components/ai-plan-button";
import { EditToggle, editMode } from "@/components/edit-toggle";
import { InviteForm, RemoveTripForm, TravelerList } from "@/components/forms";
import { DownloadIcon, InfoIcon, NoteIcon, RouteIcon, SparkIcon, TicketIcon } from "@/components/icons";
import { Loading, Shell } from "@/components/shell";
import { requireUser } from "@/lib/auth";
import { ROLE, tripDates } from "@/lib/labels";

/**
 * Wyjazd: podsumowanie planu, „Zaplanuj z AI” (gdy jest brief), członkowie z rolami, uczestnicy,
 * zaproszenie linkiem; na dole usunięcie wyjazdu (właściciel) albo wyjście z niego.
 */

// Planowanie z AI (akcja serwera na tej stronie) trwa do kilku minut.
export const maxDuration = 300;

export default function TripPage(props: PageProps<"/trips/[id]">) {
  return (
    <Shell>
      <Suspense fallback={<Loading />}>
        <TripDetails params={props.params} searchParams={props.searchParams} />
      </Suspense>
    </Shell>
  );
}

const section = "card flex flex-col gap-3 p-5";
const DRAFT = "Szkic AI: ";
const heading = "text-xl font-semibold";

/** Kafelek nawigacji wyjazdu: ikona, nazwa i podpowiedź; `accent` — główne wejście (plan). */
function Tile({ href, icon, title, hint, accent = false, download = false }: { href: string; icon: React.ReactNode; title: string; hint: string; accent?: boolean; download?: boolean }) {
  const className = `card group flex flex-col gap-1.5 p-4 transition hover:-translate-y-0.5 hover:border-sea ${accent ? "border-signal/60 bg-signal/5" : ""}`;
  const body = (
    <>
      <span className={`flex size-9 items-center justify-center rounded-xl ${accent ? "bg-signal text-white" : "bg-sea-light text-sea dark:bg-sea/20 dark:text-teal-300"}`}>{icon}</span>
      <span className="font-semibold group-hover:text-sea">{title}</span>
      <span className="text-xs text-zinc-500">{hint}</span>
    </>
  );
  // Eksport to plik (route handler), nie strona — zwykły link.
  return download ? (
    <a href={href} className={className}>
      {body}
    </a>
  ) : (
    <Link href={href} className={className}>
      {body}
    </Link>
  );
}

async function TripDetails({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const wantsEdit = await editMode(searchParams);
  const { supabase } = await requireUser(`/trips/${id}`);
  const [trip, members, travelers, days, items, brief, mine] = await Promise.all([
    supabase.from("my_trips").select("*").eq("id", id).maybeSingle(),
    supabase.from("trip_members").select("user_id, role, can_add_expenses, profiles(display_name)").eq("trip_id", id).order("created_at"),
    supabase.from("travelers").select("id, name, nickname, age, household, guardian_id, is_driver").eq("trip_id", id).is("deleted_at", null).order("sort_key"),
    supabase.from("days").select("id", { count: "exact", head: true }).eq("trip_id", id).is("deleted_at", null),
    supabase.from("items").select("id", { count: "exact", head: true }).eq("trip_id", id).is("deleted_at", null),
    supabase.from("trip_brief").select("id").eq("trip_id", id).maybeSingle(),
    supabase.from("my_trips").select("id, title, role").neq("id", id).order("start_date"),
  ]);
  if (trip.data === null) notFound();
  const role = trip.data.role!;
  const canEdit = role === "owner" || role === "editor";
  // Domyślnie podgląd: uczestników i zaproszenia zmienia się po „Edytuj” (`?edit=1`).
  const editing = canEdit && wantsEdit;
  const people = travelers.data ?? [];
  // Szkic AI → plan: ze szkicu link do planu o tej samej nazwie, z planu wybór szkicu (szkice AI na górze).
  const others = mine.data ?? [];
  const title = trip.data.title!;
  const source = title.startsWith(DRAFT) ? others.find((other) => other.title === title.slice(DRAFT.length) && (other.role === "owner" || other.role === "editor")) : undefined;
  const drafts = [...others].sort((a, b) => Number(b.title!.startsWith(DRAFT)) - Number(a.title!.startsWith(DRAFT)));

  return (
    <>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h1 className="text-3xl font-bold">{trip.data.title}</h1>
          {canEdit && <EditToggle href={`/trips/${id}`} editing={editing} />}
        </div>
        <p className="flex flex-wrap items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
          <span className="chip">{tripDates(trip.data.start_date!, trip.data.end_date!)}</span>
          <span>{trip.data.primary_tz}</span>
          <span>·</span>
          <span>{trip.data.base_currency}</span>
          <span>·</span>
          <span>Twoja rola: {ROLE[role]}</span>
          <span>·</span>
          <span>
            {days.count ?? 0} dni, {items.count ?? 0} punktów
          </span>
        </p>
      </div>

      <nav className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {(days.count ?? 0) > 0 && <Tile href={`/trips/${id}/plan`} icon={<RouteIcon />} title="Plan dzień po dniu" hint="godziny, trasy, słońce" accent />}
        <Tile href={`/trips/${id}/logistics`} icon={<TicketIcon />} title="Rezerwacje i budżet" hint="noclegi, auto, zadania" />
        <Tile href={`/trips/${id}/practical`} icon={<InfoIcon />} title="Informacje praktyczne" hint="numery, zwyczaje, pogoda" />
        {canEdit && (days.count ?? 0) > 0 && <Tile href={`/trips/${id}/tune`} icon={<SparkIcon />} title="Dostrajanie z AI" hint="zmiany i plan B czatem" />}
        <Tile href={`/trips/${id}/brief`} icon={<NoteIcon />} title={brief.data ? "Brief wyjazdu" : "Uzupełnij brief"} hint={brief.data ? "kto, dokąd, w jakim tempie" : "potrzebny do planu z AI"} />
        <Tile href={`/trips/${id}/export`} icon={<DownloadIcon />} title="Pobierz JSON" hint="kopia całego planu" download />
      </nav>

      {canEdit && brief.data !== null && <AiPlanButton tripId={id} />}

      {source !== undefined && (
        <p className="text-sm">
          <Link href={`/trips/${source.id}/compare?draft=${id}`} className="underline">
            Porównaj ze swoim planem „{source.title}” i przenieś punkty
          </Link>
        </p>
      )}
      {canEdit && source === undefined && drafts.length > 0 && (
        <form action={`/trips/${id}/compare`} className="flex flex-wrap items-center gap-2 text-sm">
          <label htmlFor="draft">Porównaj ze szkicem:</label>
          <select id="draft" name="draft" defaultValue={drafts.find((other) => other.title === `${DRAFT}${title}`)?.id} className="field px-2 py-1">
            {drafts.map((other) => (
              <option key={other.id} value={other.id!}>
                {other.title}
              </option>
            ))}
          </select>
          <button className="btn-secondary btn-sm">Porównaj</button>
        </form>
      )}

      <section className={section}>
        <h2 className={heading}>Uczestnicy</h2>
        <TravelerList tripId={id} people={people} canEdit={editing} />
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
      </section>

      <section className={section}>
        <RemoveTripForm tripId={id} title={title} owner={role === "owner"} />
      </section>
    </>
  );
}
