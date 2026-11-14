"use client";

import { EXTRA_CATEGORY, type ExtraCategory, type ExtraFilter, NOTABLE_EXTRAS } from "@expeditionplan/core";
import { useSyncExternalStore } from "react";

/**
 * Filtr „Po drodze i w pobliżu” (rodzaje, atrakcyjność): ustawienie oglądającego w tej przeglądarce, wspólne dla
 * wszystkich dni i wyjazdów; lista pod dniem, gwiazdki na mapie i znaczniki przy punktach czytają ten sam stan.
 * Domyślnie bez drobnych (atrakcyjność 1).
 */
const KEY = "po-drodze-filtr";
const EVENT = "po-drodze-filtr";
export const DEFAULT_EXTRA_FILTER: ExtraFilter = NOTABLE_EXTRAS;

function readRaw(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function parse(raw: string | null): ExtraFilter {
  try {
    const value = JSON.parse(raw ?? "null") as { categories?: unknown; minInterest?: unknown } | null;
    if (value === null || ![1, 2, 3].includes(value.minInterest as number) || !Array.isArray(value.categories)) return DEFAULT_EXTRA_FILTER;
    return { minInterest: value.minInterest as 1 | 2 | 3, categories: value.categories.filter((each): each is ExtraCategory => typeof each === "string" && each in EXTRA_CATEGORY) };
  } catch {
    return DEFAULT_EXTRA_FILTER;
  }
}

let cache: { raw: string | null; value: ExtraFilter } = { raw: null, value: DEFAULT_EXTRA_FILTER };
function snapshot(): ExtraFilter {
  const raw = readRaw();
  if (raw !== cache.raw) cache = { raw, value: parse(raw) };
  return cache.value;
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function setExtraFilter(next: ExtraFilter) {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    cache = { raw: JSON.stringify(next), value: next };
  }
  window.dispatchEvent(new Event(EVENT));
}

export function useExtraFilter(): ExtraFilter {
  return useSyncExternalStore(subscribe, snapshot, () => DEFAULT_EXTRA_FILTER);
}
