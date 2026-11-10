import "server-only";

import { dayItems, LEG_MODE, type PlanItem, scheduleDay, SLACK_LABEL, type StoredReview, type TripDocument } from "@expeditionplan/core";
import { applyPatch, pendingSuggestions } from "@expeditionplan/planner";
import { uuidv7 } from "@expeditionplan/sync";

/**
 * Dane porównania „plan ↔ plan po propozycjach AI”. Prawa kolumna to ten sam plan z nałożonymi
 * łatkami nierozstrzygniętych propozycji — te same klucze punktów, więc różnica jest dokładna
 * (nowy, zmieniony, usunięty), a nie zgadywana po nazwach jak przy osobnym szkicu.
 * Liczone na serwerze, bo podgląd potrzebuje `applyPatch` z planner.
 */

type Doc = TripDocument;
type Item = PlanItem;

export type ReviewRow = { ref: string; time: string | null; title: string; detail?: string; mark?: "new" | "changed" | "removed"; changes?: string[] };
export type ReviewSuggestionView = { id: string; category: string; title: string; why: string; results: { ok: boolean; text: string }[]; dates: string[] };
export type ReviewDayView = { date: string; title?: string; plan: ReviewRow[]; after: ReviewRow[]; before: string; afterSummary: string; suggestionIds: string[] };
export type ReviewView = { summary: string; suggestions: ReviewSuggestionView[]; days: ReviewDayView[]; tripWide: string[]; decided: { applied: number; dismissed: number } };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function times(doc: Doc, dayRef: string): { at: Map<string, string>; summary: string } {
  try {
    const schedule = scheduleDay(doc, dayRef);
    const last = schedule.items.at(-1);
    return {
      at: new Map(schedule.items.map((each) => [each.ref, each.startLocal])),
      summary: [last ? `koniec ${last.endLocal}` : "bez punktów", schedule.slack ? SLACK_LABEL[schedule.slack] : null].filter(Boolean).join(" · "),
    };
  } catch {
    return { at: new Map(), summary: "—" };
  }
}

/** Co się zmieniło w punkcie, po ludzku: „godzina 10:00 → 9:30”, „przejazd: samochód, 45 min”. */
function itemChanges(before: Item, after: Item, placesBefore: Doc["places"], placesAfter: Doc["places"]): string[] {
  const placeName = (places: Doc["places"], ref: string | undefined) => places.find((place) => place.ref === ref)?.name ?? "—";
  const timeOf = (item: Item) => (item.time?.precision === "by" ? `do ${item.time.end}` : item.time && "start" in item.time ? item.time.start : item.time ? item.time.precision : "—");
  const legOf = (item: Item) =>
    item.leg ? [LEG_MODE[item.leg.mode] ?? item.leg.mode, item.leg.durationMin !== undefined ? `${item.leg.durationMin} min` : null, item.leg.distanceKm !== undefined ? `${item.leg.distanceKm} km` : null].filter(Boolean).join(", ") : "—";
  const out: string[] = [];
  if (before.title !== after.title) out.push(`nazwa: ${after.title}`);
  if (!same(before.time, after.time)) out.push(`godzina ${timeOf(before)} → ${timeOf(after)}`);
  if (before.durationMin !== after.durationMin) out.push(`czas ${before.durationMin ?? "—"} → ${after.durationMin ?? "—"} min`);
  if (before.placeRef !== after.placeRef) out.push(`miejsce: ${placeName(placesAfter, after.placeRef)}`);
  if (!same(before.leg, after.leg)) out.push(`przejazd: ${legOf(after)}`);
  if (before.description !== after.description) out.push(before.description ? "nowy opis" : "dodany opis");
  if (before.dayRef !== after.dayRef || before.sortKey !== after.sortKey) out.push("inne miejsce w planie");
  if (!same(before.variantRefs, after.variantRefs)) out.push("w wariancie");
  const placeBefore = placesBefore.find((place) => place.ref === before.placeRef);
  const placeAfter = placesAfter.find((place) => place.ref === after.placeRef);
  if (placeBefore && placeAfter && placeBefore.ref === placeAfter.ref && placeBefore.searchName !== placeAfter.searchName) out.push(`mapa: szukaj „${placeAfter.searchName}”`);
  return out;
}

