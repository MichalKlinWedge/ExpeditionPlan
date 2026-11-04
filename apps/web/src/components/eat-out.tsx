"use client";

import { addEatOutChoices, documentProblem, EATERY_KINDS, type EateryKind, eatOutGroup, eatOutOptions, formatDistance, type TripDocument } from "@expeditionplan/core";
import { saveElements, uuidv7 } from "@expeditionplan/sync";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { type EateryAnswer, findRestaurants } from "@/app/eat-out-actions";
import { createClient } from "@/lib/supabase/client";

/**
 * „Knajpy w pobliżu” posiłku na mieście: wyszukiwanie wokół miejsca posiłku albo punktu dnia
 * (akcja serwera, Geoapify Places), zaznaczenie jednej lub kilku i zapis. Jedna = miejsce
 * posiłku; kilka = „gdzie jemy?” do wyboru (warianty) — także na telefonie, offline.
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

export function EatOutSearch({ tripId, doc, ids, itemRef, onClose }: { tripId: string; doc: TripDocument; ids: Record<string, string>; itemRef: string; onClose: () => void }) {
  const router = useRouter();
  const [kinds, setKinds] = useState<EateryKind[]>(["restaurant", "fast_food", "hut"]);
  const [radiusM, setRadiusM] = useState(1000);
  const [diet, setDiet] = useState("");
  const [near, setNear] = useState("");
  const [answer, setAnswer] = useState<EateryAnswer | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const grouped = eatOutGroup(doc, itemRef) !== undefined;

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
        await saveElements(createClient(), tripId, edit.doc, edit.writes, ids);
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
        <button type="button" onClick={onClose} className="px-1 text-xs underline">
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
                <input type="checkbox" checked={picked.has(index)} onChange={() => toggle(index)} className="mt-1" aria-label={`Wybierz ${result.name}`} />
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
                {picked.size <= 1 && !grouped ? "Ustaw jako miejsce posiłku" : `Dodaj do wyboru (${picked.size})`}
              </button>
              <span className="text-xs text-zinc-500">Kilka knajp = „gdzie jemy?” do wyboru w planie i na telefonie (offline).</span>
            </div>
          )}
          <p className="text-[11px] text-zinc-400">© OpenStreetMap · Powered by Geoapify</p>
        </>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

/** Knajpy do wyboru przy posiłku; w edycji „wybierz” ustawia wybór grupy (`chosenRef`). */
export function EatOutOptions({ tripId, doc, ids, itemRef, canEdit }: { tripId: string; doc: TripDocument; ids: Record<string, string>; itemRef: string; canEdit: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const options = eatOutOptions(doc, itemRef);
  const group = eatOutGroup(doc, itemRef);
  if (options.length === 0 || group === undefined) return null;

  const choose = (variantRef: string) => {
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
    <div className="ml-4 text-xs text-zinc-600 dark:text-zinc-400">
      Gdzie jemy:{" "}
      {options.map((option, index) => (
        <span key={option.variantRef}>
          {index > 0 && " · "}
          {option.active ? <strong>✓ {option.label}</strong> : option.label}
          {option.summary && <span className="text-zinc-500"> ({option.summary})</span>}
          {canEdit && !option.active && (
            <button disabled={pending} onClick={() => choose(option.variantRef)} className="px-1 underline">
              wybierz
            </button>
          )}
        </span>
      ))}
      {error && <span className="text-red-600"> {error}</span>}
    </div>
  );
}
