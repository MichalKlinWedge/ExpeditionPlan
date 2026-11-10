import { type EaterySearchPrefs, readEaterySearchPrefs } from '@expeditionplan/core';
import { useCallback, useEffect, useRef, useState } from 'react';

import { supabase } from '@/lib/supabase';

/**
 * Wybory „Knajpy w pobliżu” zapamiętane dla konta (`user_settings.eatery_search`), te same co na webie.
 * Wczytuje się dopiero po otwarciu karty (`enabled`), bo wyszukiwanie i tak wymaga sieci; bez sieci albo
 * przy błędzie zostają domyślne. `save` zapisuje z opóźnieniem — seria stuknięć w chipy to jeden zapis.
 */
export function useEaterySearchPrefs(enabled: boolean): [EaterySearchPrefs | null, (prefs: EaterySearchPrefs) => void] {
  const [prefs, setPrefs] = useState<EaterySearchPrefs | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled || prefs !== null) return;
    let alive = true;
    void supabase
      .from('user_settings')
      .select('eatery_search')
      .maybeSingle()
      .then(
        ({ data }) => {
          if (alive) setPrefs(readEaterySearchPrefs(data?.eatery_search));
        },
        () => {
          if (alive) setPrefs({});
        },
      );
    return () => {
      alive = false;
    };
  }, [enabled, prefs]);

  const save = useCallback((next: EaterySearchPrefs) => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void supabase
        .from('user_settings')
        .upsert({ eatery_search: next, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
        .then(({ error }) => {
          if (error) console.warn('Nie zapamiętano wyborów knajp:', error.message);
        });
    }, 600);
  }, []);

  return [prefs, save];
}
