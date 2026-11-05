"use client";

import { useActionState, useState, useTransition } from "react";

import type { FormState } from "@/app/actions";
import { createShare, disableShare, type ShareState } from "@/app/share-actions";

/**
 * Publiczny link „tylko do podglądu” dla rodziny i znajomych bez konta. Właściciel wybiera, co ukryć;
 * nowy link unieważnia poprzedni. Link pokazuje się tylko raz (w bazie zostaje skrót).
 */
export function PublicShare({ tripId, enabled, hide }: { tripId: string; enabled: boolean; hide: { costs?: boolean; names?: boolean; lodgingAddress?: boolean } | null }) {
  const [state, action, pending] = useActionState((prev: ShareState, form: FormData) => createShare(tripId, prev, form), {});
  const [off, setOff] = useState<FormState>({});
  const [disabling, start] = useTransition();
  const [copied, setCopied] = useState(false);
  const link = state.token ? `${window.location.origin}/p/${state.token}` : null;
  const on = (key: "costs" | "names" | "lodgingAddress", fallback: boolean) => hide?.[key] ?? fallback;
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-zinc-600 dark:text-zinc-400">
        {enabled ? "Link jest włączony — kto go ma, widzi opis wyprawy, plan dnia i mapę bez logowania." : "Opis wyprawy, plan dnia i mapa pod linkiem, bez logowania — dla rodziny i znajomych bez konta."} Kontakty, budżet, zadania i kody rezerwacji nie są
        pokazywane nigdy. Opisy punktów widać tak, jak je napisano. Opis wyprawy pokazuje też cel i podsumowanie wyjazdu oraz ostrzeżenia, bez zdań z kwotami przy ukrytych cenach; przy ukrytych imionach tych trzech rzeczy nie ma.
      </p>
      <form action={action} className="flex flex-col gap-2">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="costs" defaultChecked={on("costs", true)} /> ukryj ceny i płatności
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="lodgingAddress" defaultChecked={on("lodgingAddress", true)} /> ukryj adresy noclegów
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="names" defaultChecked={on("names", false)} /> zamiast imion „Osoba 1, 2…” na liście osób
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button disabled={pending} className="btn-primary">
            {pending ? "Tworzę…" : enabled ? "Nowy link (stary przestanie działać)" : "Utwórz publiczny link"}
          </button>
          {enabled && (
            <button type="button" disabled={disabling} onClick={() => start(async () => setOff(await disableShare(tripId)))} className="btn-secondary">
              Wyłącz link
            </button>
          )}
        </div>
      </form>
      {state.error && <p className="text-red-600">{state.error}</p>}
      {off.error && <p className="text-red-600">{off.error}</p>}
      {off.ok && <p className="text-green-700 dark:text-green-400">{off.ok}</p>}
      {link && (
        <div className="flex flex-col gap-2 rounded-xl bg-zinc-100 p-3 dark:bg-zinc-800">
          <p>{state.ok}</p>
          <code className="break-all">{link}</code>
          <button type="button" className="btn-secondary self-start" onClick={() => void navigator.clipboard.writeText(link).then(() => setCopied(true))}>
            {copied ? "Skopiowano" : "Kopiuj link"}
          </button>
        </div>
      )}
    </div>
  );
}