/** Dni, których dotyczy zmiana: gdzie punkt był, gdzie jest po zmianie, i dni z punktami w zmienionym miejscu. */
function touchedDays(before: Doc, after: Doc): Set<string> {
  const touched = new Set<string>();
  const old = new Map(before.items.map((item) => [item.ref, item]));
  for (const item of after.items) {
    const was = old.get(item.ref);
    if (was !== undefined && same(was, item)) continue;
    if (item.dayRef) touched.add(item.dayRef);
    if (was?.dayRef) touched.add(was.dayRef);
  }
  for (const item of before.items) if (item.dayRef && !after.items.some((each) => each.ref === item.ref)) touched.add(item.dayRef);
  return touched;
}

export function reviewView(doc: Doc, stored: StoredReview, locked: ReadonlySet<string>): ReviewView {
  const pending = pendingSuggestions(stored);
  const dateOf = new Map(doc.days.map((day) => [day.ref, day.date]));
  let after = doc;
  const byDay = new Map<string, string[]>();
  const tripWide: string[] = [];
  const suggestions: ReviewSuggestionView[] = pending.map((suggestion) => {
    const alone = applyPatch(doc, { ops: suggestion.ops, message: suggestion.title }, locked, uuidv7);
    const days = [...touchedDays(doc, alone.doc)].sort((a, b) => (dateOf.get(a) ?? "").localeCompare(dateOf.get(b) ?? ""));
    // Prawa kolumna: wszystkie propozycje po kolei, jak przy „Zastosuj zaznaczone” w tej kolejności.
    const together = applyPatch(after, { ops: suggestion.ops, message: suggestion.title }, locked, uuidv7);
    if (together.results.some((each) => each.ok)) after = together.doc;
    const first = days[0];
    if (first !== undefined) byDay.set(first, [...(byDay.get(first) ?? []), suggestion.id]);
    else tripWide.push(suggestion.id);
    return {
      id: suggestion.id,
      category: suggestion.category,
      title: suggestion.title,
      why: suggestion.why,
      results: alone.results.map(({ ok, text }) => ({ ok, text })),
      dates: days.flatMap((ref) => (dateOf.has(ref) ? [dateOf.get(ref)!] : [])),
    };
  });

  const touched = touchedDays(doc, after);
  for (const ref of byDay.keys()) touched.add(ref);
  const placeOf = (places: Doc["places"], item: Item) => places.find((place) => place.ref === item.placeRef)?.name;
  const days: ReviewDayView[] = doc.days
    .filter((day) => touched.has(day.ref))
    .map((day) => {
      const left = times(doc, day.ref);
      const right = times(after, day.ref);
      const planItems = dayItems(doc, day.ref);
      const afterItems = dayItems(after, day.ref);
      const afterByRef = new Map(afterItems.map((item) => [item.ref, item]));
      const planByRef = new Map(planItems.map((item) => [item.ref, item]));
      const detail = (places: Doc["places"], item: Item) => {
        const place = placeOf(places, item);
        return [item.durationMin !== undefined ? `${item.durationMin} min` : null, place && place !== item.title ? place : null, item.variantRefs.length > 0 ? "tylko w wariancie" : null].filter(Boolean).join(" · ") || undefined;
      };
      const plan: ReviewRow[] = planItems.map((item) => {
        const next = afterByRef.get(item.ref);
        const mark = next === undefined ? "removed" : same(next, item) ? undefined : "changed";
        return { ref: item.ref, time: left.at.get(item.ref) ?? null, title: item.title, ...(detail(doc.places, item) ? { detail: detail(doc.places, item) } : {}), ...(mark ? { mark } : {}) };
      });
      const afterRows: ReviewRow[] = afterItems.map((item) => {
        const was = planByRef.get(item.ref) ?? doc.items.find((each) => each.ref === item.ref);
        const mark = was === undefined || was.dayRef !== day.ref ? "new" : same(was, item) ? undefined : "changed";
        const changes = mark === "changed" && was ? itemChanges(was, item, doc.places, after.places) : undefined;
        return {
          ref: item.ref,
          time: right.at.get(item.ref) ?? null,
          title: item.title,
          ...(detail(after.places, item) ? { detail: detail(after.places, item) } : {}),
          ...(mark ? { mark } : {}),
          ...(changes && changes.length > 0 ? { changes } : {}),
        };
      });
      return { date: day.date, ...(day.title ? { title: day.title } : {}), plan, after: afterRows, before: left.summary, afterSummary: right.summary, suggestionIds: byDay.get(day.ref) ?? [] };
    });
  return { summary: stored.review.summary, suggestions, days, tripWide, decided: { applied: stored.applied.length, dismissed: stored.dismissed.length } };
}
