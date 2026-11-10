"use client";

import { useState, useTransition } from "react";

import type { FormState } from "@/app/actions";
import { emailTravelerInvite, inviteTraveler, type TravelerInviteState } from "@/app/share-actions";
import { travelerInviteMessage } from "@/lib/invite-message";

/**
 * „Zaproś” przy osobie z planu bez konta: jednorazowy link dla niej i gotowa wiadomość (link,
 * aplikacja na telefon, instrukcja) do wysłania e-mailem z serwisu (gdy jest SMTP), skopiowania
 * albo udostępnienia (SMS, komunikator).
 */
export function TravelerInvite({ tripId, travelerId, name, tripTitle, dates }: { tripId: string; travelerId: string; name: string; tripTitle: string; dates: string }) {
  const [role, setRole] = useState<"viewer" | "editor">("viewer");
  const [state, setState] = useState<TravelerInviteState>({});
  const [copied, setCopied] = useState(false);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<FormState>({});
  const [pending, start] = useTransition();

  const message = state.token === undefined ? null : travelerInviteMessage({ name, tripTitle, dates, origin: window.location.origin, token: state.token, apkUrl: state.apkUrl });

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
        {state.error && <span className="text-xs msg-error">{state.error}</span>}
      </span>
    );
  }
  return (
    <span className="flex w-full flex-col gap-1.5">
      <textarea readOnly value={message} rows={7} className="field w-full p-2 text-xs" onFocus={(event) => event.target.select()} aria-label={`Wiadomość z zaproszeniem dla: ${name}`} />
      {state.canEmail && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            start(async () => setSent(await emailTravelerInvite(tripId, travelerId, state.token!, email)));
          }}>
          <input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} disabled={pending} placeholder="adres@example.com" aria-label={`E-mail: ${name}`} className="field min-w-52 flex-1 px-2 py-1 text-sm" />
          <button disabled={pending} className="btn-primary btn-sm">
            {pending ? "Wysyłam…" : "Wyślij e-mailem"}
          </button>
          {sent.ok && <span className="text-xs msg-ok">{sent.ok}</span>}
          {sent.error && <span className="text-xs msg-error">{sent.error}</span>}
        </form>
      )}
      <span className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-secondary btn-sm" onClick={() => void navigator.clipboard.writeText(message).then(() => setCopied(true))}>
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
