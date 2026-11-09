import "server-only";

import { audioFits, dayMap, type DayMap, guideFor, type GuideRow, ShowScript, showScenes, type TripDocument } from "@expeditionplan/core";
import { type PullPayload, refIndex, stateFromPayload } from "@expeditionplan/sync";

import type { PlayerMusic, PlayerScene, ShowMapData } from "@/components/show-player";
import type { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * Dane pokazu z lektorem z jednego `pull_changes`: sceny z planu (`showScenes`), zapisany scenariusz (`trip_shows`)
 * i opcjonalnie podpisane adresy zdjęć z dziennika. Wspólne dla strony pokazu, akcji (`app/show-actions.ts`)
 * i pokazu pod publicznym linkiem (`loadPublicShow`, ten sam film co w aplikacji).
 */

type Supabase = Awaited<ReturnType<typeof requireUser>>["supabase"];
type JournalRow = { day_id: string | null; body?: string; photo_path: string | null; taken_at: string; deleted_at?: string | null };
type Scenes = ReturnType<typeof showScenes>;

/** Dzisiejsza data w strefie wyjazdu: od niej zależy, czy lektor zapowiada, czy wspomina. */
export const todayIn = (tz: string) => new Intl.DateTimeFormat("sv-SE", { timeZone: tz }).format(new Date());

/** Sceny z dokumentu wyjazdu, opisów miejsc i zdjęć dziennika (podpisanych przez `sign`). */
async function scenesFrom(payload: PullPayload, journal: JournalRow[], sign: ((paths: string[]) => Promise<Map<string, string>>) | null) {
  const { doc, inputs } = stateFromPayload(payload);
  const ids = refIndex(payload.tables);
  const rows = (payload.tables as unknown as { audio_guides?: GuideRow[] }).audio_guides ?? [];
  const dayRef = new Map(Object.entries(ids).map(([ref, id]) => [id, ref]));
  const entries = journal.filter((row) => !row.deleted_at).sort((a, b) => a.taken_at.localeCompare(b.taken_at));
  const paths = entries.flatMap((row) => (row.photo_path ? [row.photo_path] : []));
  const signed = sign && paths.length > 0 ? await sign(paths) : new Map<string, string>();

  const today = todayIn(doc.trip.primaryTz);
  const { scenes, credits } = showScenes(doc, {
    ...inputs,
    today,
    guideOf: (item) => {
      if (item.kind === "lodging") return null;
      const placeRef = item.leg?.toPlaceRef ?? item.placeRef;
      return guideFor(rows, ids[item.ref], placeRef === undefined ? undefined : ids[placeRef]);
    },
    journal: entries.map((row) => {
      const day = row.day_id === null ? undefined : dayRef.get(row.day_id);
      const url = row.photo_path ? signed.get(row.photo_path) : undefined;
      return { body: row.body ?? "", ...(day !== undefined ? { dayRef: day } : {}), ...(url !== undefined ? { photoUrl: url } : {}) };
    }),
  });
  return { doc, today, scenes, credits };
}

const signer = (supabase: Supabase, bucket: string) => async (paths: string[]) => {
  const signed = new Map<string, string>();
  const { data } = await supabase.storage.from(bucket).createSignedUrls(paths, 3600);
  for (const each of data ?? []) if (each.path && each.signedUrl && !each.error) signed.set(each.path, each.signedUrl);
  return signed;
};

export async function loadShow(supabase: Supabase, tripId: string, payload: PullPayload, options: { photos?: boolean } = {}) {
  const journal = (payload.tables as unknown as { journal_entries?: JournalRow[] }).journal_entries ?? [];
  const { doc, today, scenes, credits } = await scenesFrom(payload, journal, options.photos ? signer(supabase, "journal") : null);
  const { data: stored, error } = await supabase.from("trip_shows").select("content").eq("trip_id", tripId).maybeSingle();
  const parsed = ShowScript.safeParse(stored?.content ?? {});
  return { doc, today, scenes, credits, script: parsed.success ? parsed.data : ShowScript.parse({}), exists: stored !== null, loadError: error?.message };
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

/** Sceny dla odtwarzacza: mapa, zdjęcia, tekst i podpisane nagranie, gdy pasuje do tekstu i głosu (`audioFits`). */
export async function playerScenes(supabase: Supabase, doc: TripDocument, scenes: Scenes["scenes"], script: ShowScript): Promise<PlayerScene[]> {
  const narration = new Map(script.scenes.map((scene) => [scene.key, scene]));
  const playable = script.scenes.filter((scene) => audioFits(scene, script.voice));
  const audioUrls = playable.length > 0 ? await signer(supabase, "show_audio")(playable.map((scene) => scene.audio!.path)) : new Map<string, string>();
  const maps = new Map<string, ShowMapData>();
  const mapFor = (refs: string[]) => {
    const key = refs.join(",");
    if (!maps.has(key)) maps.set(key, sceneMap(dayMap(doc, refs)));
    return maps.get(key)!;
  };
  return scenes.map((scene) => {
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
}

/** Podkład dla odtwarzacza: podpisany plik, głośność i nazwa (na ekranie końcowym). */
export async function playerMusic(supabase: Supabase, script: ShowScript): Promise<PlayerMusic | undefined> {
  if (script.music === undefined) return undefined;
  const url = (await signer(supabase, "show_audio")([script.music.path])).get(script.music.path);
  return url === undefined ? undefined : { url, volume: script.music.volume, name: script.music.name, skipS: script.music.skipS };
}

/**
 * Pokaz pod publicznym linkiem: plan z `public_trip` (te same filtry co reszta linku), scenariusz i zdjęcia dziennika
 * z `public_show`. Nagrania i zdjęcia podpisuje anon dzięki zgodzie właściciela (`public_shares.show`, polityki
 * `show_audio_public`, `journal_public_show`). `null`, gdy link wygasł albo pokazu pod nim nie ma.
 */
export async function loadPublicShow(token: string) {
  const supabase = await createClient();
  const [trip, show] = await Promise.all([supabase.rpc("public_trip", { p_token: token }), supabase.rpc("public_show", { p_token: token })]);
  if (trip.error || trip.data === null || show.error || show.data === null) return null;
  const payload = trip.data as unknown as PullPayload;
  const stored = show.data as { content?: unknown; journal?: JournalRow[] };
  const { doc, scenes, credits } = await scenesFrom(payload, stored.journal ?? [], signer(supabase, "journal"));
  const parsed = ShowScript.safeParse(stored.content ?? {});
  const script = parsed.success ? parsed.data : ShowScript.parse({});
  const [player, music] = await Promise.all([playerScenes(supabase, doc, scenes, script), playerMusic(supabase, script)]);
  return { doc, credits, player, music };
}

/** Czy pod publicznym linkiem jest pokaz (zakładka w nagłówku linku). */
export async function publicShowOn(token: string): Promise<boolean> {
  const { data } = await (await createClient()).rpc("public_show_on", { p_token: token });
  return data === true;
}
