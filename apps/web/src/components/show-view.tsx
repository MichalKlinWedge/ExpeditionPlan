import { SPEECH_VOICES } from "@expeditionplan/ai";
import { audioFits, scenesToRecord, type ShowImage, showImageKey, type ShowKind } from "@expeditionplan/core";
import { dbLoadError, type PullPayload } from "@expeditionplan/sync";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EditToggle } from "@/components/edit-toggle";
import { PublicShowToggle } from "@/components/public-show-toggle";
import { type EditorPhoto, type EditorScene, ShowEditor, ShowEndPhoto, ShowMusicEditor, ShowRouteOptions } from "@/components/show-editor";
import { ShowPlayer } from "@/components/show-player";
import { requireUser } from "@/lib/auth";
import { editMode } from "@/lib/edit-mode";
import { tripDates } from "@/lib/labels";
import { chosenVariantsFromCookie } from "@/lib/plan-variants-server";
import { SHOW_PAGES } from "@/lib/show-pages";
import { loadShow, playerMusic, playerScenes, showPath } from "@/lib/trip-show";

/**
 * Strona pokazu z lektorem danego rodzaju (`/trips/[id]/show` zapowiedź, `/trips/[id]/film` film z wyjazdu): odtwarzacz
 * z eksportem do MP4, zgoda na publiczny link (właściciel) i edycja (organizator i edytor w trybie edycji).
 */
