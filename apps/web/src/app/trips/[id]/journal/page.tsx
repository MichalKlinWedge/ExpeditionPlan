import type { Metadata } from "next";
import { dayLabel, journalMovedTime, type TripDocument } from "@expeditionplan/core";
import { dbLoadError, type PullPayload, refIndex, stateFromPayload } from "@expeditionplan/sync";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { EditToggle } from "@/components/edit-toggle";
import { JournalNew } from "@/components/journal-editor";
import { JournalEntry } from "@/components/journal-entry";
import { Loading, Shell } from "@/components/shell";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth";
import { editMode } from "@/lib/edit-mode";
import { journalCards } from "@/lib/journal";

export const metadata: Metadata = { title: "Dziennik — Expedition Planner" };

/**
 * Dziennik wyjazdu: wpisy i zdjęcia złożone w relację dzień po dniu. W trasie powstają na telefonie (offline),
 * tu można je dodać z komputera (`JournalNew`, np. zdjęcia po powrocie), poprawić, przesunąć ↑ / ↓, przepiąć na
 * inny dzień i usunąć (`JournalEntry`). Zdjęcia z prywatnego bucketu
 * `journal` przez podpisane URL-e (ważne godzinę) — zdjęcie, które telefon jeszcze wysyła, ma opis zamiast obrazka.
 * Wpis przy punkcie planu prowadzi do jego karty, gdzie też dodaje się zdjęcia tego punktu.
 */
export default function JournalPage(props: PageProps<"/trips/[id]/journal">) {
  return (
    <Shell>
      <Suspense fallback={<Loading />}>
        <Journal params={props.params} />
      </Suspense>
    </Shell>
  );
}


async function Journal({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const wantsEdit = await editMode();
  const { supabase, userId } = await requireUser(`/trips/${id}/journal`);
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
  const canEdit = membership.data?.role === "owner" || membership.data?.role === "editor";
  const editing = canEdit && wantsEdit;
  const rows = await journalCards(supabase, payload, userId);
  const ids = refIndex(payload.tables);
  const itemOfId = new Map(doc.items.flatMap((item) => (ids[item.ref] === undefined ? [] : [[ids[item.ref]!, item] as const])));
  const groups = [
    ...doc.days.map((day, index) => ({ key: day.ref, title: `Dzień ${index + 1} · ${dayLabel(day.date)}${day.title ? ` — ${day.title}` : ""}`, tz: day.tz, rows: rows.filter((row) => row.dayId === ids[day.ref]) })),
    { key: "none", title: "Bez dnia", tz: doc.trip.primaryTz, rows: rows.filter((row) => row.dayId === null || !doc.days.some((day) => ids[day.ref] === row.dayId)) },
  ].filter((group) => group.rows.length > 0);
  const days = doc.days.flatMap((day, index) => (ids[day.ref] === undefined ? [] : [{ id: ids[day.ref]!, label: `Dzień ${index + 1} · ${dayLabel(day.date)}`, date: day.date, tz: day.tz }]));

  return (
    <>
      <PageHeader
        back={{ href: `/trips/${id}`, label: doc.trip.title }}
        title="Dziennik"
        actions={canEdit && rows.some((row) => !row.mine) && <EditToggle editing={editing} />}
        intro="W trasie wpisy i zdjęcia dodaje się na telefonie (zakładka Plan → Dziennik), także bez internetu. Tu możesz dodać je z komputera, a zdjęcia konkretnego punktu na jego karcie w planie."
      />
      <JournalNew tripId={id} days={days} tz={doc.trip.primaryTz} />
      {groups.length === 0 && <p className="text-sm text-zinc-500">Dziennik jest jeszcze pusty.</p>}
      {groups.map((group) => (
        <section key={group.key} className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{group.title}</h2>
          {group.rows.map((row, index) => {
            const item = row.itemId === null ? undefined : itemOfId.get(row.itemId);
            const times = group.rows.map((each) => each.takenAt);
            return (
              <JournalEntry
                key={row.id}
                entry={row}
                tz={group.tz}
                canEdit={row.mine || editing}
                days={days}
                upAt={journalMovedTime(times, index, -1)}
                downAt={journalMovedTime(times, index, 1)}
                item={item === undefined ? undefined : { href: `/trips/${id}/item/${encodeURIComponent(item.ref)}`, title: item.title }}
              />
            );
          })}
        </section>
      ))}
    </>
  );
}
