"use client";

import { useState, useTransition } from "react";

import type { FormState } from "@/app/actions";
import { addKnownMember, type KnownAccount } from "@/app/share-actions";

/**
 * „Dodaj z moich wyjazdów” (organizator, po „Edytuj”): osoby, które już mają konto i są w innych
 * wyjazdach organizatora, dostają dostęp od razu, bez linku zaproszenia. Rola, opcjonalnie uczestnik
 * planu bez konta i e-mail „masz dostęp”. Lista z `known_accounts` (nigdy cała baza kont).
 */
export function KnownAccounts({ tripId, accounts, travelers, canMail }: { tripId: string; accounts: KnownAccount[]; travelers: { id: string; name: string }[]; canMail: boolean }) {
  if (accounts.length === 0) return null;
  return (
    <details className="flex flex-col gap-2 text-sm">
      <summary className="cursor-pointer font-medium">Dodaj z moich wyjazdów ({accounts.length})</summary>
      <p className="mt-1 text-xs text-zinc-500">Osoby z Twoich innych wyjazdów: dostęp od razu, bez linku zaproszenia.{canMail ? " Mogą dostać e-mail, że mają dostęp." : ""}</p>
      <ul className="mt-2 flex flex-col divide-y divide-zinc-100 dark:divide-zinc-900">
        {accounts.map((account) => (
          <KnownRow key={account.user_id} tripId={tripId} account={account} travelers={travelers} canMail={canMail} />
        ))}
      </ul>
    </details>
  );
}

function KnownRow({ tripId, account, travelers, canMail }: { tripId: string; account: KnownAccount; travelers: { id: string; name: string }[]; canMail: boolean }) {
  const name = account.display_name ?? account.email ?? "?";
  // Podpowiedź uczestnika: ktoś bez konta o tym samym imieniu.
  const first = name.split(/\s+/)[0]?.toLowerCase() ?? "";
  const [role, setRole] = useState<"viewer" | "editor">("viewer");
  const [traveler, setTraveler] = useState(travelers.find((each) => each.name.toLowerCase().split(/\s+/)[0] === first)?.id ?? "");
  const [notify, setNotify] = useState(canMail);
  const [state, setState] = useState<FormState>({});
  const [pending, start] = useTransition();
  return (
    <li className="flex flex-col gap-1 py-2">
      <span>
        <span className="font-medium">{name}</span>
        {account.display_name && account.email && <span className="text-xs text-zinc-500"> · {account.email}</span>}
        <span className="block text-xs text-zinc-500">
          {account.trips === 1 ? "1 wspólny wyjazd" : `${account.trips} wspólne wyjazdy`}
          {account.last_trip ? `, ostatnio „${account.last_trip}”` : ""}
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-2">
        <select value={role} onChange={(event) => setRole(event.target.value as "viewer" | "editor")} disabled={pending} aria-label="Rola" className="field px-1.5 py-0.5 text-sm">
          <option value="viewer">widz</option>
          <option value="editor">edytor</option>
        </select>
        {travelers.length > 0 && (
          <select value={traveler} onChange={(event) => setTraveler(event.target.value)} disabled={pending} aria-label="Uczestnik planu" className="field px-1.5 py-0.5 text-sm">
            <option value="">— bez uczestnika —</option>
            {travelers.map((each) => (
              <option key={each.id} value={each.id}>
                to {each.name}
              </option>
            ))}
          </select>
        )}
        {canMail && account.email && (
          <label className="flex items-center gap-1 text-xs">
            <input type="checkbox" checked={notify} onChange={(event) => setNotify(event.target.checked)} disabled={pending} /> wyślij e-mail
          </label>
        )}
        <button disabled={pending} onClick={() => start(async () => setState(await addKnownMember(tripId, account.user_id, role, traveler || null, notify && canMail)))} className="btn-secondary btn-sm">
          {pending ? "Dodaję…" : "Dodaj"}
        </button>
      </span>
      {state.error && <span className="text-xs msg-error">{state.error}</span>}
      {state.ok && <span className="text-xs msg-ok">{state.ok}</span>}
    </li>
  );
}
