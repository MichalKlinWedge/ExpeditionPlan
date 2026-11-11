import { dayChip, distanceM, formatMinutes, type LngLat, planPace, profileSketch, ROUTE_ICON, ROUTE_KIND, routeFacts, routeKind, routeLine, routeMap, routeUsers, trackProfile, trackSections, type TrackLine, type TripDocument } from "@expeditionplan/core";
import { dbLoadError, type PullPayload, stateFromPayload } from "@expeditionplan/sync";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { EditToggle } from "@/components/edit-toggle";
import { MemoriesMap } from "@/components/memories-map";
import { PageHeader } from "@/components/page-header";
import { RouteEditor, type RouteEditorValues } from "@/components/route-editor";
import { RouteSiteLink } from "@/components/route-site-link";
import { Loading, Shell } from "@/components/shell";
import { WalkProfile } from "@/components/walk-profile";
import { requireUser } from "@/lib/auth";
import { editMode } from "@/lib/edit-mode";

/**
 * Szczegóły jednej trasy z „Tras” (`core/route-library.ts`): mapa z linią i końcami, profil wysokości z odcinkami
 * (czas wg DIN 33466 dopasowany do czasu trasy), liczby, link, gdzie jest podpięta, a w trybie edycji jej edycja.
 * Godziny przejścia i zachód słońca są na karcie punktu, bo zależą od dnia.
 */

export const metadata: Metadata = { title: "Trasa — Expedition Planner" };

export default function RoutePage(props: PageProps<"/trips/[id]/routes/[ref]">) {
  return (
    <Shell>
      <Suspense fallback={<Loading />}>
        <View params={props.params} />
      </Suspense>
    </Shell>
  );
}

type Doc = TripDocument;

const TREND: Record<"up" | "down" | "flat", string> = { up: "↗ podejście", down: "↘ zejście", flat: "→ płasko" };
const round5 = (minutes: number) => Math.max(5, Math.round(minutes / 5) * 5);
const km = (value: number) => `${(Math.round(value * 10) / 10).toLocaleString("pl-PL")} km`;

/** Miejsce wyjazdu, którym jest zapisany koniec trasy (ta sama nazwa i blisko), `keep` — koniec spoza miejsc, `""` — brak. */
function endChoice(doc: Doc, end: { name: string; lat: number; lng: number } | undefined): string {
  if (end === undefined) return "";
  const at: LngLat = [end.lng, end.lat];
  const place = doc.places.find((each) => each.lat !== undefined && each.lng !== undefined && each.name === end.name && distanceM([each.lng, each.lat], at) < 100);
  return place?.ref ?? "keep";
}

