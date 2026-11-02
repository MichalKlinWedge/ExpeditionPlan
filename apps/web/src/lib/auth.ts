import { redirect } from "next/navigation";

import { createClient } from "./supabase/server";

/**
 * Zalogowany użytkownik albo przekierowanie na logowanie (z powrotem pod `next`). `getClaims`
 * weryfikuje token, a nie tylko czyta cookie — `getSession` na serwerze nie jest wiarygodne.
 * Sprawdzenie jest w każdej stronie i akcji, nie tylko w proxy (akcje omijają matcher).
 */
export async function requireUser(next = "/") {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect(`/login?next=${encodeURIComponent(next)}`);
  const app = data.claims.app_metadata as { trip_creator?: boolean } | undefined;
  return { supabase, userId: data.claims.sub, email: data.claims.email as string | undefined, canCreateTrips: app?.trip_creator === true };
}

/** Zakładać wyjazdy mogą konta z flagą `trip_creator` (RLS, migracja trip_creators); reszta ogląda zaproszone. */
export const NO_CREATE = "Zakładanie wyjazdów jest na razie dostępne tylko dla właściciela aplikacji. Do cudzego planu wchodzi się z linku zaproszenia.";
