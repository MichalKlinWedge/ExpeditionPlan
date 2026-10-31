import 'react-native-url-polyfill/auto';
import 'expo-sqlite/localStorage/install';

import type { Database } from '@expeditionplan/db';
import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';

/**
 * Klient Supabase w aplikacji. Sesja w `localStorage` z expo-sqlite (przeżywa restart, bez limitu
 * 2 KB SecureStore). PKCE: logowanie Google i link z maila wracają kodem, który wymienia się na
 * sesję w tej samej aplikacji (`code_verifier` leży w tym samym magazynie).
 * Klucz `publishable` może być w APK — dostępu pilnuje RLS.
 */
const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const isConfigured = url !== '' && key !== '';

export const supabase = createClient<Database>(isConfigured ? url : 'http://localhost', isConfigured ? key : 'brak', {
  auth: { storage: localStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false, flowType: 'pkce' },
});

// Odświeżanie tokenu tylko na pierwszym planie (zalecenie Supabase dla React Native).
AppState.addEventListener('change', (state) => {
  if (state === 'active') void supabase.auth.startAutoRefresh();
  else void supabase.auth.stopAutoRefresh();
});
