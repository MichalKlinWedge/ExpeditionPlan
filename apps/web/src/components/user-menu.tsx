import Link from "next/link";

import { signOut } from "@/app/actions";
import { createClient } from "@/lib/supabase/server";

/** Pasek u góry (na granatowym tle): kto jest zalogowany i wylogowanie. Czyta cookies — renderowany w <Suspense>. */
export async function UserMenu() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) {
    return (
      <Link href="/login" className="rounded-lg border border-white/30 px-3 py-1.5 text-sm font-medium hover:bg-white/10">
        Zaloguj
      </Link>
    );
  }
  return (
    <form action={signOut} className="flex items-center gap-3 text-sm text-zinc-300">
      <span className="hidden sm:inline">{String(data.claims.email ?? "")}</span>
      <button className="rounded-lg border border-white/30 px-3 py-1.5 font-medium text-white hover:bg-white/10">Wyloguj</button>
    </form>
  );
}
