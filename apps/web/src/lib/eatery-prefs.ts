"use client";

import { type EaterySearchPrefs, readEaterySearchPrefs } from "@expeditionplan/core";
import { useCallback, useEffect, useRef, useState } from "react";

import { createClient } from "@/lib/supabase/client";

/**
 * Wybory „Knajpy w pobliżu” zapamiętane dla konta (`user_settings.eatery_search`, RLS: tylko moje), te same
 * na webie i telefonie. `prefs` = `null`, póki się wczytują; `save` zapisuje z opóźnieniem (seria kliknięć
 * w checkboxy to jeden zapis). Błąd zapisu tylko w konsoli: wyszukiwanie działa i bez pamięci.
 */
export function useEaterySearchPrefs(): [EaterySearchPrefs | null, (prefs: EaterySearchPrefs) => void] {
  const [prefs, setPrefs] = useState<EaterySearchPrefs | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    void createClient()
      .from("user_settings")
      .select("eatery_search")
      .maybeSingle()
      .then(({ data }) => {
        if (alive) setPrefs(readEaterySearchPrefs(data?.eatery_search));
      });
    return () => {
      alive = false;
    };
  }, []);

  const save = useCallback((next: EaterySearchPrefs) => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void createClient()
        .from("user_settings")
        .upsert({ eatery_search: next, updated_at: new Date().toISOString() }, { onConflict: "user_id" })
        .then(({ error }) => {
          if (error) console.warn("Nie zapamiętano wyborów knajp:", error.message);
        });
    }, 600);
  }, []);

  return [prefs, save];
}
