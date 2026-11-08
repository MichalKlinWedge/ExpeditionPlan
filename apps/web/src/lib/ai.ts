import "server-only";

import { createAiClient, geminiModels, speechModel } from "@expeditionplan/ai";
import { fetchHolidays, geoapifyLookup, orsRoute, type PlannerDeps } from "@expeditionplan/planner";

import { createClient } from "./supabase/server";

/**
 * Zależności łańcucha „Zaplanuj z AI” po stronie serwera. Klucze tylko z env serwera (bez
 * `NEXT_PUBLIC_`), nigdy w przeglądarce. Model z `AI_MODEL_GEMINI`, domyślnie wybrany po
 * porównaniu na planach wzorcowych (tools/plan-ai). Trasy przejazdów (ORS) — gdy jest klucz.
 */
/**
 * Kto może uruchamiać AI i usługi na kluczach serwera (Gemini, Geoapify, ORS): e-maile z
 * `AI_ALLOWED_EMAILS` (po przecinku). Bez tej zmiennej — wszyscy lokalnie, nikt na produkcji.
 * Pozostali mają podgląd i ręczną edycję; własne klucze użytkowników to plan na później.
 */
export async function aiAccessError(): Promise<string | null> {
  const { data } = await (await createClient()).auth.getClaims();
  return aiAccessFor(String(data?.claims.email ?? ""));
}

/** To samo dla e-maila z tokenu (żądania z telefonu: `Authorization: Bearer`, bez cookies). */
export function aiAccessFor(email: string): string | null {
  const list = process.env.AI_ALLOWED_EMAILS;
  if (list === undefined || list.trim() === "") return process.env.NODE_ENV === "production" ? "AI jest wyłączone na tym serwerze." : null;
  const allowed = list.split(",").map((each) => each.trim().toLowerCase());
  return email !== "" && allowed.includes(email.toLowerCase()) ? null : "AI i wyszukiwanie miejsc są na razie dostępne tylko dla właściciela aplikacji.";
}

export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";

export function plannerDeps(): { deps: Omit<PlannerDeps, "primaryTz" | "onUsage">; model: string } | { missing: string[] } {
  const gemini = process.env.GEMINI_API_KEY ?? "";
  const geoapify = process.env.GEOAPIFY_API_KEY ?? "";
  const missing = [gemini === "" ? "GEMINI_API_KEY" : null, geoapify === "" ? "GEOAPIFY_API_KEY" : null].filter((name) => name !== null);
  if (missing.length > 0) return { missing };
  const model = process.env.AI_MODEL_GEMINI || DEFAULT_GEMINI_MODEL;
  const route = routeLookup();
  return {
    model,
    deps: {
      client: createAiClient({ keys: { GEMINI: gemini }, models: { GEMINI: model }, defaultProvider: "GEMINI", failover: {} }),
      lookup: geoapifyLookup(geoapify),
      holidays: (country, year) => fetchHolidays(country, year),
      timeoutMs: 120_000,
      ...(route ? { route } : {}),
    },
  };
}

/** Sam Gemini (bez wyszukiwania miejsc) — paragony, opisy; `null` bez klucza. */
export function geminiClient() {
  const gemini = process.env.GEMINI_API_KEY ?? "";
  if (gemini === "") return null;
  const model = process.env.AI_MODEL_GEMINI || DEFAULT_GEMINI_MODEL;
  return { model, client: createAiClient({ keys: { GEMINI: gemini }, models: { GEMINI: model }, defaultProvider: "GEMINI", failover: {} }) };
}

/** Trasy OpenRouteService; `null` bez klucza (wtedy zostają czasy szacowane przez AI). */
export function routeLookup() {
  const key = process.env.OPENROUTESERVICE_API_KEY ?? "";
  return key === "" ? null : orsRoute(key);
}

let speechModelName: Promise<string | null> | undefined;

/**
 * Klucz i model mowy (Gemini TTS) dla lektora pokazu. Model z `AI_MODEL_TTS`, a bez niej z listy modeli Google
 * (`speechModel`: najnowszy stabilny Flash-Lite TTS), pobranej raz na życie serwera; nieudane pobranie spróbuje się następnym razem.
 */
export async function speechSetup(): Promise<{ key: string; model: string } | { error: string }> {
  const key = process.env.GEMINI_API_KEY ?? "";
  if (key === "") return { error: "Serwer nie ma klucza GEMINI_API_KEY." };
  const fixed = process.env.AI_MODEL_TTS?.trim();
  if (fixed) return { key, model: fixed };
  speechModelName ??= geminiModels(key).then(speechModel);
  const model = await speechModelName.catch(() => null);
  if (model === null) {
    speechModelName = undefined;
    return { error: "Google nie podał modelu do czytania tekstu (Gemini TTS). Ustaw AI_MODEL_TTS albo spróbuj później." };
  }
  return { key, model };
}
