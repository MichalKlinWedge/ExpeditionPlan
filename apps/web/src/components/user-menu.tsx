import Link from "next/link";

import { signOut } from "@/app/actions";
import { createClient } from "@/lib/supabase/server";

/** Pasek u góry: kto jest zalogowany i wylogowanie. Czyta cookies — renderowany w <Suspense>. */
export async function UserMenu() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) {
    return (
      <Link href="/login" className="text-sm underline">
        Zaloguj
      </Link>
    );
  }
  return (
    <form action={signOut} className="flex items-center gap-3 text-sm text-zinc-600 dark:text-zinc-400">
      <span>{String(data.claims.email ?? "")}</span>
      <button className="underline">Wyloguj</button>
    </form>
  );
}
