import { dbLoadError } from "@expeditionplan/sync";
import { DRAFT_PREFIX, isDraft, MEMBER_ROLE, tripSections } from "@expeditionplan/core";
import Link from "next/link";
import { Suspense } from "react";

import { PeakIcon, PinIcon, PlusIcon } from "@/components/icons";
import { Loading, Shell } from "@/components/shell";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth";
import { tripDates } from "@/lib/labels";

/**
 * Lista moich wyjazdów z moją rolą (widok `my_trips`). „Nowy wyjazd” i przykłady tylko dla kont,
 * które mogą zakładać wyjazdy; konto bez zaproszenia dostaje informację, jak wejść do planu.
 * Odłożone (termin niepewny, nie wypaliły) — w osobnej sekcji, bez względu na datę. Wyjazdy po dacie
 * końca — w zwiniętym „Archiwum” pod wyjazdami przed nami (najnowsze na górze), z pamiątką.
 * Szkice AI — w zwiniętych „Szkicach” na samym dole, bez względu na datę.
 */
export default function Home() {
  return (
    <Shell>
      <Suspense fallback={<Loading />}>
        <TripList />
      </Suspense>
    </Shell>
  );
}

async function TripList() {
  const { supabase, canCreateTrips } = await requireUser("/");
  const { data, error } = await supabase.from("my_trips").select("*").order("start_date");
  if (error) return <p className="text-sm text-red-600">{dbLoadError(error)}</p>;
  const today = new Date().toISOString().slice(0, 10);
  const { ahead, postponed, archive, drafts } = tripSections(data, today);
  return (
    <>
      <PageHeader
        title="Wyjazdy"
        actions={
          <>
            {data.length > 0 && (
              <Link href="/places" className="btn-secondary">
                <PinIcon className="size-4" />
                Wszystkie miejsca
              </Link>
            )}
            {canCreateTrips && (
              <Link href="/trips/new" className="btn-primary">
                <PlusIcon className="size-4" />
                Nowy wyjazd
              </Link>
            )}
          </>
        }
      />
      {data.length === 0 ? (
        <div className="card flex flex-col items-center gap-3 px-6 py-10 text-center">
          <PeakIcon className="size-10 text-sea" />
          <p className="max-w-md text-zinc-600 dark:text-zinc-400">
            {canCreateTrips ? "Nie masz jeszcze wyjazdów — zacznij od nowego." : "Nie masz jeszcze dostępu do żadnego wyjazdu. Poproś organizatora o link zaproszenia i otwórz go, będąc zalogowanym."}
          </p>
          <Link href="/help" className="btn-secondary btn-sm">
            Jak korzystać z aplikacji
          </Link>
        </div>
      ) : (
        <>
          {ahead.length > 0 ? (
            <TripGrid trips={ahead} />
          ) : (
            <p className="text-sm text-zinc-500">Żadnego wyjazdu przed Tobą{archive.length > 0 ? " — poprzednie są w archiwum" : ""}.</p>
          )}
          {postponed.length > 0 && (
            <details className="flex flex-col gap-3" data-remember="odlozone">
              <summary className="cursor-pointer font-semibold text-zinc-600 dark:text-zinc-400">Odłożone ({postponed.length})</summary>
              <div className="mt-3">
                <TripGrid trips={postponed} postponed />
              </div>
            </details>
          )}
          {archive.length > 0 && (
            <details className="flex flex-col gap-3" data-remember="archiwum">
              <summary className="cursor-pointer font-semibold text-zinc-600 dark:text-zinc-400">Archiwum ({archive.length})</summary>
              <div className="mt-3">
                <TripGrid trips={archive} memories />
              </div>
            </details>
          )}
          {drafts.length > 0 && (
            <details className="flex flex-col gap-3" data-remember="szkice">
              <summary className="cursor-pointer font-semibold text-zinc-600 dark:text-zinc-400">Szkice ({drafts.length})</summary>
              <div className="mt-3">
                <TripGrid trips={drafts} />
              </div>
            </details>
          )}
        </>
      )}
    </>
  );
}

type TripRow = { id: string | null; title: string | null; start_date: string | null; end_date: string | null; role: string | null };

function TripGrid({ trips, memories = false, postponed = false }: { trips: TripRow[]; memories?: boolean; postponed?: boolean }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {trips.map((trip) => {
        const draft = isDraft(trip);
        return (
          <li key={trip.id} className="flex flex-col gap-1">
            <Link
              href={`/trips/${trip.id}`}
              className={`card group flex h-full flex-col gap-2 p-4 transition hover:-translate-y-0.5 hover:border-sea ${draft ? "border-dashed" : ""}`}>
              <span className="flex items-start justify-between gap-3">
                <span className="font-display text-lg leading-snug font-semibold group-hover:text-sea">{draft ? trip.title!.slice(DRAFT_PREFIX.length) : trip.title}</span>
                {draft ? <span className="chip shrink-0">szkic AI</span> : postponed ? <span className="chip shrink-0">odłożony</span> : <Countdown start={trip.start_date!} end={trip.end_date!} />}
              </span>
              <span className="mt-auto text-sm text-zinc-500">
                {postponed && "orientacyjnie: "}
                {tripDates(trip.start_date!, trip.end_date!)} · {MEMBER_ROLE[trip.role!]}
              </span>
            </Link>
            {memories && (
              <Link href={`/trips/${trip.id}/memories`} className="btn-mini self-start">
                Pamiątka z wyjazdu →
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** „za 54 dni” / „trwa” / „za nami” — data dzisiejsza w strefie przeglądarki nie jest potrzebna, wystarczy dzień. */
function Countdown({ start, end }: { start: string; end: string }) {
  const today = new Date().toISOString().slice(0, 10);
  const days = Math.round((Date.parse(start) - Date.parse(today)) / 86_400_000);
  const label = today > end ? "za nami" : days <= 0 ? "trwa" : days === 1 ? "jutro" : `za ${days} dni`;
  const tone = today > end ? "bg-zinc-100 text-zinc-500 dark:bg-zinc-800" : days <= 0 ? "bg-signal text-white" : "";
  return <span className={`chip shrink-0 ${tone}`}>{label}</span>;
}
