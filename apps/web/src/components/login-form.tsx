"use client";

import { dbErrorMessage } from "@expeditionplan/sync";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

import { createClient } from "@/lib/supabase/client";

/**
 * Logowanie Google albo linkiem z maila (SPECYFIKACJA M1). Oba wracają przez `/auth/callback`
 * (PKCE), który zakłada sesję w cookies i przenosi pod `next`.
 */
export function LoginForm() {
  const params = useSearchParams();
  const next = params.get("next") ?? "/";
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<{ error?: string; ok?: string }>(
    params.get("error") ? { error: `Logowanie nie powiodło się — spróbuj jeszcze raz.${params.get("error") === "1" ? "" : ` (${params.get("error")})`}` } : {},
  );
  const [pending, setPending] = useState(false);
  const invite = /^\/join\/([A-Za-z0-9_-]+)/.exec(next)?.[1] ?? null;
  const redirectTo = () => `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;

  const google = async () => {
    setPending(true);
    const { error } = await createClient().auth.signInWithOAuth({ provider: "google", options: { redirectTo: redirectTo() } });
    if (error) {
      setStatus({ error: dbErrorMessage(error, "Nie udało się zalogować. Spróbuj jeszcze raz.") });
      setPending(false);
    }
  };

  const magicLink = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    // Nowe konto tylko z linku zaproszenia (`/join/<token>`): token idzie w metadanych, a hook
    // „before user created” w Supabase sprawdza, czy zaproszenie jest ważne.
    const { error } = await createClient().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo(), shouldCreateUser: invite !== null, ...(invite ? { data: { invite } } : {}) },
    });
    setPending(false);
    if (error && /signups? not allowed/i.test(error.message)) {
      setStatus({ error: "Nie ma konta z tym adresem. Konto zakłada się z linku zaproszenia od organizatora wyjazdu." });
      return;
    }
    setStatus(error ? { error: dbErrorMessage(error, "Nie udało się wysłać linku. Spróbuj za chwilę.") } : { ok: `Wysłałem link logowania na ${email}. Otwórz go w tej przeglądarce.` });
  };

  return (
    <div className="flex flex-col gap-6">
      <button
        onClick={google}
        disabled={pending}
        className="btn-secondary">
        Zaloguj przez Google
      </button>
      {invite && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Nie masz jeszcze konta? Pierwszy raz zaloguj się linkiem z maila — konto powstaje z zaproszenia. Później możesz logować się też przez Google (ten sam adres).
        </p>
      )}
      <form onSubmit={magicLink} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          albo link na e-mail
          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="field px-3 py-2 text-sm"
            placeholder="ty@example.com"
          />
        </label>
        <button
          disabled={pending}
          className="btn-primary self-start">
          Wyślij link
        </button>
      </form>
      {status.error && <p className="text-sm msg-error">{status.error}</p>}
      {status.ok && <p className="text-sm msg-ok">{status.ok}</p>}
    </div>
  );
}
