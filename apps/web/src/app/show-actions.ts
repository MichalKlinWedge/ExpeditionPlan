"use server";

import { AiError, isSpeechVoice, speakGemini } from "@expeditionplan/ai";
import { applyShowDraft, droppedAudio, editShowText, narrationHash, plural, ShowScript, setShowAudio, showBrief } from "@expeditionplan/core";
import type { Json } from "@expeditionplan/db";
import { draftShowNarration } from "@expeditionplan/planner";
import { refresh } from "next/cache";

import type { FormState } from "@/app/actions";
import { aiAccessError, geminiClient, speechSetup } from "@/lib/ai";
import { requireUser } from "@/lib/auth";
import { loadShow } from "@/lib/trip-show";
import { pullTrip } from "@/lib/trip-snapshot";

/**
 * Pokaz z lektorem (`core/trip-show.ts`): szkic tekstu z AI, ręczne poprawki, głos i nagrania scen (Gemini TTS).
 * Zapisują organizator i edytor (RLS `trip_shows`, bucket `show_audio`); AI i nagrania tylko dla `AI_ALLOWED_EMAILS`.
 * Nagrania idą po jednej scenie na wywołanie: przeglądarka woła kolejne i pokazuje postęp, a żadne wywołanie nie trwa minut.
 */

type Supabase = Awaited<ReturnType<typeof requireUser>>["supabase"];

async function load(tripId: string) {
  const { supabase } = await requireUser(`/trips/${tripId}/show`);
  const pulled = await pullTrip(supabase, tripId);
  if (pulled.error !== undefined) return { error: pulled.error } as const;
  try {
    return { supabase, ...(await loadShow(supabase, tripId, pulled.payload)) } as const;
  } catch (e) {
    return { error: `Plan w bazie nie przechodzi walidacji: ${e instanceof Error ? e.message : String(e)}` } as const;
  }
}

/** Zapis scenariusza i usunięcie plików, których już nie używa. */
async function save(supabase: Supabase, tripId: string, before: ShowScript, after: ShowScript): Promise<string | null> {
  const { error } = await supabase.from("trip_shows").upsert({ trip_id: tripId, content: after as unknown as NonNullable<Json>, updated_at: new Date().toISOString() });
  if (error) return error.code === "42501" ? "Pokaz zmienia tylko organizator albo edytor." : `Nie zapisano pokazu: ${error.message}`;
  const dropped = droppedAudio(before, after);
  if (dropped.length > 0) await supabase.storage.from("show_audio").remove(dropped);
  return null;
}

export async function draftShow(tripId: string): Promise<FormState> {
  const denied = await aiAccessError();
  if (denied) return { error: denied };
  const gemini = geminiClient();
  if (gemini === null) return { error: "Serwer nie ma klucza GEMINI_API_KEY." };
  const loaded = await load(tripId);
  if ("error" in loaded) return { error: loaded.error };
  const { supabase, doc, scenes, script, today } = loaded;
  try {
    const draft = await draftShowNarration(gemini.client, showBrief(doc, scenes, today), { timeoutMs: 120_000 });
    const next = applyShowDraft(script, scenes, draft);
    const failed = await save(supabase, tripId, script, next);
    if (failed) return { error: failed };
    const kept = script.scenes.filter((scene) => scene.edited && scene.text.trim() !== "").length;
    refresh();
    return { ok: `Tekst lektora gotowy: ${plural(next.scenes.length - kept, ["scena", "sceny", "scen"])} z AI${kept > 0 ? `, poprawione ręcznie zostały (${kept})` : ""}. Przeczytaj go przed nagraniem.` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function saveShowText(tripId: string, key: string, text: string): Promise<FormState> {
  const loaded = await load(tripId);
  if ("error" in loaded) return { error: loaded.error };
  const { supabase, scenes, script } = loaded;
  if (!scenes.some((scene) => scene.key === key)) return { error: "Tej sceny nie ma już w planie." };
  const next = editShowText(script, key, text);
  if (next === script) return { ok: "Bez zmian." };
  const failed = await save(supabase, tripId, script, next);
  if (failed) return { error: failed };
  refresh();
  return { ok: "Zapisano." };
}

export async function setShowVoice(tripId: string, voice: string): Promise<FormState> {
  if (!isSpeechVoice(voice)) return { error: `Nie ma głosu „${voice}”.` };
  const loaded = await load(tripId);
  if ("error" in loaded) return { error: loaded.error };
  const { supabase, script } = loaded;
  if (script.voice === voice) return { ok: "Bez zmian." };
  const failed = await save(supabase, tripId, script, { ...script, voice });
  if (failed) return { error: failed };
  refresh();
  return { ok: "Głos zmieniony: nagraj sceny od nowa." };
}

/** Przy limicie zapytań Google przeglądarka czeka tyle sekund i próbuje jeszcze raz. */
const BUSY_WAIT_S = 30;

/**
 * Nagranie jednej sceny. Bez `refresh`: przeglądarka odświeża stronę po ostatniej scenie. Limit zapytań (darmowy poziom
 * Gemini TTS przepuszcza kilka nagrań na minutę) zwraca `wait`: przeglądarka odczeka i ponowi.
 */
export async function recordShowScene(tripId: string, key: string): Promise<FormState & { wait?: number }> {
  const denied = await aiAccessError();
  if (denied) return { error: denied };
  const setup = await speechSetup();
  if ("error" in setup) return { error: setup.error };
  const loaded = await load(tripId);
  if ("error" in loaded) return { error: loaded.error };
  const { supabase, script } = loaded;
  const scene = script.scenes.find((each) => each.key === key);
  if (scene === undefined || scene.text.trim() === "") return { error: "Ta scena nie ma tekstu do nagrania." };

  try {
    const speech = await speakGemini(setup.key, setup.model, scene.text, script.voice);
    const hash = narrationHash(scene.text, script.voice, setup.model);
    const path = `${tripId}/${hash}.wav`;
    const { error: uploadError } = await supabase.storage.from("show_audio").upload(path, speech.audio, { contentType: "audio/wav" });
    // Ten sam tekst, głos i model to ten sam plik: już wgrany wystarczy.
    if (uploadError && !/exists|duplicate/i.test(uploadError.message)) {
      return { error: /row-level security|unauthorized/i.test(uploadError.message) ? "Nagrania dodaje tylko organizator albo edytor." : `Nie zapisano nagrania: ${uploadError.message}` };
    }
    // Świeży odczyt: w trakcie nagrywania ktoś mógł zmienić tekst albo inną scenę.
    const { data: current } = await supabase.from("trip_shows").select("content").eq("trip_id", tripId).maybeSingle();
    const latest = ShowScript.safeParse(current?.content ?? {});
    const base = latest.success ? latest.data : script;
    if (base.voice !== script.voice) return { error: "W trakcie nagrywania zmienił się głos. Nagraj jeszcze raz." };
    const next = setShowAudio(base, key, { path, hash, model: setup.model, durationMs: speech.durationMs }, scene.text);
    if (next.scenes.find((each) => each.key === key)?.audio?.path !== path) return { error: "W trakcie nagrywania zmienił się tekst sceny. Nagraj jeszcze raz." };
    const failed = await save(supabase, tripId, base, next);
    if (failed) return { error: failed };
    return { ok: `Nagrano ${Math.round(speech.durationMs / 1000)} s.` };
  } catch (e) {
    if (e instanceof AiError && e.busy) return { error: e.message, wait: BUSY_WAIT_S };
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
