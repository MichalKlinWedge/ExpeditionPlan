"use client";

import {
  activeVariants as resolveVariants,
  addItem,
  documentProblem as problem,
  type DaySchedule,
  instantToZoned,
  legLabel,
  mapCoverage,
  missingOnMap,
  moveToDay,
  moveWithinDay,
  type PlanEdit as Edit,
  type PlanItem as Item,
  proposeCuts,
  removeItemClosingGap,
  type Scenario,
  scheduleDay,
  type TripDocument,
  updateItem,
} from "@expeditionplan/core";
import { savePlanEdit, type TripState, uuidv7 } from "@expeditionplan/sync";
import { useMemo, useState } from "react";

import { ItemEditor } from "@/components/item-editor";
import { createClient } from "@/lib/supabase/client";
import { useHydrated } from "@/lib/use-hydrated";
import { useRefreshOnReturn } from "@/lib/use-refresh-on-return";

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

type Props = { state: TripState; tripId: string; ids: Record<string, string>; canEdit: boolean };

export function PlanView({ state, tripId, ids: initialIds, canEdit }: Props) {
  useRefreshOnReturn();
  const { inputs } = state;
  const [doc, setDoc] = useState(state.doc);
  const [ids, setIds] = useState(initialIds);
  const [saving, setSaving] = useState<{ pending: number; error?: string; ok?: boolean }>({ pending: 0 });
  const [scenario, setScenario] = useState<Scenario>("optimistic");
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const variants = useMemo(() => ({ ...inputs.activeVariants, ...overrides }), [inputs.activeVariants, overrides]);
  const options = { scenario, activeVariants: variants, delays: inputs.delays, skipRefs: inputs.skipRefs };
  const places = new Map(doc.places.map((place) => [place.ref, place]));
  const pool = doc.items.filter((item) => item.dayRef === undefined);

  /**
   * Zmiana: najpierw w dokumencie (silnik przelicza od razu), potem zapis w tle. Dokument, który
   * nie przechodzi walidacji, nie trafia do bazy; błąd zapisu cofa zmianę.
   */
  const apply = (edit: Edit | null) => {
    if (edit === null) return;
    const invalid = problem(edit.doc);
    if (invalid !== null) return setSaving({ pending: 0, error: `Nie zapisano: ${invalid}` });
    const before = doc;
    setDoc(edit.doc);
    setSaving((current) => ({ pending: current.pending + 1 }));
    void persist(edit).then(
      () => setSaving((current) => ({ pending: current.pending - 1, ok: true })),
      (error: unknown) => {
        setDoc(before);
        setSaving((current) => ({ pending: current.pending - 1, error: error instanceof Error ? error.message : String(error) }));
      },
    );
  };

  const persist = async (edit: Edit) => {
    setIds(await savePlanEdit(createClient(), tripId, edit, ids));
  };

  const actions: Actions | null = canEdit
    ? {
        move: (ref, direction) => apply(moveWithinDay(doc, ref, direction)),
        moveTo: (ref, dayRef) => apply(moveToDay(doc, ref, dayRef)),
        update: (ref, patch) => apply(updateItem(doc, ref, patch)),
        add: (dayRef, fields) => apply(addItem(doc, dayRef, uuidv7(), fields)),
        remove: (ref) => {
          try {
            apply(removeItemClosingGap(doc, ref));
          } catch (error) {
            setSaving({ pending: 0, error: error instanceof Error ? error.message : String(error) });
          }
        },
      }
    : null;

  return (
    <div className="flex flex-col gap-6">
      {canEdit && (
        <p className="sticky top-0 z-10 -mx-4 bg-[var(--background)] px-4 py-1 text-xs text-zinc-500">
          {saving.pending > 0 ? "Zapisuję…" : saving.error ? <span className="text-red-600">{saving.error}</span> : saving.ok ? "Zapisano." : "Zmiany zapisują się od razu."}
        </p>
      )}
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

      <Coverage doc={doc} />

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
          actions={actions}
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
                    {actions && <MoveSelect doc={doc} current={undefined} onMove={(dayRef) => actions.moveTo(item.ref, dayRef)} />}
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

/** Ile planu jest na mapie: miejsca ze współrzędnymi i przejazdy policzone trasą. */
function Coverage({ doc }: { doc: TripDocument }) {
  const { places, legs } = mapCoverage(doc);
  if (places.total === 0 && legs.routable === 0) return null;
  return (
    <p className="text-sm text-zinc-600 dark:text-zinc-400">
      Na mapie {places.onMap} z {places.total} miejsc
      {legs.routable > 0 && ` · przejazdy z trasy: ${legs.routed} z ${legs.routable}`}
      {places.onMap < places.total && " · miejsca bez współrzędnych mają znaczek „brak na mapie”"}
    </p>
  );
}

type Actions = {
  move: (ref: string, direction: -1 | 1) => void;
  moveTo: (ref: string, dayRef: string | null) => void;
  update: (ref: string, patch: Partial<Item>) => void;
  add: (dayRef: string, fields: Pick<Item, "title" | "kind"> & Partial<Item>) => void;
  remove: (ref: string) => void;
};

/** „Przenieś do…” — inny dzień albo pula. */
function MoveSelect({ doc, current, onMove }: { doc: TripDocument; current: string | undefined; onMove: (dayRef: string | null) => void }) {
  return (
    <select
      value=""
      onChange={(event) => onMove(event.target.value === "pool" ? null : event.target.value)}
      className="ml-2 rounded border border-zinc-300 bg-transparent px-1 text-xs text-zinc-500 dark:border-zinc-700"
      aria-label="Przenieś do">
      <option value="">przenieś…</option>
      {doc.days
        .filter((day) => day.ref !== current)
        .map((day) => (
          <option key={day.ref} value={day.ref}>
            {weekday(day.date)}
          </option>
        ))}
      {current !== undefined && <option value="pool">do puli</option>}
    </select>
  );
}

function AddItemForm({ onAdd }: { onAdd: (fields: Pick<Item, "title" | "kind"> & Partial<Item>) => void }) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<Item["kind"]>("visit");
  const [duration, setDuration] = useState("60");
  return (
    <form
      className="flex flex-wrap items-center gap-2 text-sm"
      onSubmit={(event) => {
        event.preventDefault();
        if (title.trim() === "") return;
        onAdd({ title: title.trim(), kind, durationMin: Number(duration) || undefined });
        setTitle("");
      }}>
      <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Nowy punkt" className="flex-1 rounded-md border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700" />
      <select value={kind} onChange={(event) => setKind(event.target.value as Item["kind"])} className="rounded-md border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700">
        {Object.entries(KIND).map(([key, name]) => (
          <option key={key} value={key}>
            {name}
          </option>
        ))}
      </select>
      <input value={duration} onChange={(event) => setDuration(event.target.value)} type="number" min={0} className="w-20 rounded-md border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700" aria-label="Czas trwania w minutach" />
      <span className="text-xs text-zinc-500">min</span>
      <button className="rounded-md border border-zinc-300 px-3 py-1 dark:border-zinc-700">Dodaj</button>
    </form>
  );
}

type DayProps = {
  doc: TripDocument;
  dayRef: string;
  options: Parameters<typeof scheduleDay>[2];
  active: Set<string>;
  onChoose: (groupRef: string, variantRef: string) => void;
  places: Map<string, TripDocument["places"][number]>;
  actions: Actions | null;
};

function Day({ doc, dayRef, options, active, onChoose, places, actions }: DayProps) {
  const day = doc.days.find((each) => each.ref === dayRef)!;
  const [editing, setEditing] = useState<string | null>(null);
  const hydrated = useHydrated();
  let schedule: DaySchedule | null = null;
  let failure: string | null = null;
  try {
    // Godziny tylko w przeglądarce — patrz `useHydrated`.
    if (hydrated) schedule = scheduleDay(doc, dayRef, options);
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
            const leg = source === undefined ? null : legLabel(source);
            const offMap = source !== undefined && missingOnMap(doc, source);
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
                    {offMap && (
                      <span title="Miejsce bez współrzędnych — nie ma go na mapie i nie policzy się do niego trasy" className="ml-2 rounded bg-amber-100 px-1 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                        brak na mapie
                      </span>
                    )}
                  </span>
                </div>
                {leg && <p className="ml-31 text-xs text-zinc-500">{leg}</p>}
                {warnings.map((warning, index) => (
                  <p key={index} className={`ml-31 text-xs ${warning.severity === "hard" ? "text-red-600" : "text-amber-600"}`}>
                    {warning.severity === "hard" ? "⚠ " : "· "}
                    {warning.message}
                  </p>
                ))}
                {actions && source && (
                  <div className="ml-31 flex items-center gap-1 text-xs text-zinc-500">
                    <button onClick={() => actions.move(item.ref, -1)} aria-label="Wyżej" className="px-1 hover:text-zinc-900 dark:hover:text-zinc-100">
                      ↑
                    </button>
                    <button onClick={() => actions.move(item.ref, 1)} aria-label="Niżej" className="px-1 hover:text-zinc-900 dark:hover:text-zinc-100">
                      ↓
                    </button>
                    <button onClick={() => setEditing(editing === item.ref ? null : item.ref)} className="px-1 underline">
                      edytuj
                    </button>
                    <button
                      onClick={() => window.confirm(`Usunąć „${item.title}” z planu?`) && actions.remove(item.ref)}
                      className="px-1 underline">
                      usuń
                    </button>
                    <MoveSelect doc={doc} current={dayRef} onMove={(target) => actions.moveTo(item.ref, target)} />
                  </div>
                )}
                {actions && source && editing === item.ref && (
                  <ItemEditor
                    item={source}
                    onCancel={() => setEditing(null)}
                    onSave={(patch) => {
                      actions.update(item.ref, patch);
                      setEditing(null);
                    }}
                  />
                )}
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

      {actions && <AddItemForm onAdd={(fields) => actions.add(dayRef, fields)} />}

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
