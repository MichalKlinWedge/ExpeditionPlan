import { type NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

/**
 * Powrót z logowania Google i z linku z maila (PKCE): kod → sesja w cookies → strona `next`.
 * `next` tylko z tej samej domeny — inaczej link logowania byłby otwartym przekierowaniem.
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const next = new URL(request.nextUrl.searchParams.get("next") ?? "/", request.url);
  const target = next.origin === request.nextUrl.origin ? next : new URL("/", request.url);
  // Powód błędu idzie na stronę logowania — bez niego „nie powiodło się” niczego nie mówi.
  let reason = request.nextUrl.searchParams.get("error_description") ?? (code ? "" : "brak kodu logowania");
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(target);
    reason = error.message;
  }
  return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(reason || "1")}&next=${encodeURIComponent(target.pathname)}`, request.url));
}
