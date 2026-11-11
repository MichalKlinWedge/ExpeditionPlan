"use server";

import { isSpeechVoice, SpeechLimitError } from "@expeditionplan/ai";
import { applyShowDraft, BriefLocation, destinationLine, droppedAudio, editShowText, isShowKind, isShowMusicPath, INTRO_PARTS, type IntroParts, introParts, narrationHash, OUTRO_PARTS, type OutroParts, outroParts, plural, SCENE_PHOTOS_MAX, setIntroParts, setOutroParts, setScenePhotos, type ShowKind, ShowScript, setShowAudio, setShowLocked, showBrief } from "@expeditionplan/core";
import type { Json } from "@expeditionplan/db";
import { draftShowNarration } from "@expeditionplan/planner";
import { refresh } from "next/cache";

import type { FormState } from "@/app/actions";
import { aiAccessError, geminiClient, speechSetup } from "@/lib/ai";
import { requireUser } from "@/lib/auth";
import { chosenVariantsFromCookie } from "@/lib/plan-variants-server";
import { loadShow, showPath } from "@/lib/trip-show";
import { pullTrip } from "@/lib/trip-snapshot";

/**
 * Pokaz z lektorem (`core/trip-show.ts`), zapowiedź albo film z wyjazdu (`kind`, osobne scenariusze): szkic tekstu z AI, ręczne poprawki, głos i nagrania scen (Gemini TTS).
 * Zapisują organizator i edytor (RLS `trip_shows`, bucket `show_audio`); AI i nagrania tylko dla `AI_ALLOWED_EMAILS`.
 * Nagrania idą po jednej scenie na wywołanie: przeglądarka woła kolejne i pokazuje postęp, a żadne wywołanie nie trwa minut.
 */

type Supabase = Awaited<ReturnType<typeof requireUser>>["supabase"];

async function load(tripId: string, kind: ShowKind) {
  if (!isShowKind(kind)) return { error: "Nieznany rodzaj pokazu." } as const;
  const { supabase } = await requireUser(showPath(tripId, kind));
  const pulled = await pullTrip(supabase, tripId);
  if (pulled.error !== undefined) return { error: pulled.error } as const;
  try {
    // Tekst lektora i nagrania z tymi samymi wariantami dnia, które pokazuje strona pokazu.
    return { supabase, ...(await loadShow(supabase, tripId, pulled.payload, { kind, variants: await chosenVariantsFromCookie(tripId) })) } as const;
  } catch (e) {
    return { error: `Plan w bazie nie przechodzi walidacji: ${e instanceof Error ? e.message : String(e)}` } as const;
  }
}

/** Zapis scenariusza i usunięcie plików, których już nie używa. */
async function save(supabase: Supabase, tripId: string, kind: ShowKind, before: ShowScript, after: ShowScript): Promise<string | null> {
  const { error } = await supabase
    .from("trip_shows")
    .upsert({ trip_id: tripId, kind, content: after as unknown as NonNullable<Json>, updated_at: new Date().toISOString() }, { onConflict: "trip_id,kind" });
  if (error) return error.code === "42501" ? "Pokaz zmienia tylko organizator albo edytor." : `Nie zapisano pokazu: ${error.message}`;
  const dropped = droppedAudio(before, after);
  if (dropped.length > 0) await supabase.storage.from("show_audio").remove(dropped);
  return null;
}

