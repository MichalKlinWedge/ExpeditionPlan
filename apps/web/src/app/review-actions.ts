"use server";

import { plural, ReviewCategory, StoredReview } from "@expeditionplan/core";
import type { Json } from "@expeditionplan/db";
import { applyPatch, pendingSuggestions, reviewPlan } from "@expeditionplan/planner";
import { dbErrorMessage, uuidv7 } from "@expeditionplan/sync";
import { refresh } from "next/cache";

import type { FormState } from "@/app/actions";
import { aiAccessError, plannerDeps } from "@/lib/ai";
import { loadForPatch, savePatchedPlan } from "@/lib/patch-save";

/**
 * Przegląd planu z AI na porównaniu (`/trips/[id]/compare?review=1`): AI daje niezależne
 * propozycje z łatkami (ai_runs stage `review`), człowiek stosuje albo odrzuca każdą osobno.
 * Przy zastosowaniu łatki liczą się od nowa na świeżym planie; punkty `user_locked` są nietykalne.
 */

const DENIED = "Przeglądać plan z AI może organizator albo edytor.";
const load = (tripId: string) => loadForPatch(tripId, `/trips/${tripId}/compare?review=1`, DENIED);

/** „Przejrzyj plan z AI”: nowy przegląd zastępuje poprzedni (jego nierozstrzygnięte propozycje znikają). */
export async function proposeReview(tripId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const focus = form.getAll("focus").flatMap((value) => {
    const parsed = ReviewCategory.safeParse(String(value));
    return parsed.success ? [parsed.data] : [];
  });
  const note = String(form.get("note") ?? "").slice(0, 500);
  const loaded = await load(tripId);
  if ("error" in loaded) return { error: loaded.error };
  if (loaded.doc.days.length === 0) return { error: "Plan nie ma jeszcze dni." };
  const denied = await aiAccessError();
  if (denied) return { error: denied };
  const setup = plannerDeps();
  if ("missing" in setup) return { error: `Serwer nie ma kluczy: ${setup.missing.join(", ")}.` };

  const usage = { inputTokens: 0, outputTokens: 0 };
  const started = Date.now();
  let stored: StoredReview;
  try {
    stored = await reviewPlan(loaded.doc, loaded.locked, { focus, note }, {
      client: setup.deps.client,
      onUsage: (each) => {
        usage.inputTokens += each.inputTokens;
        usage.outputTokens += each.outputTokens;
      },
    });
  } catch (e) {
    return { error: `AI nie przejrzało planu: ${e instanceof Error ? e.message : String(e)}` };
  }
  await loaded.supabase.from("ai_runs").update({ status: "rejected" }).eq("trip_id", tripId).eq("stage", "review").eq("status", "ok");
  const { error } = await loaded.supabase.from("ai_runs").insert({
    id: uuidv7(),
    trip_id: tripId,
    stage: "review",
    provider: "GEMINI",
    model: setup.model,
    input: { focus, note } as Json,
    output: stored as unknown as Json,
    status: "ok",
    tokens_in: usage.inputTokens,
    tokens_out: usage.outputTokens,
    duration_ms: Date.now() - started,
  });
  if (error) return { error: dbErrorMessage(error) };
  refresh();
  const count = stored.review.suggestions.length;
  return { ok: count === 0 ? "AI nie ma propozycji — plan wygląda dobrze." : `${plural(count, ["propozycja", "propozycje", "propozycji"])} — sprawdź na porównaniu.` };
}

type Supabase = Extract<Awaited<ReturnType<typeof load>>, { supabase: unknown }>["supabase"];

async function storedRun(supabase: Supabase, tripId: string, runId: string) {
  const { data: run } = await supabase.from("ai_runs").select("output, status").eq("id", runId).eq("trip_id", tripId).eq("stage", "review").maybeSingle();
  if (run?.status !== "ok") return { error: "Ten przegląd jest już nieaktualny." } as const;
  const stored = StoredReview.safeParse(run.output);
  if (!stored.success) return { error: "Przegląd jest uszkodzony — przejrzyj plan od nowa." } as const;
  return { stored: stored.data } as const;
}

/** Zapis tego, co zrobiono z propozycjami; gdy nic nie zostało do decyzji, przegląd jest zamknięty. */
async function markRun(supabase: Supabase, runId: string, stored: StoredReview) {
  const done = pendingSuggestions(stored).length === 0;
  const { error } = await supabase
    .from("ai_runs")
    .update({ output: stored as unknown as Json, ...(done ? { status: stored.applied.length > 0 ? "accepted" : "rejected" } : {}) })
    .eq("id", runId);
  return error ? dbErrorMessage(error) : null;
}

/** „Zastosuj” jednej albo zaznaczonych propozycji: łatki po kolei na świeżym planie, jeden zapis. */
export async function applySuggestions(tripId: string, runId: string, ids: string[]): Promise<FormState> {
  if (ids.length === 0) return { error: "Zaznacz propozycje." };
  const loaded = await load(tripId);
  if ("error" in loaded) return { error: loaded.error };
  const run = await storedRun(loaded.supabase, tripId, runId);
  if ("error" in run) return { error: run.error };
  const chosen = pendingSuggestions(run.stored).filter((each) => ids.includes(each.id));
  if (chosen.length === 0) return { error: "Te propozycje są już rozstrzygnięte." };

  let doc = loaded.doc;
  let done = 0;
  let skipped = 0;
  const applied: string[] = [];
  for (const suggestion of chosen) {
    const result = applyPatch(doc, { ops: suggestion.ops, message: suggestion.title }, loaded.locked, uuidv7);
    const ok = result.results.filter((each) => each.ok).length;
    skipped += result.results.length - ok;
    if (ok === 0) continue;
    doc = result.doc;
    done += ok;
    applied.push(suggestion.id);
  }
  if (applied.length === 0) return { error: "Żadnej z tych zmian nie da się już zastosować." };
  const saved = await savePatchedPlan(loaded.supabase, tripId, loaded, doc);
  if ("error" in saved) return saved;
  const error = await markRun(loaded.supabase, runId, { ...run.stored, applied: [...run.stored.applied, ...applied] });
  if (error) return { error };
  refresh();
  return {
    ok: `Zastosowano ${plural(done, ["zmianę", "zmiany", "zmian"])}${skipped > 0 ? `, pominięto ${skipped}` : ""}${saved.regrounded > 0 ? `; nowe pinezki: ${saved.regrounded}` : ""}${saved.notFound.length > 0 ? `; na mapie nie znaleziono: ${saved.notFound.map((name) => `„${name}”`).join(", ")} (przypnij na stronie Miejsca)` : ""}.`,
  };
}

/** „Odrzuć”: propozycja znika z porównania, plan bez zmian. */
export async function dismissSuggestions(tripId: string, runId: string, ids: string[]): Promise<FormState> {
  const loaded = await load(tripId);
  if ("error" in loaded) return { error: loaded.error };
  const run = await storedRun(loaded.supabase, tripId, runId);
  if ("error" in run) return { error: run.error };
  const error = await markRun(loaded.supabase, runId, { ...run.stored, dismissed: [...new Set([...run.stored.dismissed, ...ids])] });
  if (error) return { error };
  refresh();
  return { ok: ids.length === 1 ? "Odrzucono propozycję." : `Odrzucono ${ids.length} propozycji.` };
}
