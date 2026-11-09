import { SPEECH_VOICES } from "@expeditionplan/ai";
import { audioFits, scenesToRecord } from "@expeditionplan/core";
import { dbLoadError, type PullPayload } from "@expeditionplan/sync";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { EditToggle } from "@/components/edit-toggle";
import { type EditorScene, ShowEditor, ShowMusicEditor } from "@/components/show-editor";
import { PublicShowToggle } from "@/components/public-show-toggle";
import { ShowPlayer } from "@/components/show-player";
import { tripDates } from "@/lib/labels";
import { Loading, Shell } from "@/components/shell";
import { requireUser } from "@/lib/auth";
import { editMode } from "@/lib/edit-mode";
import { loadShow, playerMusic, playerScenes } from "@/lib/trip-show";

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

async function View({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireUser(`/trips/${id}/show`);
  const [{ data, error }, membership, share] = await Promise.all([
    supabase.rpc("pull_changes", { p_trip: id, p_since: 0 }),
    supabase.from("my_trips").select("role").eq("id", id).maybeSingle(),
    supabase.from("public_shares").select("enabled, show").eq("trip_id", id).maybeSingle(),
  ]);
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
  const [player, music] = await Promise.all([playerScenes(supabase, doc, scenes, script), playerMusic(supabase, script)]);
  const editor: EditorScene[] = scenes.map((scene) => {
    const told = narration.get(scene.key);
    const fits = told !== undefined && audioFits(told, script.voice);
    return {
      key: scene.key,
      heading: scene.heading,
      ...(scene.subheading ? { subheading: scene.subheading } : {}),
      text: told?.text ?? "",
      edited: told?.edited === true,
      status: told === undefined || told.text.trim() === "" ? "none" : fits ? "ready" : told.audio ? "old" : "new",
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
      <ShowPlayer scenes={player} credits={credits} {...(music ? { music } : {})} trip={{ title: doc.trip.title, dates: tripDates(doc.trip.startDate, doc.trip.endDate) }} />
      {membership.data?.role === "owner" && <PublicShowToggle tripId={id} linkOn={share.data?.enabled === true} showOn={share.data?.enabled === true && share.data.show === true} />}
      {canEdit && <ShowEditor tripId={id} scenes={editor} voice={script.voice} voices={SPEECH_VOICES} toRecord={toRecord} />}
      {canEdit && <ShowMusicEditor tripId={id} music={music ?? null} />}
    </>
  );
}
