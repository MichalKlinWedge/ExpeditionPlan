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
  return { supabase, userId: data.claims.sub, email: data.claims.email as string | undefined };
}
