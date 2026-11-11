import { dayChip, itemRouteRef, legLabel, plural, ROUTE_ICON, ROUTE_KIND, routeFacts, routeGroups, routeKindFor, routeLine, routeUsers, type TripDocument, unsavedCarRoutes } from "@expeditionplan/core";
import { dbLoadError, type PullPayload, stateFromPayload } from "@expeditionplan/sync";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { EditToggle } from "@/components/edit-toggle";
import { NewRoute } from "@/components/new-route";
import { PageHeader } from "@/components/page-header";
import { RouteCard, type RouteUseView, type RouteView } from "@/components/route-library";
import { Loading, Shell } from "@/components/shell";
import { UnsavedCarRoutes } from "@/components/unsaved-car-routes";
import { requireUser } from "@/lib/auth";
import { editMode } from "@/lib/edit-mode";

/**
 * „Trasy” wyjazdu (`core/route-library.ts`): ślady piesze i trasy autem niezależne od punktów planu, pogrupowane
 * w warianty tej samej drogi. Przy każdej: gdzie jest podpięta (karty punktów), a w trybie edycji podpięcie do
 * innego punktu, nazwa i usunięcie nieużywanej. Usunięcie punktu z planu trasy nie kasuje.
 */

export const metadata: Metadata = { title: "Trasy — Expedition Planner" };

export default function RoutesPage(props: PageProps<"/trips/[id]/routes">) {
  return (
    <Shell>
      <Suspense fallback={<Loading />}>
        <View params={props.params} />
      </Suspense>
    </Shell>
  );
}

type Doc = TripDocument;

/** Linia w polu 0–100 z poprawką na szerokość geograficzną (szkic, bez mapy). */
function sketch(line: [number, number][] | undefined): string | undefined {
  if (line === undefined) return undefined;
  const lngs = line.map((point) => point[0]);
  const lats = line.map((point) => point[1]);
  const [west, east, south, north] = [Math.min(...lngs), Math.max(...lngs), Math.min(...lats), Math.max(...lats)];
  const squeeze = Math.cos((((south + north) / 2) * Math.PI) / 180);
  const span = Math.max((east - west) * squeeze, north - south, 1e-5);
  const offX = (100 - ((east - west) * squeeze * 100) / span) / 2;
  const offY = (100 - ((north - south) * 100) / span) / 2;
  const step = Math.max(1, Math.floor(line.length / 300));
  return line
    .filter((_, index) => index % step === 0 || index === line.length - 1)
    .map(([lng, lat]) => `${(offX + ((lng - west) * squeeze * 100) / span).toFixed(1)},${(offY + ((north - lat) * 100) / span).toFixed(1)}`)
    .join(" ");
}

function itemView(doc: Doc, item: Doc["items"][number]): RouteUseView {
  const index = doc.days.findIndex((day) => day.ref === item.dayRef);
  return { ref: item.ref, title: item.title, day: index < 0 ? "pula" : `Dz. ${index + 1}, ${dayChip(doc.days[index]!.date)}` };
}

async function View({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireUser(`/trips/${id}/routes`);
  const [{ data, error }, membership] = await Promise.all([supabase.rpc("pull_changes", { p_trip: id, p_since: 0 }), supabase.from("my_trips").select("role").eq("id", id).maybeSingle()]);
  if (error) return <p className="text-sm msg-error">{dbLoadError(error)}</p>;
  if (data === null) notFound();
  let doc: Doc;
  try {
    doc = stateFromPayload(data as PullPayload).doc;
  } catch (e) {
    return <p className="text-sm msg-error">Plan w bazie nie przechodzi walidacji: {e instanceof Error ? e.message : String(e)}</p>;
  }
  const mayEdit = membership.data?.role === "owner" || membership.data?.role === "editor";
  const editing = mayEdit && (await editMode());
  const groups = routeGroups(doc);
  const unsaved = unsavedCarRoutes(doc);
  const view = (track: Doc["tracks"][number], kind: keyof typeof ROUTE_KIND): RouteView => {
    const ends = track.route?.from !== undefined && track.route.to !== undefined ? `${track.route.from.name} → ${track.route.to.name}` : undefined;
    const line = sketch(routeLine(track));
    return {
      ref: track.ref,
      name: track.name,
      icon: ROUTE_ICON[kind],
      facts: routeFacts(track),
      ...(ends !== undefined ? { ends } : {}),
      ...(track.url !== undefined ? { url: track.url } : {}),
      ...(line !== undefined ? { sketch: line } : {}),
      users: routeUsers(doc, track.ref).map((item) => itemView(doc, item)),
      candidates: editing ? doc.items.filter((item) => routeKindFor(item) === kind && itemRouteRef(item) !== track.ref).map((item) => itemView(doc, item)) : [],
    };
  };

  return (
    <>
      <PageHeader
        back={{ href: `/trips/${id}`, label: doc.trip.title }}
        title="Trasy"
        actions={mayEdit && <EditToggle editing={editing} />}
        intro={
          <>
            Trasy piesze (plik GPX, link z mapy) i autem (przeliczona trasa, „Jedź przez”, własny link). Zostają tu po usunięciu punktu z planu i można je podpiąć do innego punktu — tutaj albo na karcie punktu. Trasy z tym samym
            początkiem i końcem to warianty jednej drogi.
          </>
        }
      />
      {unsaved.length > 0 && <UnsavedCarRoutes tripId={id} editing={editing} routes={unsaved.map((item) => ({ ...itemView(doc, item), facts: legLabel(item) ?? "" }))} />}
      {editing && <NewRoute tripId={id} places={doc.places.filter((place) => place.lat !== undefined && place.lng !== undefined).map((place) => ({ ref: place.ref, name: place.name })).sort((a, b) => a.name.localeCompare(b.name, "pl"))} />}
      {groups.length === 0 ? (
        <section className="card p-4 text-sm">
          <h2 className="card-title">Brak tras</h2>
          <p className="text-zinc-600 dark:text-zinc-400">Trasa pojawi się tu po wgraniu pliku GPX albo linku z mapy przy przejściu, a przy przejeździe autem po „Zapisz w „Trasach”” na karcie punktu albo przeliczeniu trasy z „Jedź przez”. W trybie edycji możesz ją też dodać ręcznie.</p>
        </section>
      ) : (
        groups.map((group, index) => (
          <section key={group.tracks[0]!.ref} className="card flex flex-col gap-2 p-4 text-sm">
            <h2 className="card-title">
              {ROUTE_ICON[group.kind]} {group.from !== undefined && group.to !== undefined ? `${group.from} → ${group.to}` : group.tracks.length === 1 ? group.tracks[0]!.name : `Trasa ${index + 1}`}
              <span className="ml-2 text-sm font-normal text-zinc-500">
                {ROUTE_KIND[group.kind]}
                {group.tracks.length > 1 ? ` · ${plural(group.tracks.length, ["wariant", "warianty", "wariantów"])}` : ""}
              </span>
            </h2>
            <ul className="flex flex-col gap-2">
              {group.tracks.map((track) => (
                <RouteCard key={track.ref} tripId={id} route={view(track, group.kind)} editing={editing} />
              ))}
            </ul>
          </section>
        ))
      )}
    </>
  );
}
