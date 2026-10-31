"use client";

import { useActionState, useState } from "react";

import { acceptInvite, addTraveler, createInvite, createTrip, type FormState, importSamples } from "@/app/actions";

/** Formularze MVP-1 — stan i błędy z akcji serwera przez `useActionState`. */

const input = "w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700";
const button = "rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900";
const label = "flex flex-col gap-1 text-sm";

function Status({ state }: { state: FormState }) {
  if (state.error) return <p className="text-sm text-red-600">{state.error}</p>;
  if (state.ok) return <p className="text-sm text-green-700 dark:text-green-400">{state.ok}</p>;
  return null;
}

/** Najczęstsze strefy celów; dowolną inną da się wpisać (pole z podpowiedziami). */
const ZONES = ["Europe/Warsaw", "Europe/Madrid", "Europe/Zagreb", "Africa/Casablanca", "Asia/Tbilisi", "Europe/London"];

export function NewTripForm() {
  const [state, action, pending] = useActionState(createTrip, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <label className={label}>
        Nazwa
        <input name="title" required className={input} placeholder="Maroko w cztery noce" />
      </label>
      <div className="grid grid-cols-2 gap-4">
        <label className={label}>
          Od
          <input name="startDate" type="date" required className={input} />
        </label>
        <label className={label}>
          Do
          <input name="endDate" type="date" required className={input} />
        </label>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <label className={label}>
          Strefa czasowa celu
          <input name="primaryTz" list="zones" required defaultValue="Europe/Warsaw" className={input} />
          <datalist id="zones">
            {ZONES.map((zone) => (
              <option key={zone} value={zone} />
            ))}
          </datalist>
        </label>
        <label className={label}>
          Waluta budżetu
          <input name="baseCurrency" required defaultValue="PLN" maxLength={3} className={`${input} uppercase`} />
        </label>
      </div>
      <Status state={state} />
      <button disabled={pending} className={`${button} self-start`}>
        {pending ? "Zapisuję…" : "Utwórz wyjazd"}
      </button>
    </form>
  );
}

export function TravelerForm({ tripId, guardians }: { tripId: string; guardians: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(addTraveler.bind(null, tripId), {});
  return (
    <form action={action} className="grid grid-cols-2 gap-3 sm:grid-cols-5 sm:items-end">
      <label className={`${label} col-span-2`}>
        Imię
        <input name="name" required className={input} />
      </label>
      <label className={label}>
        Wiek
        <input name="age" type="number" min={0} max={120} className={input} />
      </label>
      <label className={label}>
        Rodzina
        <input name="household" className={input} placeholder="np. Kowalscy" />
      </label>
      <label className={label}>
        Opiekun
        <select name="guardianId" className={input} defaultValue="">
          <option value="">—</option>
          {guardians.map((guardian) => (
            <option key={guardian.id} value={guardian.id}>
              {guardian.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input name="isDriver" type="checkbox" /> kierowca
      </label>
      <button disabled={pending} className={button}>
        {pending ? "Dodaję…" : "Dodaj"}
      </button>
      <div className="col-span-2 sm:col-span-5">
        <Status state={state} />
      </div>
    </form>
  );
}

export function InviteForm({ tripId }: { tripId: string }) {
  const [state, action, pending] = useActionState(createInvite.bind(null, tripId), {});
  const [copied, setCopied] = useState(false);
  const link = state.token ? `${window.location.origin}/join/${state.token}` : null;
  return (
    <div className="flex flex-col gap-3">
      <form action={action} className="flex flex-wrap items-end gap-3">
        <label className={label}>
          Rola
          <select name="role" className={input} defaultValue="viewer">
            <option value="viewer">widz — tylko ogląda</option>
            <option value="editor">edytor — zmienia plan</option>
          </select>
        </label>
        <label className={label}>
          Ile osób
          <input name="maxUses" type="number" min={1} max={50} defaultValue={1} className={`${input} w-20`} />
        </label>
        <button disabled={pending} className={button}>
          {pending ? "Tworzę…" : "Utwórz link"}
        </button>
      </form>
      <Status state={state} />
      {link && (
        <div className="flex flex-col gap-2 rounded-md bg-zinc-100 p-3 text-sm dark:bg-zinc-900">
          <p>Link ważny 14 dni. Pokazuję go tylko teraz — w bazie zostaje sam skrót.</p>
          <code className="break-all">{link}</code>
          <button
            type="button"
            className={`${button} self-start`}
            onClick={() => void navigator.clipboard.writeText(link).then(() => setCopied(true))}>
            {copied ? "Skopiowano" : "Kopiuj link"}
          </button>
        </div>
      )}
    </div>
  );
}

export function SamplesButton() {
  const [state, action, pending] = useActionState(importSamples, {});
  return (
    <form action={action} className="flex flex-col gap-2">
      <button
        disabled={pending}
        className="self-start rounded-md border border-zinc-300 px-4 py-2 text-sm disabled:opacity-50 dark:border-zinc-700">
        {pending ? "Dodaję przykłady…" : "Dodaj przykładowe wyjazdy"}
      </button>
      <Status state={state} />
    </form>
  );
}

export function JoinButton({ token }: { token: string }) {
  const [state, action, pending] = useActionState(() => acceptInvite(token), {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <button disabled={pending} className={`${button} self-start`}>
        {pending ? "Dołączam…" : "Dołącz do wyjazdu"}
      </button>
      <Status state={state} />
    </form>
  );
}
