import type { Session } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase';

/** Bieżąca sesja; `undefined` = jeszcze nie wiadomo (odczyt z magazynu). */
export function useSession(): Session | null | undefined {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);
  return session;
}

/** Adres powrotu z logowania — przechwytuje go `+native-intent` (bez osobnego ekranu). */
export const AUTH_REDIRECT = 'expeditionplan://auth/callback';