export async function ShowView({ params, kind }: { params: Promise<{ id: string }>; kind: ShowKind }) {
  const { id } = await params;
  const page = SHOW_PAGES[kind];
  const { supabase } = await requireUser(showPath(id, kind));
  const [{ data, error }, membership, share] = await Promise.all([
    supabase.rpc("pull_changes", { p_trip: id, p_since: 0 }),
    supabase.from("my_trips").select("role").eq("id", id).maybeSingle(),
    supabase.from("public_shares").select("enabled, show, film").eq("trip_id", id).maybeSingle(),
  ]);
  if (error) return <p className="text-sm msg-error">{dbLoadError(error)}</p>;
  if (data === null) notFound();
  let loaded: Awaited<ReturnType<typeof loadShow>>;
  try {
    loaded = await loadShow(supabase, id, data as PullPayload, { photos: true, kind, variants: await chosenVariantsFromCookie(id) });
  } catch (e) {
    return <p className="text-sm msg-error">Plan w bazie nie przechodzi walidacji: {e instanceof Error ? e.message : String(e)}</p>;
  }
  const { doc, scenes, credits, spare, script } = loaded;
  const journalPhotos = ((data as PullPayload).tables as unknown as { journal_entries?: { photo_path: string | null; deleted_at?: string | null }[] }).journal_entries?.filter((row) => row.photo_path && !row.deleted_at).length ?? 0;
  const mayEdit = membership.data?.role === "owner" || membership.data?.role === "editor";
  const canEdit = mayEdit && (await editMode());

  const narration = new Map(script.scenes.map((scene) => [scene.key, scene]));
  const asPhoto = (image: ShowImage): EditorPhoto => ({ key: showImageKey(image), url: image.url, caption: image.caption });
  // Zdjęcia do wyboru w scenach: własne zdjęcia każdego dnia i zakończenia (`ShowScene.pool`), na końcu z opisów miejsc spoza planu dni.
  const photoSources = [
    ...scenes.flatMap((scene) => (scene.pool && scene.pool.length > 0 ? [{ key: scene.key, heading: scene.kind === "outro" ? "Zakończenie" : scene.heading, photos: scene.pool.map(asPhoto) }] : [])),
    ...(spare.length > 0 ? [{ key: "spare", heading: "Z opisów miejsc spoza planu dni", photos: spare.map(asPhoto) }] : []),
  ];
  const [player, music] = await Promise.all([playerScenes(supabase, doc, scenes, script), playerMusic(supabase, script)]);
  const editor: EditorScene[] = scenes.map((scene) => {
    const told = narration.get(scene.key);
    const fits = told !== undefined && audioFits(told, script.voice);
    const subheading = scene.kind === "about" ? script.destination : scene.subheading;
    return {
      key: scene.key,
      heading: scene.heading,
      ...(subheading ? { subheading } : {}),
      text: told?.text ?? "",
      edited: told?.edited === true,
      status: told === undefined || told.text.trim() === "" ? "none" : fits ? "ready" : told.audio ? "old" : "new",
      ...(fits ? { seconds: Math.round(told.audio.durationMs / 1000) } : {}),
      // Dni i zakończenie wybierają spośród zdjęć całego wyjazdu: najpierw własne, potem innych scen w kolejności filmu.
      ...((scene.kind === "day" || scene.kind === "outro") && photoSources.length > 0
        ? {
            photos: {
              auto: scene.chosen !== true,
              shown: scene.images.map(asPhoto),
              groups: [...photoSources.filter((source) => source.key === scene.key), ...photoSources.filter((source) => source.key !== scene.key)].map((source) => ({
                heading: source.key === scene.key ? "Z tej sceny" : source.heading,
                own: source.key === scene.key,
                photos: source.photos,
              })),
            },
          }
        : {}),
    };
  });
  const keys = new Set(scenes.map((scene) => scene.key));
  const toRecord = scenesToRecord(script).filter((key) => keys.has(key));
  const recorded = player.filter((scene) => scene.audio).length;
  const approach = scenes.find((scene) => scene.kind === "intro")?.approach;
  // Kandydaci na zdjęcie przed planszą końcową: wszystkie zdjęcia dni w kolejności filmu, także niepokazane w scenach.
  const days = scenes.filter((scene) => scene.kind === "day");
  const endCandidates = days.flatMap((scene) => scene.pool ?? scene.images).map(asPhoto);
  const lastPhoto = days.flatMap((scene) => scene.images).at(-1);
  const back = scenes.find((scene) => scene.kind === "outro")?.approach;
  const written = player.filter((scene) => scene.text.trim() !== "").length;

  return (
    <>
      <div className="flex flex-col gap-1">
        <Link href={`/trips/${id}`} className="back-link">
          ← {doc.trip.title}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h1 className="text-2xl font-semibold">{page.title}</h1>
            <p className="text-sm text-zinc-500">{page.about}</p>
          </div>
          {mayEdit && <EditToggle editing={canEdit} />}
        </div>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {written === 0
            ? mayEdit
              ? `${page.ready} Tekst lektora przygotujesz w trybie edycji.`
              : `${page.ready} Lektora organizator jeszcze nie przygotował.`
            : `Lektor w ${recorded} z ${player.length} scen${written > recorded ? `, w ${written - recorded} na razie same napisy` : ""}.`}
        </p>
      </div>
      <ShowPlayer exportable scenes={player} credits={credits} {...(music ? { music } : {})} trip={{ title: doc.trip.title, dates: tripDates(doc.trip.startDate, doc.trip.endDate), label: page.label }} />
      {kind === "film" && journalPhotos === 0 && <p className="card p-4 text-sm text-zinc-600 dark:text-zinc-400">Dziennik nie ma jeszcze zdjęć: film bierze je z dziennika (telefon albo strona „Dziennik”), a do tego czasu pokazuje mapy i zdjęcia z opisów miejsc.</p>}
      {membership.data?.role === "owner" && <PublicShowToggle tripId={id} kind={kind} linkOn={share.data?.enabled === true} showOn={share.data?.enabled === true && (kind === "film" ? share.data.film : share.data.show) === true} />}
      {canEdit && <ShowEditor tripId={id} kind={kind} scenes={editor} voice={script.voice} voices={SPEECH_VOICES} toRecord={toRecord} />}
      {canEdit && <ShowMusicEditor tripId={id} kind={kind} music={music ?? null} />}
      {canEdit && (
        <ShowRouteOptions
          tripId={id}
          kind={kind}
          approach={approach ? { on: script.showApproach, title: `${approach.title}${approach.facts ? ` · ${approach.facts}` : ""}` } : null}
          back={back ? { on: script.showReturn, title: `${back.title}${back.facts ? ` · ${back.facts}` : ""}` } : null}
        />
      )}
      {canEdit && <ShowEndPhoto tripId={id} kind={kind} choice={script.endPhoto} photos={endCandidates} last={lastPhoto === undefined ? undefined : showImageKey(lastPhoto)} />}
    </>
  );
}
