"use client";

import { addEatOutChoices, documentProblem, EATERY_KINDS, type EateryKind, eatOutGroup, formatDistance, isPinnedEatery, mealEateries, type TripDocument } from "@expeditionplan/core";
import { saveElements, uuidv7 } from "@expeditionplan/sync";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { type EateryAnswer, findRestaurants } from "@/app/eat-out-actions";
import type { MealSelection } from "@/components/meal-row";
import { createClient } from "@/lib/supabase/client";

/**
 * „Knajpy w pobliżu” posiłku na mieście: wyszukiwanie wokół miejsca posiłku albo punktu dnia
 * (akcja serwera, Geoapify Places), zaznaczenie jednej lub kilku i przypięcie. Jedna = miejsce
 * posiłku; kilka = „gdzie jemy?” do wyboru (warianty) — także na telefonie, offline.
 * Przypięte stoją pod posiłkiem, a kliknięcie pokazuje knajpę na mapie i jej dane.
 */

const RADII = [500, 1000, 2000, 5000];
const DIETS = [
  ["", "bez filtra"],
  ["vegetarian", "wegetariańskie"],
  ["vegan", "wegańskie"],
  ["gluten_free", "bezglutenowe"],
  ["halal", "halal"],
] as const;
const OPEN = {
  open: { label: "otwarte w porze posiłku", className: "text-emerald-700 dark:text-emerald-400" },
  partly: { label: "otwarte tylko część posiłku", className: "text-amber-700 dark:text-amber-400" },
  closed: { label: "zamknięte w porze posiłku", className: "text-red-600" },
  unknown: { label: "godziny nieznane", className: "text-zinc-500" },
} as const;

const input = "field min-w-0 px-2 py-1 text-sm";

