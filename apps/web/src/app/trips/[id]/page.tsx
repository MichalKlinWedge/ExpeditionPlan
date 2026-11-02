import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { AiPlanButton } from "@/components/ai-plan-button";
import { CompareIcon, DownloadIcon, InfoIcon, NoteIcon, PeopleIcon, PrinterIcon, RouteIcon, SparkIcon, TicketIcon, VaultIcon } from "@/components/icons";
import { Loading, Shell } from "@/components/shell";
import { requireUser } from "@/lib/auth";
import { ROLE, tripDates } from "@/lib/labels";

/**
 * Wyjazd: podsumowanie i kafelki wejść (plan, rezerwacje, informacje, uczestnicy i dostęp,
 * porównanie ze szkicem, AI, brief, eksport) oraz „Zaplanuj z AI”, gdy jest brief.
 */

// Planowanie z AI (akcja serwera na tej stronie) trwa do kilku minut.
export const maxDuration = 300;

export default function TripPage(props: PageProps<"/trips/[id]">) {
  return (
    <Shell>
      <Suspense fallback={<Loading />}>
        <TripDetails params={props.params} />
      </Suspense>
    </Shell>
  );
}

const DRAFT = "Szkic AI: ";

/** Kafelek nawigacji wyjazdu: ikona, nazwa i podpowiedź (wszystkie równorzędne — to wejścia, nie zakładki). */
function Tile({ href, icon, title, hint }: { href: string; icon: React.ReactNode; title: string; hint: string }) {
  const className = "card group flex flex-col gap-1.5 p-4 transition hover:-translate-y-0.5 hover:border-sea";
  const body = (
    <>
      <span className="flex size-9 items-center justify-center rounded-xl bg-sea-light text-sea transition group-hover:bg-signal group-hover:text-white dark:bg-sea/20 dark:text-teal-300">{icon}</span>
      <span className="font-semibold group-hover:text-sea">{title}</span>
      <span className="text-xs text-zinc-500">{hint}</span>
    </>
  );
  return (
    <Link href={href} className={className}>
      {body}
    </Link>
  );
}

async function TripDetails({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireUser(`/trips/${id}`);
  const [trip, members, travelers, days, items, brief, mine] = await Promise.all([
    supabase.from("my_trips").select("*").eq("id", id).maybeSingle(),
    supabase.from("trip_members").select("user_id", { count: "exact", head: true }).eq("trip_id", id),
    supabase.from("travelers").select("id", { count: "exact", head: true }).eq("trip_id", id).is("deleted_at", null),
    supabase.from("days").select("id", { count: "exact", head: true }).eq("trip_id", id).is("deleted_at", null),
    supabase.from("items").select("id", { count: "exact", head: true }).eq("trip_id", id).is("deleted_at", null),
    supabase.from("trip_brief").select("id").eq("trip_id", id).maybeSingle(),
    supabase.from("my_trips").select("id, title, role").neq("id", id).order("start_date"),
  ]);
  if (trip.data === null) notFound();
  const role = trip.data.role!;
  const canEdit = role === "owner" || role === "editor";
  // Szkic AI → plan: ze szkicu link do planu o tej samej nazwie, z planu wybór szkicu (szkice AI na górze).
  const others = mine.data ?? [];
  const title = trip.data.title!;
  const source = title.startsWith(DRAFT) ? others.find((other) => other.title === title.slice(DRAFT.length) && (other.role === "owner" || other.role === "editor")) : undefined;
  // Porównanie: ze szkicu — z jego planem; z planu — wybór szkicu na stronie porównania.
  const compareHref = source !== undefined ? `/trips/${source.id}/compare?draft=${id}` : canEdit && others.length > 0 ? `/trips/${id}/compare` : null;

  return (
    <>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h1 className="text-3xl font-bold">{trip.data.title}</h1>
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

      {/* Przy dwóch kolumnach ostatni kafelek bez pary zajmuje cały wiersz. */}
      <nav className="grid grid-cols-2 gap-3 sm:grid-cols-3 max-sm:[&>:last-child:nth-child(odd)]:col-span-2">
        {(days.count ?? 0) > 0 && <Tile href={`/trips/${id}/plan`} icon={<RouteIcon />} title="Plan dzień po dniu" hint="godziny, trasy, słońce" />}
        <Tile href={`/trips/${id}/logistics`} icon={<TicketIcon />} title="Rezerwacje i budżet" hint="noclegi, auto, zadania" />
        <Tile href={`/trips/${id}/documents`} icon={<VaultIcon />} title="Sejf dokumentów" hint="bilety, vouchery, kody QR" />
        <Tile href={`/trips/${id}/practical`} icon={<InfoIcon />} title="Informacje praktyczne" hint="numery, zwyczaje, pogoda" />
        <Tile href={`/trips/${id}/people`} icon={<PeopleIcon />} title="Uczestnicy i dostęp" hint={`${travelers.count ?? 0} os. jedzie · ${members.count ?? 0} z dostępem`} />
        {canEdit && (days.count ?? 0) > 0 && <Tile href={`/trips/${id}/tune`} icon={<SparkIcon />} title="Dostrajanie z AI" hint="zmiany i plan B czatem" />}
        <Tile href={`/trips/${id}/brief`} icon={<NoteIcon />} title={brief.data ? "Brief wyjazdu" : "Uzupełnij brief"} hint={brief.data ? "kto, dokąd, w jakim tempie" : "potrzebny do planu z AI"} />
        {compareHref !== null && (
          <Tile href={compareHref} icon={<CompareIcon />} title="Porównanie ze szkicem" hint={source !== undefined ? `z planem „${source.title}”` : "szkic AI obok planu"} />
        )}
        {(days.count ?? 0) > 0 && <Tile href={`/trips/${id}/print`} icon={<PrinterIcon />} title="Wydruk / PDF" hint="plan na papierze, bez telefonu" />}
      </nav>

      {/* Eksport to plik (route handler), nie strona — zwykły link. */}
      <a href={`/trips/${id}/export`} className="flex items-center gap-1.5 self-start text-sm text-zinc-500 underline hover:text-sea">
        <DownloadIcon className="size-4" />
        Pobierz kopię całego planu (JSON)
      </a>

      {canEdit && brief.data !== null && <AiPlanButton tripId={id} />}
    </>
  );
}
