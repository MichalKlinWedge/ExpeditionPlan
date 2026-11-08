import { SPEECH_VOICES } from "@expeditionplan/ai";
import { audioFits, dayMap, type DayMap, scenesToRecord } from "@expeditionplan/core";
import { dbLoadError, type PullPayload } from "@expeditionplan/sync";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { EditToggle } from "@/components/edit-toggle";
import { type EditorScene, ShowEditor } from "@/components/show-editor";
import { type PlayerScene, ShowPlayer, type ShowMapData } from "@/components/show-player";
import { Loading, Shell } from "@/components/shell";
import { requireUser } from "@/lib/auth";
import { editMode } from "@/lib/edit-mode";
import { loadShow } from "@/lib/trip-show";

export const metadata: Metadata = { title: "Pokaz z lektorem — Expedition Planner" };

/** Nagranie jednej sceny trwa kilka–kilkanaście sekund; szkic tekstu z AI do ok. minuty. */
export const maxDuration = 120;

/**
 * Pokaz z lektorem: wyjazd jako film do obejrzenia na ekranie — przed wyjazdem zapowiedź, po nim wspomnienie
 * (`core/trip-show.ts`). Ogląda każdy uczestnik; tekst lektora i nagrania przygotowuje organizator albo edytor w trybie edycji.
 */
export default function ShowPage(props: PageProps<"/trips/[id]/show">) {
  return (
    <Shell wide>
      <Suspense fallback={<Loading />}>
        <View params={props.params} />
      </Suspense>
    </Shell>
  );
}

/** Mapa sceny bez dojazdów i powrotów (lot przez pół Europy gubi szczegóły na miejscu), chyba że nic innego nie ma. */
function sceneMap(map: DayMap): ShowMapData {
  const local = { lines: map.lines.filter((line) => !line.transit), pins: map.pins.filter((pin) => !pin.transit) };
  const used = local.pins.length > 0 ? local : map;
  return {
    lines: used.lines.map((line) => ({ coordinates: line.coordinates as [number, number][], routed: line.routed })),
    pins: used.pins.map((pin) => ({ lng: pin.lng, lat: pin.lat, name: pin.name })),
  };
}

async function View({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireUser(`/trips/${id}/show`);
  const [{ data, error }, membership] = await Promise.all([supabase.rpc("pull_changes", { p_trip: id, p_since: 0 }), supabase.from("my_trips").select("role").eq("id", id).maybeSingle()]);
  if (error) return <p className="text-sm text-red-600">{dbLoadError(error)}</p>;
  if (data === null) notFound();
  let loaded: Awaited<ReturnType<typeof loadShow>>;
  try {
    loaded = await loadShow(supabase, id, data as PullPayload, { photos: true });
  } catch (e) {
    return <p className="text-sm text-red-600">Plan w bazie nie przechodzi walidacji: {e instanceof Error ? e.message : String(e)}</p>;
  }
  const { doc, scenes, credits, script } = loaded;
  const mayEdit = membership.data?.role === "owner" || membership.data?.role === "editor";
  const canEdit = mayEdit && (await editMode());

  const narration = new Map(script.scenes.map((scene) => [scene.key, scene]));
  const playable = script.scenes.filter((scene) => audioFits(scene, script.voice));
  const audioUrls = new Map<string, string>();
  if (playable.length > 0) {
    const { data: signed } = await supabase.storage.from("show_audio").createSignedUrls(playable.map((scene) => scene.audio!.path), 3600);
    for (const each of signed ?? []) if (each.path && each.signedUrl && !each.error) audioUrls.set(each.path, each.signedUrl);
  }

  const maps = new Map<string, ShowMapData>();
  const mapFor = (refs: string[]) => {
    const key = refs.join(",");
    if (!maps.has(key)) maps.set(key, sceneMap(dayMap(doc, refs)));
    return maps.get(key)!;
  };
  const player: PlayerScene[] = scenes.map((scene) => {
    const told = narration.get(scene.key);
    const url = told && audioFits(told, script.voice) ? audioUrls.get(told.audio.path) : undefined;
    return {
      key: scene.key,
      kind: scene.kind,
      heading: scene.heading,
      ...(scene.subheading ? { subheading: scene.subheading } : {}),
      text: told?.text ?? "",
      images: scene.images,
      map: mapFor(scene.routeRefs),
      ...(url !== undefined && told?.audio ? { audio: { url, durationMs: told.audio.durationMs } } : {}),
    };
  });
  const editor: EditorScene[] = scenes.map((scene) => {
    const told = narration.get(scene.key);
    const fits = told !== undefined && audioFits(told, script.voice);
    return {
      key: scene.key,
      heading: scene.heading,
      ...(scene.subheading ? { subheading: scene.subheading } : {}),
      text: told?.text ?? "",
      edited: told?.edited === true,
      status: fits ? "ready" : told && told.text.trim() !== "" ? "stale" : "none",
      ...(fits ? { seconds: Math.round(told.audio.durationMs / 1000) } : {}),
    };
  });
  const keys = new Set(scenes.map((scene) => scene.key));
  const toRecord = scenesToRecord(script).filter((key) => keys.has(key));
  const recorded = player.filter((scene) => scene.audio).length;
  const written = player.filter((scene) => scene.text.trim() !== "").length;

  return (
    <>
      <div className="flex flex-col gap-1">
        <Link href={`/trips/${id}`} className="back-link">
          ← {doc.trip.title}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h1 className="text-2xl font-semibold">Pokaz z lektorem</h1>
          {mayEdit && <EditToggle editing={canEdit} />}
        </div>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {written === 0
            ? mayEdit
              ? "Mapy i zdjęcia są gotowe z planu. Tekst lektora przygotujesz w trybie edycji."
              : "Mapy i zdjęcia z planu; lektora organizator jeszcze nie przygotował."
            : `Lektor w ${recorded} z ${player.length} scen${written > recorded ? `, w ${written - recorded} na razie same napisy` : ""}.`}
        </p>
      </div>
      <ShowPlayer scenes={player} credits={credits} />
      {canEdit && <ShowEditor tripId={id} scenes={editor} voice={script.voice} voices={SPEECH_VOICES} toRecord={toRecord} />}
    </>
  );
}
