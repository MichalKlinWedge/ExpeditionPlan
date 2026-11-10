import type { Metadata } from "next";
import { bestTerms, DatePoll, type DayAnswer, dayLabelShort, daysBetween, decideByText, groupTally, pollDays, type TripDocument, votesFromRows, votingGroups } from "@expeditionplan/core";
import { dbLoadError, type PullPayload, refIndex, stateFromPayload } from "@expeditionplan/sync";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { EditToggle } from "@/components/edit-toggle";
import { Loading, Shell } from "@/components/shell";
import { PageHeader } from "@/components/page-header";
import { type BoardGroup, VoteBoard } from "@/components/vote-board";
import { requireUser } from "@/lib/auth";
import { climateSource } from "@/lib/climate-place";
import { editMode } from "@/lib/edit-mode";

export const metadata: Metadata = { title: "Głosowanie — Expedition Planner" };

/**
 * Głosowanie grupy: warianty planu, kandydaci noclegu i termin (dostępność dzień po dniu). Głosuje każdy
 * uczestnik za siebie i swoje dzieci, bez trybu edycji; wybór wariantu i okno ankiety terminu zmienia
 * organizator albo edytor po „Edytuj”. Wyniki widzą wszyscy uczestnicy.
 */

const SCOPE: Record<string, string> = { item: "punkt", block: "część dnia", day: "dzień", trip: "cały wyjazd", booking: "kandydaci rezerwacji" };

export default function VotesPage(props: PageProps<"/trips/[id]/votes">) {
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
  const { supabase, userId } = await requireUser(`/trips/${id}/votes`);
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
  const ids = refIndex(payload.tables);
  const refOf = new Map(Object.entries(ids).map(([ref, rowId]) => [rowId, ref]));
  const votes = votesFromRows(payload.tables.trip_votes ?? [], refOf);

  // Za kogo głosuję: ja i moje dzieci; organizator i edytor także za pozostałych (np. bez konta).
  const rows = (payload.tables.travelers ?? []).filter((row) => row.deleted_at === null);
  const own = rows.filter((row) => row.user_id === userId);
  const mine = new Set([...own, ...rows.filter((row) => own.some((parent) => parent.id === row.guardian_id))].map((row) => row.id as string));
  const people = doc.travelers.flatMap((person) => {
    const rowId = ids[person.ref];
    if (rowId === undefined || !(mine.has(rowId) || mayEdit)) return [];
    const row = rows.find((each) => each.id === rowId);
    return [{ ref: person.ref, id: rowId, name: person.name, mine: mine.has(rowId), account: typeof row?.user_id === "string" }];
  });
  people.sort((a, b) => Number(b.mine) - Number(a.mine));

  // Uczestnik widzi tylko wybory, nad którymi organizator otworzył głosowanie.
  const groups: BoardGroup[] = votingGroups(doc).filter((group) => mayEdit || group.votingOpen === true).map((group) => {
    const day = doc.days.find((each) => each.ref === group.dayRef);
    const tally = groupTally(doc, group.ref, votes);
    return {
      ref: group.ref,
      id: ids[group.ref]!,
      title: group.title,
      where: [SCOPE[group.scope], day ? dayLabelShort(day.date) : null].filter(Boolean).join(" · "),
      condition: group.conditionText ?? null,
      decideBy: decideByText(group) ?? null,
      chosenRef: group.chosenRef ?? null,
      votingOpen: group.votingOpen === true,
      options: tally.options.map((option) => {
        const variant = doc.variants.find((each) => each.ref === option.variantRef)!;
        return { ...option, id: ids[option.variantRef]!, summary: variant.summary ?? null };
      }),
      indifferent: tally.indifferent,
      missing: tally.missing,
      leaders: tally.leaders,
      byTraveler: tally.byTraveler,
    };
  });

  const poll = DatePoll.safeParse(payload.trip?.date_poll ?? null);
  const length = daysBetween(doc.trip.startDate, doc.trip.endDate) + 1;
  const answers: Record<string, Record<string, DayAnswer>> = {};
  for (const vote of votes.days) (answers[vote.travelerRef] ??= {})[vote.date] = vote.answer;
  const dayCounts: Record<string, { yes: number; maybe: number; no: number }> = {};
  if (poll.success) {
    for (const date of pollDays(poll.data)) dayCounts[date] = { yes: 0, maybe: 0, no: 0 };
    for (const vote of votes.days) if (dayCounts[vote.date]) dayCounts[vote.date]![vote.answer]++;
  }
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader
        back={{ href: `/trips/${id}`, label: doc.trip.title }}
        title="Głosowanie"
        actions={mayEdit && <EditToggle editing={mayEdit && wantsEdit} />}
        intro={<>Głos to podpowiedź dla organizatora: wybór wariantu i termin ustala on (albo edytor). Głosować można nad wyborami, które otworzył; wyniki widzą wszyscy uczestnicy.</>}
      />
      <VoteBoard
        tripId={id}
        people={people}
        travelerCount={doc.travelers.length}
        groups={groups}
        poll={poll.success ? poll.data : null}
        length={length}
        terms={poll.success ? bestTerms(doc, poll.data, votes, length) : []}
        answers={answers}
        dayCounts={dayCounts}
        trip={{ startDate: doc.trip.startDate, endDate: doc.trip.endDate, today }}
        canEdit={mayEdit && wantsEdit}
        mayEdit={mayEdit}
        climate={climateSource(payload)}
      />
    </>
  );
}
