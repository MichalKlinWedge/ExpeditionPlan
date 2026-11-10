"use client";

import {
  addEatOutChoices,
  cuisineOptions,
  DEFAULT_EATERY_FILTER,
  documentProblem,
  EATERY_KINDS,
  type EateryAnswer,
  type EateryFilter,
  type EateryKind,
  type EateryResult,
  eateryResultsMap,
  eatOutGroup,
  filterEateries,
  formatDistance,
  googleMapsSearchUrl,
  isPinnedEatery,
  mealEateries,
  removeEatOutChoice,
  type TripDocument,
} from "@expeditionplan/core";
import { saveElements, uuidv7 } from "@expeditionplan/sync";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { findRestaurants } from "@/app/eat-out-actions";
import { IconAction } from "@/components/icon-action";
import type { MealSelection } from "@/components/meal-row";
import { PlanMap } from "@/components/plan-map";
import { PlaceLink } from "@/components/place-pin";
import { createClient } from "@/lib/supabase/client";

/**
 * „Knajpy w pobliżu” posiłku na mieście: wyszukiwanie wokół miejsca posiłku albo punktu dnia
 * albo drogi między punktami (akcja serwera, Geoapify Places + polecenia Wikivoyage + nasze oceny), filtry
 * (zamknięte, sieciówki, kuchnia, tylko polecane), zaznaczenie jednej lub kilku i przypięcie. Jedna = miejsce
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
/** Tyle wyników naraz; resztę pokazuje „pokaż więcej”. */
const PAGE = 25;

