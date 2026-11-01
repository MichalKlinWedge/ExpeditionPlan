import "server-only";

import { createAiClient } from "@expeditionplan/ai";
import { fetchHolidays, geoapifyLookup, type PlannerDeps } from "@expeditionplan/planner";

/**
 * Zależności łańcucha „Zaplanuj z AI” po stronie serwera. Klucze tylko z env serwera (bez
 * `NEXT_PUBLIC_`), nigdy w przeglądarce. Model z `AI_MODEL_GEMINI`, domyślnie wybrany po
 * porównaniu na planach wzorcowych (tools/plan-ai).
 */
export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";

export function plannerDeps(): { deps: Omit<PlannerDeps, "primaryTz" | "onUsage">; model: string } | { missing: string[] } {
  const gemini = process.env.GEMINI_API_KEY ?? "";
  const geoapify = process.env.GEOAPIFY_API_KEY ?? "";
  const missing = [gemini === "" ? "GEMINI_API_KEY" : null, geoapify === "" ? "GEOAPIFY_API_KEY" : null].filter((name) => name !== null);
  if (missing.length > 0) return { missing };
  const model = process.env.AI_MODEL_GEMINI || DEFAULT_GEMINI_MODEL;
  return {
    model,
    deps: {
      client: createAiClient({ keys: { GEMINI: gemini }, models: { GEMINI: model }, defaultProvider: "GEMINI" }),
      lookup: geoapifyLookup(geoapify),
      holidays: (country, year) => fetchHolidays(country, year),
      timeoutMs: 120_000,
    },
  };
}