export function EatOutSearch({ tripId, doc, ids, itemRef, onClose, onPinned }: { tripId: string; doc: TripDocument; ids: Record<string, string>; itemRef: string; onClose: () => void; onPinned: (placeRef: string, names: string[]) => void }) {
  const router = useRouter();
  const [kinds, setKinds] = useState<EateryKind[]>(["restaurant", "fast_food", "hut"]);
  const [radiusM, setRadiusM] = useState(1000);
  const [diet, setDiet] = useState("");
  const [near, setNear] = useState("");
  const [answer, setAnswer] = useState<EateryAnswer | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const search = () =>
    start(async () => {
      setError(null);
      setPicked(new Set());
      setAnswer(await findRestaurants(tripId, itemRef, { kinds, radiusM, ...(diet ? { diet: diet as "vegetarian" } : {}), ...(near.trim() ? { near } : {}) }));
    });

  const save = () => {
    if (answer === null || "error" in answer) return;
    const picks = [...picked].sort((a, b) => a - b).map((index) => answer.results[index]!).map((result) => ({ eatery: result, summary: result.summary }));
    const edit = addEatOutChoices(doc, itemRef, picks, () => `id-${uuidv7()}`);
    if (edit === null) return;
    const invalid = documentProblem(edit.doc);
    if (invalid !== null) return setError(`Nie zapisano: ${invalid}`);
    start(async () => {
      try {
        if (edit.writes.length > 0) await saveElements(createClient(), tripId, edit.doc, edit.writes, ids);
        onPinned(edit.pinned[0]!, picks.map(({ eatery }) => eatery.name));
        onClose();
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  const toggle = (index: number) =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  return (
    <div className="mt-1 flex flex-col gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          search();
        }}>
        <fieldset className="flex flex-wrap gap-2 text-xs">
          {(Object.keys(EATERY_KINDS) as EateryKind[]).map((kind) => (
            <label key={kind} className="flex items-center gap-1">
              <input type="checkbox" checked={kinds.includes(kind)} onChange={(event) => setKinds((current) => (event.target.checked ? [...current, kind] : current.filter((each) => each !== kind)))} />
              {EATERY_KINDS[kind]}
            </label>
          ))}
        </fieldset>
        <label className="flex flex-col gap-1 text-xs text-zinc-500">
          Promień
          <select value={radiusM} onChange={(event) => setRadiusM(Number(event.target.value))} className={input}>
            {RADII.map((each) => (
              <option key={each} value={each}>
                {formatDistance(each)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-500">
          Dieta
          <select value={diet} onChange={(event) => setDiet(event.target.value)} className={input}>
            {DIETS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-zinc-500">
          W pobliżu (opcjonalnie)
          <input value={near} onChange={(event) => setNear(event.target.value)} placeholder="domyślnie miejsce posiłku lub punkt dnia" className={input} />
        </label>
        <button disabled={pending} className="btn-secondary btn-sm">
          Szukaj
        </button>
        <button type="button" onClick={onClose} className="btn-mini">
          zamknij
        </button>
      </form>

      {pending && <p className="text-xs text-zinc-500">Chwila…</p>}
      {answer && "error" in answer && <p className="text-xs text-red-600">{answer.error}</p>}
      {answer && "results" in answer && (
        <>
          <p className="text-xs text-zinc-500">
            W pobliżu: {answer.center.near} · {answer.results.length === 0 ? "nic nie znaleziono — zwiększ promień albo zmień rodzaj." : `${answer.results.length} miejsc, najpierw otwarte w porze posiłku.`}
          </p>
          <ul className="flex flex-col gap-1.5">
            {answer.results.map((result, index) => (
              <li key={`${result.name}-${result.lat}-${result.lng}`} className="flex items-start gap-2">
                {isPinnedEatery(doc, itemRef, result) ? (
                  <span className="mt-0.5 text-xs font-semibold text-sea">przypięta</span>
                ) : (
                  <input type="checkbox" checked={picked.has(index)} onChange={() => toggle(index)} className="mt-1" aria-label={`Wybierz ${result.name}`} />
                )}
                <div className="flex flex-col">
                  <span>
                    <strong>{result.name}</strong> <span className="text-zinc-500">· {result.summary}</span>
                  </span>
                  <span className="text-xs">
                    <span className={OPEN[result.open.state].className}>{OPEN[result.open.state].label}</span>
                    {result.address && <span className="text-zinc-500"> · {result.address}</span>}{" "}
                    <a href={`https://www.openstreetmap.org/?mlat=${result.lat}&mlon=${result.lng}#map=18/${result.lat}/${result.lng}`} target="_blank" rel="noreferrer" className="underline">
                      mapa
                    </a>
                    {result.website && (
                      <>
                        {" · "}
                        <a href={/^https?:\/\//i.test(result.website) ? result.website : `https://${result.website}`} target="_blank" rel="noreferrer" className="underline">
                          strona
                        </a>
                      </>
                    )}
                  </span>
                </div>
              </li>
            ))}
          </ul>
          {answer.results.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <button disabled={pending || picked.size === 0} onClick={save} className="btn-primary btn-sm">
                Przypnij i zapisz
              </button>
              <span className="text-xs text-zinc-500">Przypięta knajpa stanie pod posiłkiem. Kilka knajp = „gdzie jemy?” do wyboru w planie i na telefonie (offline).</span>
            </div>
          )}
          <p className="text-[11px] text-zinc-400">© OpenStreetMap · Powered by Geoapify</p>
        </>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

/** Knajpy przypięte do posiłku: kliknięcie pokazuje knajpę na mapie i jej dane; w edycji „wybierz” ustawia wybór grupy (`chosenRef`). */
export function MealEateries({ tripId, doc, ids, itemRef, canEdit, selection }: { tripId: string; doc: TripDocument; ids: Record<string, string>; itemRef: string; canEdit: boolean; selection: MealSelection }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const eateries = mealEateries(doc, itemRef);
  const group = eatOutGroup(doc, itemRef);
  if (eateries.length === 0) return null;

  const choose = (variantRef: string) => {
    if (group === undefined) return;
    const element = { ...group, chosenRef: variantRef };
    start(async () => {
      try {
        await saveElements(createClient(), tripId, { ...doc, variantGroups: doc.variantGroups.map((each) => (each.ref === group.ref ? element : each)) }, [{ collection: "variantGroups", element, op: "update" }], ids);
        setError(null);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  return (
    <div className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">
      <p className="font-semibold">{group === undefined ? "Knajpa" : "Gdzie jemy"}</p>
      <ul className="flex flex-col gap-1">
        {eateries.map((eatery) => {
          const n = selection.numbers[eatery.placeRef];
          return (
            <li key={eatery.placeRef} className="flex flex-wrap items-baseline gap-x-2">
              <button
                type="button"
                onClick={() => selection.onSelect(eatery.placeRef)}
                aria-pressed={selection.selected === eatery.placeRef}
                title="Pokaż knajpę na mapie i jej dane"
                className={`flex items-baseline gap-x-1.5 text-left underline-offset-2 hover:text-sea hover:underline ${selection.selected === eatery.placeRef ? "font-semibold text-sea" : ""}`}>
                {n !== undefined && <span className="flex h-4 min-w-4 items-center justify-center self-center rounded-full bg-sea px-1 text-[10px] font-semibold text-white">{n}</span>}
                <span>
                  {group !== undefined && eatery.active && "✓ "}
                  {eatery.name}
                </span>
              </button>
              {eatery.summary && <span className="text-zinc-500">{eatery.summary}</span>}
              {canEdit && eatery.variantRef !== undefined && !eatery.active && (
                <button disabled={pending} onClick={() => choose(eatery.variantRef!)} className="btn-mini">
                  wybierz
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {error && <span className="text-red-600"> {error}</span>}
    </div>
  );
}