async function View({ params }: { params: Promise<{ id: string; ref: string }> }) {
  const { id, ref: rawRef } = await params;
  const ref = decodeURIComponent(rawRef);
  const { supabase } = await requireUser(`/trips/${id}/routes/${rawRef}`);
  const [{ data, error }, membership] = await Promise.all([supabase.rpc("pull_changes", { p_trip: id, p_since: 0 }), supabase.from("my_trips").select("role").eq("id", id).maybeSingle()]);
  if (error) return <p className="text-sm msg-error">{dbLoadError(error)}</p>;
  if (data === null) notFound();
  let doc: Doc;
  try {
    doc = stateFromPayload(data as PullPayload).doc;
  } catch (e) {
    return <p className="text-sm msg-error">Plan w bazie nie przechodzi walidacji: {e instanceof Error ? e.message : String(e)}</p>;
  }
  const track = doc.tracks.find((each) => each.ref === ref);
  if (track === undefined) notFound();
  const mayEdit = membership.data?.role === "owner" || membership.data?.role === "editor";
  const editing = mayEdit && (await editMode());
  const kind = routeKind(track);
  const users = routeUsers(doc, track.ref);
  const map = routeMap(track);
  const line = routeLine(track) === undefined ? undefined : (track.geojson as TrackLine);
  const profile = line === undefined ? null : trackProfile(line);
  const sketch = profile === null ? null : profileSketch(profile, 160);
  const sections = line === undefined || profile?.hasElevation !== true ? [] : trackSections(line, { pace: planPace(trackSections(line), track.durationMin) });
  const ends = track.route?.from !== undefined || track.route?.to !== undefined ? `${track.route?.from?.name ?? "?"} → ${track.route?.to?.name ?? "?"}` : null;
  const facts = routeFacts(track);
  const dayOf = (item: Doc["items"][number]) => {
    const index = doc.days.findIndex((day) => day.ref === item.dayRef);
    return index < 0 ? "pula" : `Dz. ${index + 1}, ${dayChip(doc.days[index]!.date)}`;
  };
  const initial: RouteEditorValues = {
    name: track.name,
    kind,
    url: track.url ?? "",
    km: track.distanceKm?.toString() ?? "",
    time: track.durationMin?.toString() ?? "",
    ascent: track.ascentM?.toString() ?? "",
    descent: track.descentM?.toString() ?? "",
    difficulty: track.difficulty ?? "",
    waymarking: track.waymarking ?? "",
    notes: track.routeNotes ?? "",
    fromRef: endChoice(doc, track.route?.from),
    toRef: endChoice(doc, track.route?.to),
    hasLine: line !== undefined,
  };

  return (
    <>
      <PageHeader
        back={{ href: `/trips/${id}/routes#trasa-${encodeURIComponent(track.ref)}`, label: "Trasy" }}
        title={
          <>
            <span aria-hidden="true">{ROUTE_ICON[kind]}</span>
            {track.name}
          </>
        }
        actions={mayEdit && <EditToggle editing={editing} />}
        intro={<>{[ROUTE_KIND[kind], ends, facts].filter(Boolean).join(" · ")}</>}
      />

      <section className="card flex flex-col gap-2 p-4 text-sm">
        <h2 className="card-title">Szczegóły</h2>
        {ends && <p>{ends}</p>}
        {(facts || track.descentM !== undefined) && (
          <p>
            {facts}
            {track.descentM !== undefined ? ` · ↓ ${track.descentM} m` : ""}
          </p>
        )}
        {(track.difficulty || track.waymarking) && <p className="text-zinc-600 dark:text-zinc-400">{[track.difficulty, track.waymarking].filter(Boolean).join(" · ")}</p>}
        {track.routeNotes && <p className="whitespace-pre-line">{track.routeNotes}</p>}
        {track.url !== undefined && (
          <p className="flex items-center gap-1.5">
            Trasa na mapie: <RouteSiteLink url={track.url} />
          </p>
        )}
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-zinc-500">{users.length > 0 ? "Podpięta do:" : "Nie jest podpięta do żadnego punktu — podepniesz ją na liście „Trasy” albo na karcie punktu."}</span>
          {users.map((item) => (
            <Link key={item.ref} href={`/trips/${id}/item/${encodeURIComponent(item.ref)}`} className="btn-mini">
              {dayOf(item)} · {item.title}
            </Link>
          ))}
        </div>
      </section>

      <section className="card flex flex-col gap-2 p-4 text-sm">
        <h2 className="card-title">Mapa</h2>
        {map.pins.length === 0 && map.lines.length === 0 ? <p className="text-zinc-500">Trasa nie ma linii ani końców ze współrzędnymi: dodaj plik GPX albo skąd i dokąd w edycji.</p> : <MemoriesMap map={map} fitLines />}
        {line === undefined && map.pins.length > 0 && <p className="text-xs text-zinc-500">Bez linii: na mapie są tylko końce. Linię da plik GPX{kind === "car" ? " albo „Przelicz trasę” przy podpiętym przejeździe" : ""}.</p>}
      </section>

      {profile !== null && sketch !== null && (
        <section className="card flex flex-col gap-2 p-4 text-sm">
          <h2 className="card-title">Profil i trudność trasy</h2>
          <WalkProfile profile={sketch} minEle={profile.minEle!} maxEle={profile.maxEle!} />
          <p className="text-xs text-zinc-500">
            Najniżej {Math.round(profile.minEle!)} m, najwyżej {Math.round(profile.maxEle!)} m n.p.m. Godziny przejścia i zapas do zachodu słońca są na karcie podpiętego punktu.
          </p>
          {sections.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-zinc-500">
                  <tr>
                    <th className="py-1 pr-3 font-normal">Odcinek</th>
                    <th className="py-1 pr-3 font-normal">Kierunek</th>
                    <th className="py-1 pr-3 font-normal">Przewyższenie</th>
                    <th className="py-1 pr-3 font-normal">Wysokość</th>
                    <th className="py-1 pr-3 font-normal">Czas</th>
                    <th className="py-1 font-normal">Od startu</th>
                  </tr>
                </thead>
                <tbody>
                  {sections.map((section) => (
                    <tr key={section.fromKm} className="border-t border-zinc-200 dark:border-zinc-800">
                      <td className="py-1 pr-3">
                        {(Math.round(section.fromKm * 10) / 10).toLocaleString("pl-PL")}–{km(section.toKm)}
                      </td>
                      <td className="py-1 pr-3">{TREND[section.trend]}</td>
                      <td className="py-1 pr-3">
                        ↑ {section.ascentM} m ↓ {section.descentM} m
                      </td>
                      <td className="py-1 pr-3">{section.fromEle !== null && section.toEle !== null ? `${Math.round(section.fromEle)} → ${Math.round(section.toEle)} m` : "—"}</td>
                      <td className="py-1 pr-3">{formatMinutes(round5(section.minutes))}</td>
                      <td className="py-1">{formatMinutes(round5(section.endMin))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {sections.length > 0 && <p className="text-xs text-zinc-500">Czas wg DIN 33466 (4 km/h, 300 m/h w górę, 500 m/h w dół), liczony po odcinkach, bez postojów{track.durationMin !== undefined ? "; tempo dopasowane do czasu trasy" : ""}.</p>}
        </section>
      )}

      {editing && (
        <RouteEditor
          tripId={id}
          trackRef={track.ref}
          initial={initial}
          places={doc.places.filter((place) => place.lat !== undefined && place.lng !== undefined).map((place) => ({ ref: place.ref, name: place.name })).sort((a, b) => a.name.localeCompare(b.name, "pl"))}
          users={users.length}
        />
      )}
    </>
  );
}
