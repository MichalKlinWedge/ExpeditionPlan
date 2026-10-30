import { TripBrief } from "@expeditionplan/core";

/**
 * Strona zastępcza z Etapu 0. Sprawdza tylko, że web widzi wspólny pakiet `@expeditionplan/core`
 * z monorepo — kreator i edytor planu przyjdą w MVP-2 i MVP-3.
 */
const check = TripBrief.safeParse({
  title: "Test",
  goal: "Sprawdzić, że pakiet core działa na webie",
  location: { kind: "city", countries: ["PL"], places: ["Wrocław"] },
  dates: { kind: "fixed", start: "2026-11-01", end: "2026-11-02" },
  profiles: ["sightseeing"],
  travelers: [{ name: "Ala" }],
  transport: ["walk"],
  budget: { level: "low", currency: "PLN" },
});

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-4 px-4 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">ExpeditionPlan</h1>
      <p className="text-lg text-zinc-600 dark:text-zinc-400">Planner Hub</p>
      <p className="rounded-lg bg-zinc-100 px-4 py-3 text-sm dark:bg-zinc-900">
        Pakiet @expeditionplan/core: {check.success ? "działa" : "błąd walidacji"}
      </p>
    </main>
  );
}