export async function draftShow(tripId: string, kind: ShowKind): Promise<FormState> {
  const denied = await aiAccessError();
  if (denied) return { error: denied };
  const gemini = geminiClient();
  if (gemini === null) return { error: "Serwer nie ma klucza GEMINI_API_KEY." };
  const loaded = await load(tripId, kind);
  if ("error" in loaded) return { error: loaded.error };
  const { supabase, doc, scenes, script } = loaded;
  // Kraj i miejsca z briefu do sceny „Dokąd jedziemy” (brief bywa niepełny albo go nie ma: wtedy same noclegi z planu).
  const { data: briefRow } = await supabase.from("trip_brief").select("brief").eq("trip_id", tripId).maybeSingle();
  const location = BriefLocation.safeParse((briefRow?.brief as { location?: unknown } | null | undefined)?.location);
  const destination = location.success ? { countries: location.data.countries, places: location.data.places } : undefined;
  try {
    const draft = await draftShowNarration(gemini.client, showBrief(doc, scenes, kind, destination), { timeoutMs: 120_000 });
    const drafted = applyShowDraft(script, scenes, draft);
    const next = destination ? { ...drafted, destination: destinationLine(destination) } : drafted;
    const failed = await save(supabase, tripId, kind, script, next);
    if (failed) return { error: failed };
    const kept = script.scenes.filter((scene) => scene.edited && scene.text.trim() !== "").length;
    refresh();
    return { ok: `Tekst lektora gotowy: ${plural(next.scenes.length - kept, ["scena", "sceny", "scen"])} z AI${kept > 0 ? `, zatwierdzone zostały bez zmian (${kept})` : ""}. Przeczytaj go przed nagraniem.` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function saveShowText(tripId: string, kind: ShowKind, key: string, text: string): Promise<FormState> {
  const loaded = await load(tripId, kind);
  if ("error" in loaded) return { error: loaded.error };
  const { supabase, scenes, script } = loaded;
  if (!scenes.some((scene) => scene.key === key)) return { error: "Tej sceny nie ma już w planie." };
  const next = editShowText(script, key, text);
  if (next === script) return { ok: "Bez zmian." };
  const failed = await save(supabase, tripId, kind, script, next);
  if (failed) return { error: failed };
  refresh();
  return { ok: "Zapisano." };
}

/** „Zatwierdzone” przy tekście sceny: zaznaczone — nowy szkic AI go nie zmieni; odznaczone — napisze go od nowa. */
export async function setShowTextLock(tripId: string, kind: ShowKind, key: string, locked: boolean): Promise<FormState> {
  const loaded = await load(tripId, kind);
  if ("error" in loaded) return { error: loaded.error };
  const { supabase, script } = loaded;
  const next = setShowLocked(script, key, locked);
  if (next === script) return { ok: "Bez zmian." };
  const failed = await save(supabase, tripId, kind, script, next);
  if (failed) return { error: failed };
  refresh();
  return { ok: locked ? "Zatwierdzone: AI tego tekstu nie zmieni." : "AI może napisać ten tekst od nowa." };
}

export async function setShowVoice(tripId: string, kind: ShowKind, voice: string): Promise<FormState> {
  if (!isSpeechVoice(voice)) return { error: `Nie ma głosu „${voice}”.` };
  const loaded = await load(tripId, kind);
  if ("error" in loaded) return { error: loaded.error };
  const { supabase, script } = loaded;
  if (script.voice === voice) return { ok: "Bez zmian." };
  const failed = await save(supabase, tripId, kind, script, { ...script, voice });
  if (failed) return { error: failed };
  refresh();
  return { ok: "Głos zmieniony: nagraj sceny od nowa." };
}

/**
 * Podkład muzyczny po wgraniu pliku z przeglądarki (`showMusicFile`, bucket `show_audio`); `null` usuwa podkład.
 * Poprzedni plik usuwa `save` (`droppedAudio`), głośność zostaje.
 */
export async function setShowMusic(tripId: string, kind: ShowKind, music: { path: string; name: string } | null): Promise<FormState> {
  if (music !== null && !isShowMusicPath(tripId, music.path)) return { error: "To nie jest plik podkładu tego wyjazdu." };
  const loaded = await load(tripId, kind);
  if ("error" in loaded) return { error: loaded.error };
  const { supabase, script } = loaded;
  let next: ShowScript;
  if (music === null) {
    if (script.music === undefined) return { ok: "Bez zmian." };
    next = { ...script };
    delete next.music;
  } else {
    next = { ...script, music: { path: music.path, name: music.name.trim().slice(0, 200) || "podkład", volume: script.music?.volume ?? 0.5, skipS: 0 } };
  }
  const failed = await save(supabase, tripId, kind, script, next);
  if (failed) return { error: failed };
  refresh();
  return { ok: music === null ? "Usunięto podkład." : "Podkład zapisany." };
}

/**
 * Ustawienia podkładu: głośność między scenami (5–100%; pod lektorem odtwarzacz ścisza go jeszcze bardziej)
 * i ile sekund z początku pliku pominąć (0–3600, co 0,1 s).
 */
export async function setShowMusicSettings(tripId: string, kind: ShowKind, settings: { percent?: number; skipS?: number }): Promise<FormState> {
  const { percent, skipS } = settings;
  if (percent !== undefined && (!Number.isFinite(percent) || percent < 5 || percent > 100)) return { error: "Głośność od 5 do 100%." };
  if (skipS !== undefined && (!Number.isFinite(skipS) || skipS < 0 || skipS > 3600)) return { error: "Początek do pominięcia: od 0 do 3600 s." };
  const loaded = await load(tripId, kind);
  if ("error" in loaded) return { error: loaded.error };
  const { supabase, script } = loaded;
  if (script.music === undefined) return { error: "Pokaz nie ma podkładu." };
  const music = {
    ...script.music,
    ...(percent !== undefined ? { volume: Math.round(percent) / 100 } : {}),
    ...(skipS !== undefined ? { skipS: Math.round(skipS * 10) / 10 } : {}),
  };
  if (music.volume === script.music.volume && music.skipS === script.music.skipS) return { ok: "Bez zmian." };
  const failed = await save(supabase, tripId, kind, script, { ...script, music });
  if (failed) return { error: failed };
  refresh();
  return { ok: "Zapisano ustawienia podkładu." };
}

/** Pola „pokaż” pierwszej sceny (`ShowScript.intro`): mapa dojazdu, mapa trasy, kolaże, plansza „Kto jedzie i plan”. */
export async function setShowIntro(tripId: string, kind: ShowKind, change: Partial<IntroParts>): Promise<FormState> {
  if (typeof change !== "object" || change === null || Object.entries(change).some(([key, value]) => !(INTRO_PARTS as readonly string[]).includes(key) || typeof value !== "boolean")) return { error: "Nieprawidłowe ustawienie wstępu." };
  const loaded = await load(tripId, kind);
  if ("error" in loaded) return { error: loaded.error };
  const { supabase, script } = loaded;
  const before = introParts(script, kind);
  if (INTRO_PARTS.every((part) => change[part] === undefined || change[part] === before[part])) return { ok: "Bez zmian." };
  const failed = await save(supabase, tripId, kind, script, setIntroParts(script, change));
  if (failed) return { error: failed };
  refresh();
  return { ok: "Zapisano." };
}

/** Pola „pokaż” ostatniej sceny (`ShowScript.outro`): mapa powrotu, mapa trasy, zdjęcia jako kolaż albo po kolei. */
export async function setShowOutro(tripId: string, kind: ShowKind, change: Partial<OutroParts>): Promise<FormState> {
  if (typeof change !== "object" || change === null || Object.entries(change).some(([key, value]) => !(OUTRO_PARTS as readonly string[]).includes(key) || typeof value !== "boolean")) return { error: "Nieprawidłowe ustawienie zakończenia." };
  const loaded = await load(tripId, kind);
  if ("error" in loaded) return { error: loaded.error };
  const { supabase, script } = loaded;
  const before = outroParts(script);
  if (OUTRO_PARTS.every((part) => change[part] === undefined || change[part] === before[part])) return { ok: "Bez zmian." };
  const failed = await save(supabase, tripId, kind, script, setOutroParts(script, change));
  if (failed) return { error: failed };
  refresh();
  return { ok: "Zapisano." };
}

/**
 * Zdjęcia jednej sceny (`ShowScript.photos`): klucze zdjęć w kolejności pokazu, `[]` = bez zdjęć, `null` = automatycznie.
 * Klucz spoza puli sceny pokaz pominie (`scenePhotos`), więc tu wystarczy kształt.
 */
export async function setShowScenePhotos(tripId: string, kind: ShowKind, sceneKey: string, keys: string[] | null): Promise<FormState> {
  if (typeof sceneKey !== "string" || sceneKey.length > 200) return { error: "Nieprawidłowa scena." };
  if (keys !== null && (!Array.isArray(keys) || keys.length > SCENE_PHOTOS_MAX || keys.some((key) => typeof key !== "string" || key.length === 0 || key.length > 1000))) return { error: "Nieprawidłowe zdjęcia." };
  const loaded = await load(tripId, kind);
  if ("error" in loaded) return { error: loaded.error };
  const { supabase, scenes, script } = loaded;
  if (!scenes.some((scene) => scene.key === sceneKey)) return { error: "Tej sceny nie ma już w pokazie." };
  const next = setScenePhotos(script, sceneKey, keys);
  if (JSON.stringify(next.photos ?? null) === JSON.stringify(script.photos ?? null)) return { ok: "Bez zmian." };
  const failed = await save(supabase, tripId, kind, script, next);
  if (failed) return { error: failed };
  refresh();
  return { ok: "Zapisano zdjęcia sceny." };
}

/** Ile przeglądarka czeka przy limicie minutowym: tyle, ile podał Google, w rozsądnych granicach. */
const waitFor = (seconds: number | null) => Math.min(Math.max(seconds ?? 30, 5), 90);

/**
 * Nagranie jednej sceny (`retake`: nowe ujęcie, także gdy nagranie pasuje). Bez `refresh`: przeglądarka odświeża stronę po ostatniej scenie. Limit zapytań (darmowy poziom
 * Gemini TTS przepuszcza kilka nagrań na minutę) zwraca `wait`: przeglądarka odczeka i ponowi.
 */
export async function recordShowScene(tripId: string, kind: ShowKind, key: string, retake = false): Promise<FormState & { wait?: number; seconds?: number }> {
  const denied = await aiAccessError();
  if (denied) return { error: denied };
  const setup = await speechSetup();
  if ("error" in setup) return { error: setup.error };
  const loaded = await load(tripId, kind);
  if ("error" in loaded) return { error: loaded.error };
  const { supabase, script } = loaded;
  const scene = script.scenes.find((each) => each.key === key);
  if (scene === undefined || scene.text.trim() === "") return { error: "Ta scena nie ma tekstu do nagrania." };

  try {
    const { speech, model } = await setup.speak(scene.text, script.voice);
    const hash = narrationHash(scene.text, script.voice, model);
    // Nowe ujęcie tego samego tekstu („Nagraj od nowa wszystko”) idzie pod nową nazwą: stary plik usuwa `save` (`droppedAudio`).
    // Film ma własne pliki: ten sam tekst w zapowiedzi i filmie nie dzieli nagrania (usunięcie w jednym nie rusza drugiego).
    const name = `${tripId}/${kind === "film" ? "film-" : ""}${hash}`;
    const path = retake ? `${name}-${Date.now().toString(36)}.wav` : `${name}.wav`;
    const { error: uploadError } = await supabase.storage.from("show_audio").upload(path, speech.audio, { contentType: "audio/wav" });
    // Ten sam tekst, głos i model to ten sam plik: już wgrany wystarczy.
    if (uploadError && !/exists|duplicate/i.test(uploadError.message)) {
      return { error: /row-level security|unauthorized/i.test(uploadError.message) ? "Nagrania dodaje tylko organizator albo edytor." : `Nie zapisano nagrania: ${uploadError.message}` };
    }
    // Świeży odczyt: w trakcie nagrywania ktoś mógł zmienić tekst albo inną scenę.
    const { data: current } = await supabase.from("trip_shows").select("content").eq("trip_id", tripId).eq("kind", kind).maybeSingle();
    const latest = ShowScript.safeParse(current?.content ?? {});
    const base = latest.success ? latest.data : script;
    if (base.voice !== script.voice) return { error: "W trakcie nagrywania zmienił się głos. Nagraj jeszcze raz." };
    const next = setShowAudio(base, key, { path, hash, model, durationMs: speech.durationMs }, scene.text);
    if (next.scenes.find((each) => each.key === key)?.audio?.path !== path) return { error: "W trakcie nagrywania zmienił się tekst sceny. Nagraj jeszcze raz." };
    const failed = await save(supabase, tripId, kind, base, next);
    if (failed) return { error: failed };
    const seconds = Math.round(speech.durationMs / 1000);
    return { ok: `Nagrano ${seconds} s.`, seconds };
  } catch (e) {
    // Limit dzienny: czekanie nic nie da, przeglądarka staje z komunikatem.
    if (e instanceof SpeechLimitError) return e.limit.daily ? { error: e.message } : { error: e.message, wait: waitFor(e.limit.retryAfterS) };
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** Zdanie próbki głosu: krótkie (grosze za nagranie), bez nazw z planu, więc jedno na głos i model. */
const SAMPLE_TEXT = "Dzień dobry, tak brzmi ten głos. Opowiem wam o wyjeździe, dzień po dniu.";

/**
 * Próbka głosu przed wyborem: nagranie raz na głos i model, trzymane w buckecie wyjazdu (`<trip>/probka-<hash>.wav`,
 * nie w scenariuszu, więc `droppedAudio` go nie rusza); kolejne odsłuchanie tylko podpisuje plik.
 */
export async function voiceSample(tripId: string, voice: string): Promise<FormState & { url?: string }> {
  if (!isSpeechVoice(voice)) return { error: `Nie ma głosu „${voice}”.` };
  const denied = await aiAccessError();
  if (denied) return { error: denied };
  const setup = await speechSetup();
  if ("error" in setup) return { error: setup.error };
  const { supabase } = await requireUser(`/trips/${tripId}/show`);
  const bucket = supabase.storage.from("show_audio");
  // Próbka któregokolwiek z modeli mowy wystarczy: głos brzmi tak samo.
  const paths = setup.models.map((model) => `${tripId}/probka-${narrationHash(SAMPLE_TEXT, voice, model)}.wav`);
  const { data: ready } = await bucket.createSignedUrls(paths, 3600);
  const found = ready?.find((each) => each.signedUrl && !each.error);
  if (found?.signedUrl) return { ok: "Próbka gotowa.", url: found.signedUrl };
  try {
    const { speech, model } = await setup.speak(SAMPLE_TEXT, voice);
    const path = `${tripId}/probka-${narrationHash(SAMPLE_TEXT, voice, model)}.wav`;
    const { error } = await bucket.upload(path, speech.audio, { contentType: "audio/wav" });
    if (error && !/exists|duplicate/i.test(error.message)) {
      return { error: /row-level security|unauthorized/i.test(error.message) ? "Próbki nagrywa tylko organizator albo edytor." : `Nie zapisano próbki: ${error.message}` };
    }
    const signed = await bucket.createSignedUrl(path, 3600);
    if (!signed.data?.signedUrl) return { error: `Nie podpisano próbki: ${signed.error?.message ?? "brak adresu"}` };
    return { ok: "Próbka gotowa.", url: signed.data.signedUrl };
  } catch (e) {
    if (e instanceof SpeechLimitError) return { error: e.limit.daily ? e.message : `${e.message} Spróbuj za ${waitFor(e.limit.retryAfterS)} s.` };
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Pokaz pod publicznym linkiem (`/p/<token>/show`): osobna zgoda właściciela, bo tekst i głos lektora mogą zawierać imiona
 * i kwoty, a zdjęcia z dziennika twarze (`public_shares.show`, RPC `set_public_show`). Link musi już istnieć.
 */
export async function setPublicShow(tripId: string, kind: ShowKind, on: boolean): Promise<FormState> {
  if (!isShowKind(kind)) return { error: "Nieznany rodzaj pokazu." };
  const { supabase } = await requireUser(showPath(tripId, kind));
  const { data, error } = await supabase.rpc("set_public_show", { p_trip: tripId, p_show: on, p_kind: kind });
  if (error) return { error: error.code === "42501" ? "Pokaz pod linkiem włącza tylko właściciel wyjazdu." : error.message };
  if (data !== true) return { error: "Najpierw utwórz publiczny link na stronie „Uczestnicy i dostęp”." };
  refresh();
  const tab = kind === "film" ? "Film z wyjazdu" : "Film zapowiedź";
  return { ok: on ? `Pokaz jest pod publicznym linkiem: zakładka „${tab}”.` : "Pokaz zniknął z publicznego linku." };
}
