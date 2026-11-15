"use client";

import { useSyncExternalStore } from "react";

/**
 * Filtr listy „Trasy” (rodzaj, „tylko bez planu”, kolejność) pamiętany na czas karty przeglądarki,
 * osobno dla każdego wyjazdu: wejście w trasę i powrót z jej strony zastaje listę tak ustawioną, jak
 * była. Ten sam wzorzec co `extra-filter.ts`, tylko w `sessionStorage` — to ustawienie jednego
 * przeglądania, nie stałe upodobanie.
 */

export type RouteFilterState = { shown: "all" | "foot" | "car"; unplanned: boolean; sort: "day" | "name" };

export const DEFAULT_ROUTE_FILTER: RouteFilterState = { shown: "all", unplanned: false, sort: "day" };

const EVENT = "trasy-filtr";
const storageKey = (tripId: string) => `trasy-filtr:${tripId}`;

function readRaw(tripId: string): string | null {
  try {
    return sessionStorage.getItem(storageKey(tripId));
  } catch {
    return null;
  }
}

function parse(raw: string | null): RouteFilterState {
  try {
    const value = JSON.parse(raw ?? "null") as Partial<RouteFilterState> | null;
    if (value === null) return DEFAULT_ROUTE_FILTER;
    return {
      shown: value.shown === "foot" || value.shown === "car" ? value.shown : "all",
      unplanned: value.unplanned === true,
      sort: value.sort === "name" ? "name" : "day",
    };
  } catch {
    return DEFAULT_ROUTE_FILTER;
  }
}

// Zapamiętana wartość musi być tym samym obiektem między odczytami, inaczej `useSyncExternalStore` kręci się w kółko.
const cache = new Map<string, { raw: string | null; value: RouteFilterState }>();

function snapshot(tripId: string): RouteFilterState {
  const raw = readRaw(tripId);
  const hit = cache.get(tripId);
  if (hit !== undefined && hit.raw === raw) return hit.value;
  const value = parse(raw);
  cache.set(tripId, { raw, value });
  return value;
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  return () => window.removeEventListener(EVENT, onChange);
}

export function setRouteFilter(tripId: string, next: RouteFilterState) {
  const raw = JSON.stringify(next);
  try {
    sessionStorage.setItem(storageKey(tripId), raw);
  } catch {
    // Bez pamięci filtr działa do przejścia na inną stronę.
    cache.set(tripId, { raw: readRaw(tripId), value: next });
  }
  window.dispatchEvent(new Event(EVENT));
}

/** Filtr tego wyjazdu; na serwerze i przed hydratacją — domyślny, więc nic się nie rozjeżdża. */
export function useRouteFilter(tripId: string): RouteFilterState {
  return useSyncExternalStore(
    subscribe,
    () => snapshot(tripId),
    () => DEFAULT_ROUTE_FILTER,
  );
}
