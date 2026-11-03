import { missingOnMap, type TripDocument } from "@expeditionplan/core";

import { ITEM_KIND } from "@/lib/labels";

/**
 * Lista puli na webie: grupowanie (obszar, rodzaj, status) i filtry (opis przewodnika, brak na mapie,
 * „koniecznie”, tekst) z licznikami — przy kilkudziesięciu pomysłach łatwiej wybrać, co wstawić do dnia.
 */

type Item = TripDocument["items"][number];

export type PoolGroupBy = "area" | "kind" | "status";
/** Opis przewodnika: wszystkie, tylko z opisem albo tylko bez — jeden wybór, nie dwa filtry. */
export type PoolGuide = "all" | "guided" | "unguided";
export type PoolFilter = "offMap" | "must";
export type PoolQuery = { groupBy: PoolGroupBy; guide: PoolGuide; filters: PoolFilter[]; text: string };

export const POOL_GROUP: Record<PoolGroupBy, string> = { area: "obszar", kind: "rodzaj", status: "status" };
export const POOL_GUIDE: Record<PoolGuide, string> = { all: "wszystkie", guided: "📖 z opisem", unguided: "bez opisu" };
export const POOL_FILTER: Record<PoolFilter, string> = { offMap: "brak na mapie", must: "koniecznie" };
export const EMPTY_POOL_QUERY: PoolQuery = { groupBy: "area", guide: "all", filters: [], text: "" };

const STATUS: Record<string, string> = { candidate: "kandydaci", alternative: "alternatywy", does_not_fit: "nie mieszczą się", rejected: "odrzucone", scheduled: "w planie" };
const PRIORITY: Record<string, number> = { must: 0, should: 1, optional: 2 };

const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export function guideMatches(item: Item, guided: ReadonlySet<string>, guide: PoolGuide): boolean {
  return guide === "all" || (guide === "guided") === guided.has(item.ref);
}

export function poolMatches(doc: TripDocument, item: Item, filter: PoolFilter): boolean {
  switch (filter) {
    case "offMap":
      return missingOnMap(doc, item);
    case "must":
      return item.priority === "must";
  }
}

/** Grupy po filtrach (opis + zaznaczone filtry naraz — „i”), w każdej najpierw „koniecznie”, potem kolejność puli. */
export function poolGroups(doc: TripDocument, pool: readonly Item[], guided: ReadonlySet<string>, query: PoolQuery): { key: string; label: string; items: Item[] }[] {
  const text = normalize(query.text.trim());
  const places = new Map(doc.places.map((place) => [place.ref, place.name]));
  const shown = pool.filter(
    (item) =>
      guideMatches(item, guided, query.guide) &&
      query.filters.every((filter) => poolMatches(doc, item, filter)) &&
      (text === "" || normalize([item.title, item.description, item.area, places.get(item.placeRef ?? ""), ...item.notes].filter(Boolean).join(" ")).includes(text)),
  );
  const keyOf = (item: Item) => (query.groupBy === "area" ? (item.area ?? "") : query.groupBy === "kind" ? item.kind : item.planStatus);
  const labelOf = (key: string) => (query.groupBy === "area" ? key || "bez obszaru" : query.groupBy === "kind" ? (ITEM_KIND[key] ?? key) : (STATUS[key] ?? key));
  const groups = new Map<string, Item[]>();
  for (const item of shown) groups.set(keyOf(item), [...(groups.get(keyOf(item)) ?? []), item]);
  return [...groups].map(([key, items]) => ({
    key,
    label: labelOf(key),
    items: [...items].sort((a, b) => (PRIORITY[a.priority ?? "should"] ?? 1) - (PRIORITY[b.priority ?? "should"] ?? 1)),
  }));
}

/** Liczby do etykiet przycisków: opis (wszystkie / z opisem / bez) i filtry. */
export const guideCount = (pool: readonly Item[], guided: ReadonlySet<string>, guide: PoolGuide) => pool.filter((item) => guideMatches(item, guided, guide)).length;
export const poolCount = (doc: TripDocument, pool: readonly Item[], filter: PoolFilter) => pool.filter((item) => poolMatches(doc, item, filter)).length;
