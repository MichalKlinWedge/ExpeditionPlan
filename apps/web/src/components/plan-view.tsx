"use client";

import {
  activeVariants as resolveVariants,
  type DaySchedule,
  instantToZoned,
  proposeCuts,
  type Scenario,
  scheduleDay,
  type TripDocument,
} from "@expeditionplan/core";
import type { TripState } from "@expeditionplan/sync";
import { useMemo, useState } from "react";

/**
 * Widok planu (MVP-3, tylko odczyt): dni z godzinami policzonymi przez silnik (§7), ostrzeżenia,
 * audyt zapasu, cięcia, słońce, warianty i pula. Silnik działa w przeglądarce — przełączenie
 * scenariusza albo wariantu przelicza dzień od razu, bez serwera.
 */

const KIND: Record<string, string> = {
  visit: "zwiedzanie",
  activity: "aktywność",
  meal: "posiłek",
  transport: "przejazd",
  lodging: "nocleg",
  errand: "sprawa",
  meetup: "spotkanie",
  free: "czas wolny",
  decision: "decyzja",
};

const SLACK: Record<string, { label: string; tone: string }> = {
  large: { label: "duży zapas", tone: "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200" },
  small: { label: "mały zapas", tone: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" },
  none: { label: "bez zapasu", tone: "bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-200" },
  negative: { label: "dzień się nie spina", tone: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200" },
};

const STATUS: Record<string, string> = {
  candidate: "kandydat",
  alternative: "alternatywa",
  does_not_fit: "nie mieści się",
  rejected: "odrzucony",
  scheduled: "w planie",
};

const weekday = (date: string) =>
  new Intl.DateTimeFormat("pl-PL", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));

const hm = (instant: number | null | undefined, tz: string) => (instant == null ? "—" : instantToZoned(instant, tz).time);

export function PlanView({ state }: { state: TripState }) {
  const { doc, inputs } = state;
  const [scenario, setScenario] = useState<Scenario>("optimistic");
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const variants = useMemo(() => ({ ...inputs.activeVariants, ...overrides }), [inputs.activeVariants, overrides]);
  const options = { scenario, activeVariants: variants, delays: inputs.delays, skipRefs: inputs.skipRefs };
  const places = new Map(doc.places.map((place) => [place.ref, place]));
  const pool = doc.items.filter((item) => item.dayRef === undefined);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span>Scenariusz:</span>
        {(["optimistic", "pessimistic"] as const).map((each) => (
          <button
            key={each}
            onClick={() => setScenario(each)}
            className={`rounded-full border px-3 py-1 ${scenario === each ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900" : "border-zinc-300 dark:border-zinc-700"}`}>
            {each === "optimistic" ? "optymistyczny (krótsze czasy)" : "pesymistyczny (dłuższe czasy)"}
          </button>
        ))}
      </div>

      {doc.days.length === 0 && <p className="text-sm text-zinc-500">Plan nie ma jeszcze dni.</p>}
      {doc.days.map((day) => (
        <Day
          key={day.ref}
          doc={doc}
          dayRef={day.ref}
          options={options}
          active={resolveVariants(doc, variants)}
          onChoose={(groupRef, variantRef) => setOverrides((current) => ({ ...current, [groupRef]: variantRef }))}
          places={places}
        />
      ))}

      {pool.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">Pula — poza dniami ({pool.length})</h2>
          {Object.entries(Object.groupBy(pool, (item) => item.area ?? "bez obszaru")).map(([area, items]) => (
            <div key={area} className="text-sm">
              <p className="font-medium">{area}</p>
              <ul className="ml-4 list-disc text-zinc-600 dark:text-zinc-400">
                {items!.map((item) => (
                  <li key={item.ref}>
                    {item.title} <span className="text-zinc-500">· {STATUS[item.planStatus]}</span>
                    {item.priority === "must" && <span className="text-zinc-500"> · koniecznie</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

type DayProps = {
  doc: TripDocument;
  dayRef: string;
  options: Parameters<typeof scheduleDay>[2];
  active: Set<string>;
  onChoose: (groupRef: string, variantRef: string) => void;
  places: Map<string, TripDocument["places"][number]>;
};

function Day({ doc, dayRef, options, active, onChoose, places }: DayProps) {
  const day = doc.days.find((each) => each.ref === dayRef)!;
  let schedule: DaySchedule | null = null;
  let failure: string | null = null;
  try {
    schedule = scheduleDay(doc, dayRef, options);
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }
  const cuts = schedule?.slack === "negative" || schedule?.warnings.some((each) => each.severity === "hard") ? proposeCuts(doc, dayRef, options) : [];
  const groups = doc.variantGroups.filter((group) => group.dayRef === dayRef && group.scope !== "trip" && group.scope !== "booking");
  const notes = doc.notes.filter((note) => note.scope === "day" && note.targetRef === dayRef);
  const byRef = new Map(doc.items.map((item) => [item.ref, item]));
  const base = day.baseRef === undefined ? undefined : places.get(day.baseRef)?.name;
  const sun = schedule?.facts.sun;

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold first-letter:uppercase">
            {weekday(day.date)}
            {day.title ? ` — ${day.title}` : ""}
          </h2>
          <p className="text-xs text-zinc-500">
            {base ? `baza: ${base} · ` : ""}
            {sun ? `wschód ${hm(sun.sunrise, day.tz)} · zachód ${hm(sun.sunset, day.tz)} · zmrok ${hm(sun.civilDusk, day.tz)}` : "słońce: brak współrzędnych bazy"}
            {schedule?.facts.dst ? " · zmiana czasu" : ""}
          </p>
        </div>
        {schedule?.slack && (
          <span className={`rounded-full px-3 py-1 text-xs ${SLACK[schedule.slack]!.tone}`}>
            {SLACK[schedule.slack]!.label}
            {schedule.slackMin !== null ? ` (${schedule.slackMin} min)` : ""}
          </span>
        )}
      </header>

      {day.summary && <p className="text-sm text-zinc-600 dark:text-zinc-400">{day.summary}</p>}

      {groups.map((group) => {
        const options = doc.variants.filter((variant) => variant.groupRef === group.ref);
        return (
          <div key={group.ref} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-zinc-500">{group.title}:</span>
            {options.map((variant) => (
              <button
                key={variant.ref}
                onClick={() => onChoose(group.ref, variant.ref)}
                className={`rounded-full border px-3 py-1 ${active.has(variant.ref) ? "border-zinc-900 font-medium dark:border-zinc-100" : "border-zinc-300 text-zinc-500 dark:border-zinc-700"}`}>
                {variant.label}
                {variant.recommended ? " ★" : ""}
              </button>
            ))}
          </div>
        );
      })}

      {failure && <p className="text-sm text-red-600">Nie udało się policzyć dnia: {failure}</p>}

      {schedule && (
        <ol className="flex flex-col gap-1 text-sm">
          {schedule.items.map((item) => {
            const source = byRef.get(item.ref);
            const warnings = schedule.warnings.filter((warning) => warning.itemRef === item.ref);
            const place = source?.placeRef === undefined ? undefined : places.get(source.placeRef)?.name;
            return (
              <li key={item.ref} className={`flex flex-col ${source?.parentRef ? "ml-6 border-l border-zinc-200 pl-3 dark:border-zinc-800" : ""}`}>
                <div className="flex gap-3">
                  <span className="w-28 shrink-0 font-mono text-zinc-600 dark:text-zinc-400">
                    {item.startLocal}–{item.endLocal}
                    {item.endDate !== day.date ? "+1" : ""}
                  </span>
                  <span>
                    {item.title}
                    <span className="text-zinc-500">
                      {" "}
                      · {KIND[item.kind]}
                      {place && place !== item.title ? ` · ${place}` : ""}
                      {item.driftMin > 15 && item.statedLocal ? ` · plan mówi ${item.statedLocal}, wychodzi +${item.driftMin} min` : ""}
                    </span>
                  </span>
                </div>
                {warnings.map((warning, index) => (
                  <p key={index} className={`ml-31 text-xs ${warning.severity === "hard" ? "text-red-600" : "text-amber-600"}`}>
                    {warning.severity === "hard" ? "⚠ " : "· "}
                    {warning.message}
                  </p>
                ))}
              </li>
            );
          })}
        </ol>
      )}

      {schedule?.warnings
        .filter((warning) => warning.itemRef === undefined)
        .map((warning, index) => (
          <p key={index} className={`text-xs ${warning.severity === "hard" ? "text-red-600" : "text-amber-600"}`}>
            {warning.severity === "hard" ? "⚠ " : "· "}
            {warning.message}
          </p>
        ))}

      {cuts.length > 0 && (
        <div className="text-sm">
          <p className="font-medium">Co wyciąć, żeby dzień się spiął (scenariusz pesymistyczny):</p>
          <ul className="ml-4 list-disc text-zinc-600 dark:text-zinc-400">
            {cuts.map((cut) => (
              <li key={cut.itemRef}>
                {cut.title} — zwalnia {cut.freesMin} min{cut.resolves ? " (wystarczy)" : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      {notes.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-zinc-500">Notatki dnia ({notes.length})</summary>
          <ul className="mt-2 flex flex-col gap-2">
            {notes.map((note, index) => (
              <li key={index} className="whitespace-pre-line text-zinc-600 dark:text-zinc-400">
                {note.title ? <span className="font-medium">{note.title}: </span> : null}
                {note.body}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
