"use client";

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
  const redirectTo = () => `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;

  const google = async () => {
    setPending(true);
    const { error } = await createClient().auth.signInWithOAuth({ provider: "google", options: { redirectTo: redirectTo() } });
    if (error) {
      setStatus({ error: error.message });
      setPending(false);
    }
  };

  const magicLink = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    // Nowe konto tylko z linku zaproszenia (`/join/…`); poza nim link dostają istniejące konta.
    const invited = next.startsWith("/join/");
    const { error } = await createClient().auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo(), shouldCreateUser: invited } });
    setPending(false);
    if (error && /signups? not allowed/i.test(error.message)) {
      setStatus({ error: "Nie ma konta z tym adresem. Konto zakłada się z linku zaproszenia od organizatora wyjazdu." });
      return;
    }
    setStatus(error ? { error: error.message } : { ok: `Wysłałem link logowania na ${email}. Otwórz go w tej przeglądarce.` });
  };

  return (
    <div className="flex flex-col gap-6">
      <button
        onClick={google}
        disabled={pending}
        className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium disabled:opacity-50 dark:border-zinc-700">
        Zaloguj przez Google
      </button>
      <form onSubmit={magicLink} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          albo link na e-mail
          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
            placeholder="ty@example.com"
          />
        </label>
        <button
          disabled={pending}
          className="self-start rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900">
          Wyślij link
        </button>
      </form>
      {status.error && <p className="text-sm text-red-600">{status.error}</p>}
      {status.ok && <p className="text-sm text-green-700 dark:text-green-400">{status.ok}</p>}
    </div>
  );
}