export function EatOutSearch({ tripId, doc, ids, itemRef, onClose, onPinned }: { tripId: string; doc: TripDocument; ids: Record<string, string>; itemRef: string; onClose: () => void; onPinned: (placeRef: string, names: string[]) => void }) {
  const router = useRouter();
  const [kinds, setKinds] = useState<EateryKind[]>(["restaurant", "fast_food", "hut"]);
  const [radiusM, setRadiusM] = useState(1000);
  const [diet, setDiet] = useState("");
  const [near, setNear] = useState("");
  const [placeRef, setPlaceRef] = useState("");
  const places = doc.places.filter((place) => place.lat !== undefined && place.lng !== undefined).sort((a, b) => a.name.localeCompare(b.name, "pl"));
  const [answer, setAnswer] = useState<EateryAnswer | null>(null);
  const [picked, setPicked] = useState<Set<EateryResult>>(new Set());
  const [filter, setFilter] = useState<EateryFilter>(DEFAULT_EATERY_FILTER);
  const [limit, setLimit] = useState(PAGE);
  const [selected, setSelected] = useState<string | null>(null);
  const [searchNo, setSearchNo] = useState(0);
  const mapBox = useRef<HTMLDivElement>(null);
  const cuisineBox = useRef<HTMLDetailsElement>(null);
  // Lista kuchni zwija się po kliknięciu obok, po wyjściu z niej klawiszem Tab i po Esc.
  useEffect(() => {
    const close = (event: Event) => {
      const box = cuisineBox.current;
      if (box?.open && !box.contains(event.target as Node)) box.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && cuisineBox.current?.open) cuisineBox.current.open = false;
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("focusin", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("focusin", close);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const search = () =>
    start(async () => {
      setError(null);
      setPicked(new Set());
      setLimit(PAGE);
      setFilter((current) => ({ ...current, cuisines: [] }));
      setSelected(null);
      setSearchNo((n) => n + 1);
      setAnswer(await findRestaurants(tripId, itemRef, { kinds, radiusM, ...(diet ? { diet: diet as "vegetarian" } : {}), ...(placeRef ? { placeRef } : near.trim() ? { near } : {}) }));
    });

  const save = () => {
    if (answer === null || "error" in answer) return;
    const picks = answer.results.filter((result) => picked.has(result)).map((result) => ({ eatery: result, summary: result.summary }));
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

  const toggle = (result: EateryResult) =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(result)) next.delete(result);
      else next.add(result);
      return next;
    });
  const results = answer !== null && "results" in answer ? answer.results : [];
  const shown = filterEateries(results, filter);
  const cuisines = cuisineOptions(results);
  // Numer = pozycja na liście po filtrach; ten sam na mapie pod listą.
  const resultMap = eateryResultsMap(shown);
  const rowId = (key: string) => `knajpa-${itemRef}-${key}`;
  const fromList = (key: string) => {
    setSelected(key);
    mapBox.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };
  const fromMap = (key: string) => {
    setSelected(key);
    const index = resultMap.keys.indexOf(key);
    if (index >= limit) setLimit(index + 1);
    // Wiersz spoza strony pojawia się dopiero po odświeżeniu listy.
    requestAnimationFrame(() => document.getElementById(rowId(key))?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  };
  const toggleCuisine = (key: string) => setFilter((current) => ({ ...current, cuisines: current.cuisines.includes(key) ? current.cuisines.filter((each) => each !== key) : [...current.cuisines, key] }));
  const flag = (key: "hideClosed" | "noChains" | "onlyRecommended", label: string) => (
    <label className="flex items-center gap-1">
      <input type="checkbox" checked={filter[key]} onChange={(event) => setFilter((current) => ({ ...current, [key]: event.target.checked }))} />
      {label}
    </label>
  );

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
        <label className="flex min-w-40 flex-col gap-1 text-xs text-zinc-500">
          Wokół miejsca z wyjazdu
          <select
            value={placeRef}
            onChange={(event) => {
              setPlaceRef(event.target.value);
              if (event.target.value !== "") setNear("");
            }}
            className={input}>
            <option value="">miejsce posiłku lub punkt dnia</option>
            {places.map((place) => (
              <option key={place.ref} value={place.ref}>
                {place.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-zinc-500">
          albo okolica lub współrzędne
          <input
            value={near}
            onChange={(event) => {
              setNear(event.target.value);
              if (event.target.value.trim() !== "") setPlaceRef("");
            }}
            placeholder="ulica, zabytek, 41.4036, 2.1744 albo link z mapy"
            title="Nazwa okolicy (szukana w kraju wyjazdu), współrzędne albo link z Google Maps / OpenStreetMap"
            className={input}
          />
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
            {answer.route ? `Po drodze: ${answer.route.from} → ${answer.route.to}` : `W pobliżu: ${answer.center.near}`} ·{" "}
            {results.length === 0 ? "nic nie znaleziono — zwiększ promień albo zmień rodzaj." : `${shown.length} z ${results.length} miejsc po filtrach; najpierw otwarte w porze posiłku i polecane.`}
          </p>
          {results.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              {flag("hideClosed", "ukryj zamknięte w porze posiłku")}
              {flag("noChains", "bez sieciówek")}
              {flag("onlyRecommended", "tylko polecane (Wikivoyage, nasze 👍)")}
              {cuisines.length > 0 && (
                <details ref={cuisineBox} className="relative">
                  <summary className="field cursor-pointer list-none px-2 py-1 text-xs">
                    Kuchnia: {filter.cuisines.length === 0 ? "każda" : filter.cuisines.join(", ")} ▾
                  </summary>
                  <div className="absolute z-20 mt-1 flex max-h-72 w-64 flex-col gap-1 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                    {filter.cuisines.length > 0 && (
                      <button type="button" onClick={() => setFilter((current) => ({ ...current, cuisines: [] }))} className="btn-mini self-start">
                        każda (wyczyść)
                      </button>
                    )}
                    {cuisines.map((each) => (
                      <label key={each.key} className="flex items-center gap-1.5">
                        <input type="checkbox" checked={filter.cuisines.includes(each.key)} onChange={() => toggleCuisine(each.key)} />
                        {each.label} <span className="text-zinc-500">({each.count})</span>
                      </label>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}
          <ul className="flex flex-col gap-1.5">
            {shown.slice(0, limit).map((result, index) => {
              const key = resultMap.keys[index]!;
              return (
                <li key={key} id={rowId(key)} className={`flex scroll-mt-4 items-start gap-2 rounded ${selected === key ? "bg-sea/10" : ""}`}>
                  <button type="button" onClick={() => fromList(key)} aria-pressed={selected === key} title="Pokaż na mapie pod listą" className={`mt-0.5 flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1 text-[11px] font-semibold text-white ${selected === key ? "bg-signal" : "bg-sea"}`}>
                    {index + 1}
                  </button>
                  {isPinnedEatery(doc, itemRef, result) ? (
                    <span className="mt-0.5 text-xs font-semibold text-sea">przypięta</span>
                  ) : (
                    <input type="checkbox" checked={picked.has(result)} onChange={() => toggle(result)} className="mt-1" aria-label={`Wybierz ${result.name}`} />
                  )}
                  <div className="flex min-w-0 flex-col">
                    <span>
                      <strong>{result.name}</strong> <span className="text-zinc-500">· {result.summary}</span>
                      {result.chain && <span className="text-zinc-500"> · sieć</span>}
                      {result.memory && (
                        <span title={result.memory.notes.join("\n") || "nasze oceny z innych wyjazdów"} className="ml-1 text-xs font-semibold text-sea">
                          {[result.memory.worth > 0 ? `👍 ${result.memory.worth}` : "", result.memory.notWorth > 0 ? `👎 ${result.memory.notWorth}` : "", result.memory.notes.length > 0 ? "📝" : ""].filter(Boolean).join(" ")}
                        </span>
                      )}
                    </span>
                    {result.tip && (result.tip.text || result.tip.price) && (
                      <span className="text-xs text-emerald-800 dark:text-emerald-300">
                        {result.tip.text && <>„{result.tip.text}”</>}
                        {result.tip.price && <> · cena: {result.tip.price}</>}
                        {result.tip.year && <span className="text-zinc-500"> · wpis z {result.tip.year}</span>}
                      </span>
                    )}
                    <span className="text-xs">
                      <span className={OPEN[result.open.state].className}>{OPEN[result.open.state].label}</span>
                      {result.address && <span className="text-zinc-500"> · {result.address}</span>}{" "}
                      <a href={googleMapsSearchUrl(result)} target="_blank" rel="noreferrer" title="Opinie i średnia ocena w Mapach Google (otwiera Google, nic nie pobieramy)" className="underline">
                        opinie w Google
                      </a>
                      {" · "}
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
                      {result.tip && (
                        <>
                          {" · "}
                          <a href={result.tip.url} target="_blank" rel="noreferrer" className="underline">
                            Wikivoyage
                          </a>
                        </>
                      )}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
          {shown.length > limit && (
            <button type="button" onClick={() => setLimit((current) => current + PAGE)} className="btn-mini self-start">
              pokaż więcej ({shown.length - limit})
            </button>
          )}
          {results.length > 0 && shown.length === 0 && <p className="text-xs text-zinc-500">Filtry odsiały wszystko — odznacz któryś.</p>}
          {shown.length > 0 && (
            <div ref={mapBox} className="flex scroll-mt-4 flex-col gap-1">
              <PlanMap map={resultMap.map} fitKey={`knajpy-${searchNo}-${shown.length}`} square selected={selected} onSelect={fromMap} emptyText="Żaden wynik nie ma współrzędnych." />
              <p className="text-xs text-zinc-500">Numery na mapie to numery na liście: kliknięcie pinezki przewija do knajpy, a numeru na liście — do mapy.</p>
            </div>
          )}
          {results.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <button disabled={pending || picked.size === 0} onClick={save} className="btn-primary btn-sm">
                Przypnij i zapisz
              </button>
              <span className="text-xs text-zinc-500">Przypięta knajpa stanie pod posiłkiem. Kilka knajp = „gdzie jemy?” do wyboru w planie i na telefonie (offline).</span>
            </div>
          )}
          <p className="text-[11px] text-zinc-400">
            © OpenStreetMap · Powered by Geoapify
            {answer.tipSources.length > 0 && (
              <>
                {" · Polecenia: "}
                {answer.tipSources.map((source, index) => (
                  <span key={source.url}>
                    {index > 0 && ", "}
                    <a href={source.url} target="_blank" rel="noreferrer" className="underline">
                      Wikivoyage: {source.title}
                    </a>
                  </span>
                ))}{" "}
                (
                <a href="https://creativecommons.org/licenses/by-sa/4.0/deed.pl" target="_blank" rel="noreferrer" className="underline">
                  CC BY-SA 4.0
                </a>
                )
              </>
            )}
          </p>
        </>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

/** Knajpy przypięte do posiłku: kliknięcie pokazuje knajpę na mapie i jej dane; w edycji „wybierz” ustawia wybór grupy (`chosenRef`), a kosz odpina knajpę (`removeEatOutChoice`). */
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

  const unpin = (placeRef: string, name: string) => {
    const edit = removeEatOutChoice(doc, itemRef, placeRef);
    if (edit === null || !window.confirm(`Odpiąć „${name}” od posiłku? Miejsce zostaje w planie (usuniesz je w „Miejscach”).`)) return;
    const invalid = documentProblem(edit.doc);
    if (invalid !== null) return setError(`Nie zapisano: ${invalid}`);
    start(async () => {
      try {
        await saveElements(createClient(), tripId, edit.doc, edit.writes, ids);
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
            <li key={eatery.placeRef} className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {selection.href ? (
                <Link href={selection.href(eatery.placeRef)} title="Posiłek i knajpa na stronie Posiłki" className="btn-mini">
                  {group !== undefined && eatery.active && "✓ "}
                  {eatery.name}
                </Link>
              ) : (
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
              )}
              <PlaceLink tripId={tripId} place={{ ref: eatery.placeRef, name: eatery.name }} />
              {eatery.summary && <span className="text-zinc-500">{eatery.summary}</span>}
              {canEdit && eatery.variantRef !== undefined && !eatery.active && (
                <button disabled={pending} onClick={() => choose(eatery.variantRef!)} className="btn-mini">
                  wybierz
                </button>
              )}
              {canEdit && <IconAction kind="remove" tip="odepnij knajpę od posiłku (miejsce zostaje w planie)" disabled={pending} onClick={() => unpin(eatery.placeRef, eatery.name)} />}
            </li>
          );
        })}
      </ul>
      {error && <span className="text-red-600"> {error}</span>}
    </div>
  );
}
