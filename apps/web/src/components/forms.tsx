"use client";

import { useActionState, useState, useTransition } from "react";

import { acceptInvite, addTraveler, createInvite, createTrip, type FormState, importSamples, importTripFile, removeTraveler, removeTrip, updateTraveler } from "@/app/actions";

/** Formularze MVP-1 — stan i błędy z akcji serwera przez `useActionState`. */

const input = "w-full field px-3 py-2 text-sm";
const button = "btn-primary";
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
      <label className="flex items-center gap-2 text-sm">
        <input name="postponed" type="checkbox" />
        Odłożony — termin jeszcze niepewny, daty są orientacyjne
      </label>
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

/** Import planu z pliku JSON (np. szkic AI pobrany z lokalnej bazy) jako nowy wyjazd. */
export function ImportTripForm() {
  const [state, action, pending] = useActionState(importTripFile, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <label className={label}>
        Plik JSON z „Pobierz JSON”
        <input name="file" type="file" accept="application/json,.json" required className={input} />
      </label>
      <Status state={state} />
      <button disabled={pending} className={`${button} self-start`}>
        {pending ? "Importuję…" : "Importuj wyjazd"}
      </button>
    </form>
  );
}

export type Traveler = {
  id: string;
  name: string;
  nickname: string | null;
  age: number | null;
  household: string | null;
  guardian_id: string | null;
  is_driver: boolean | null;
};

/** Nowy uczestnik albo edycja istniejącego (`traveler`) — te same pola, inna akcja. */
export function TravelerForm({ tripId, guardians, traveler, onDone }: { tripId: string; guardians: { id: string; name: string }[]; traveler?: Traveler; onDone?: () => void }) {
  const [state, action, pending] = useActionState(async (prev: FormState, form: FormData) => {
    const result = traveler ? await updateTraveler(tripId, traveler.id, prev, form) : await addTraveler(tripId, prev, form);
    if (result.ok && onDone) onDone();
    return result;
  }, {});
  return (
    <form action={action} className="grid grid-cols-2 gap-3 sm:grid-cols-6 sm:items-end">
      <label className={`${label} col-span-2`}>
        Imię
        <input name="name" required className={input} defaultValue={traveler?.name ?? ""} />
      </label>
      <label className={label}>
        Ksywka
        <input name="nickname" className={input} defaultValue={traveler?.nickname ?? ""} />
      </label>
      <label className={label}>
        Wiek
        <input name="age" type="number" min={0} max={120} className={input} defaultValue={traveler?.age ?? ""} />
      </label>
      <label className={label}>
        Rodzina
        <input name="household" className={input} placeholder="np. Kowalscy" defaultValue={traveler?.household ?? ""} />
      </label>
      <label className={label}>
        Opiekun
        <select name="guardianId" className={input} defaultValue={traveler?.guardian_id ?? ""}>
          <option value="">—</option>
          {guardians
            .filter((guardian) => guardian.id !== traveler?.id)
            .map((guardian) => (
              <option key={guardian.id} value={guardian.id}>
                {guardian.name}
              </option>
            ))}
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input name="isDriver" type="checkbox" defaultChecked={traveler?.is_driver ?? false} /> kierowca
      </label>
      <div className="col-span-2 flex gap-2 sm:col-span-5">
        <button disabled={pending} className={button}>
          {pending ? "Zapisuję…" : traveler ? "Zapisz" : "Dodaj"}
        </button>
        {traveler && onDone && (
          <button type="button" onClick={onDone} className="btn-secondary">
            Anuluj
          </button>
        )}
      </div>
      <div className="col-span-2 sm:col-span-6">
        <Status state={state} />
      </div>
    </form>
  );
}

/** Lista uczestników; organizator i edytor zmieniają dane albo usuwają (gdy nic na nich nie wskazuje). */
export function TravelerList({ tripId, people, canEdit }: { tripId: string; people: Traveler[]; canEdit: boolean }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [result, setResult] = useState<FormState>({});
  const [pending, start] = useTransition();
  const nameOf = new Map(people.map((person) => [person.id, person.name]));
  const guardians = people.filter((person) => person.age === null || person.age >= 18);
  const remove = (person: Traveler) => {
    if (!window.confirm(`Usunąć uczestnika „${person.name}”?`)) return;
    start(async () => setResult(await removeTraveler(tripId, person.id)));
  };
  return (
    <div className="flex flex-col gap-3">
      {people.length === 0 ? (
        <p className="text-sm text-zinc-500">Brak uczestników.</p>
      ) : (
        <ul className="flex flex-col gap-2 text-sm">
          {people.map((person) =>
            editing === person.id ? (
              <li key={person.id} className="card p-3">
                <TravelerForm tripId={tripId} guardians={guardians} traveler={person} onDone={() => setEditing(null)} />
              </li>
            ) : (
              <li key={person.id} className="flex flex-wrap items-baseline gap-x-2">
                <span>
                  <span className="font-medium">{person.name}</span>
                  {person.nickname ? ` „${person.nickname}”` : ""}
                  <span className="text-zinc-500">
                    {person.age !== null ? ` · ${person.age} l.` : ""}
                    {person.household ? ` · ${person.household}` : ""}
                    {person.guardian_id ? ` · pod opieką: ${nameOf.get(person.guardian_id) ?? "?"}` : ""}
                    {person.is_driver ? " · kierowca" : ""}
                  </span>
                </span>
                {canEdit && (
                  <span className="text-xs text-zinc-500">
                    <button onClick={() => { setResult({}); setEditing(person.id); }} className="underline">
                      edytuj
                    </button>{" "}
                    <button onClick={() => remove(person)} disabled={pending} className="underline disabled:opacity-50">
                      usuń
                    </button>
                  </span>
                )}
              </li>
            ),
          )}
        </ul>
      )}
      <Status state={result} />
      {canEdit && <TravelerForm tripId={tripId} guardians={guardians} />}
    </div>
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

/** Właściciel: „Usuń wyjazd” (u wszystkich), pozostali: „Opuść wyjazd” (tylko u siebie). Potwierdzenie z nazwą. */
export function RemoveTripForm({ tripId, title, owner }: { tripId: string; title: string; owner: boolean }) {
  const [state, action, pending] = useActionState(removeTrip.bind(null, tripId), {});
  const question = owner
    ? `Usunąć wyjazd „${title}”? Zniknie u wszystkich uczestników — na webie i na telefonach.`
    : `Opuścić wyjazd „${title}”? Zniknie z Twojej listy; wrócić można tylko z nowego zaproszenia.`;
  return (
    <form action={action} onSubmit={(event) => !window.confirm(question) && event.preventDefault()} className="flex flex-col gap-2">
      <button disabled={pending} className="self-start rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 disabled:opacity-50 dark:border-red-800 dark:text-red-400">
        {pending ? (owner ? "Usuwam…" : "Wychodzę…") : owner ? "Usuń wyjazd" : "Opuść wyjazd"}
      </button>
      <Status state={state} />
    </form>
  );
}

export function SamplesButton() {
  const [state, action, pending] = useActionState(importSamples, {});
  return (
    <form action={action} className="flex flex-col gap-2">
      <button
        disabled={pending}
        className="btn-secondary self-start">
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
