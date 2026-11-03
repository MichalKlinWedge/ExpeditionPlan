"use client";

import { useState, useTransition } from "react";

import { inviteTraveler, type TravelerInviteState } from "@/app/share-actions";

/**
 * „Zaproś” przy osobie z planu bez konta: jednorazowy link dla niej i gotowa wiadomość (link,
 * aplikacja na telefon, instrukcja) do skopiowania albo udostępnienia (SMS, komunikator).
 */
export function TravelerInvite({ tripId, travelerId, name, tripTitle, dates }: { tripId: string; travelerId: string; name: string; tripTitle: string; dates: string }) {
  const [role, setRole] = useState<"viewer" | "editor">("viewer");
  const [state, setState] = useState<TravelerInviteState>({});
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  const message =
    state.token === undefined
      ? null
      : [
          `Cześć ${name}!`,
          `Zapraszam Cię do wyjazdu „${tripTitle}” (${dates}) w Expedition Planner — plan dzień po dniu, mapa i wspólne wydatki.`,
          "",
          `1. Otwórz link (tylko dla Ciebie, ważny 14 dni) i zaloguj się linkiem z maila: ${window.location.origin}/join/${state.token}`,
          state.apkUrl
            ? `2. Aplikacja na telefon (Android): ${state.apkUrl} — otwórz w Chrome, przy ostrzeżeniu wybierz „Zainstaluj mimo to” i zaloguj się tym samym mailem.`
            : "2. Link do aplikacji na telefon (Android) wyślę osobno.",
          `3. Jak to działa: ${window.location.origin}/help`,
        ].join("\n");

  if (message === null) {
    return (
      <span className="flex flex-wrap items-center gap-1.5">
        <select value={role} onChange={(event) => setRole(event.target.value as "viewer" | "editor")} disabled={pending} aria-label={`Rola dla: ${name}`} className="field px-1.5 py-0.5 text-sm">
          <option value="viewer">widz</option>
          <option value="editor">edytor</option>
        </select>
        <button
          type="button"
          disabled={pending}
          onClick={() => start(async () => setState(await inviteTraveler(tripId, travelerId, role)))}
          className="btn-secondary btn-sm">
          {pending ? "tworzę link…" : "Zaproś"}
        </button>
        {state.error && <span className="text-xs text-red-600">{state.error}</span>}
      </span>
    );
  }
  return (
    <span className="flex w-full flex-col gap-1.5">
      <textarea readOnly value={message} rows={7} className="field w-full p-2 text-xs" onFocus={(event) => event.target.select()} aria-label={`Wiadomość z zaproszeniem dla: ${name}`} />
      <span className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-primary btn-sm" onClick={() => void navigator.clipboard.writeText(message).then(() => setCopied(true))}>
          {copied ? "Skopiowano ✓" : "Kopiuj wiadomość"}
        </button>
        {typeof navigator.share === "function" && (
          <button type="button" className="btn-secondary btn-sm" onClick={() => void navigator.share({ text: message }).catch(() => undefined)}>
            Udostępnij…
          </button>
        )}
        <span className="text-xs text-zinc-500">Link pokazuje się tylko teraz — wyślij go od razu.</span>
      </span>
    </span>
  );
}
