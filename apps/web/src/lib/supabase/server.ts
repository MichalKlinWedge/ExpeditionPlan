import type { Database } from "@expeditionplan/db";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { connection } from "next/server";

import { SUPABASE_KEY, SUPABASE_URL } from "./env";

/**
 * Klient Supabase na serwerze — nowy na każde żądanie, sesja z cookies. `connection()`: klient
 * sprawdza ważność tokenu zegarem (`Date.now()`), czego Next z `cacheComponents` nie pozwala
 * robić przy prerenderze — renderowanie czeka więc na prawdziwe żądanie.
 */
export async function createClient() {
  await connection();
  const cookieStore = await cookies();
  return createServerClient<Database>(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Server Component nie ustawia cookies — sesję odświeża proxy przy następnym żądaniu.
        }
      },
    },
  });
}
