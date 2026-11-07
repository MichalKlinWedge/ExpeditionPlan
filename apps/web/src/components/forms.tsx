"use client";

import { transportPlan } from "@expeditionplan/core";
import { useActionState, useId, useState, useTransition } from "react";

import { acceptInvite, addTraveler, createInvite, createTrip, type FormState, importSamples, importTripFile, removeTraveler, removeTrip, updateTraveler } from "@/app/actions";
import { travelerPresence } from "@/lib/labels";

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
          Waluta wyjazdu
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
  tentative: boolean | null;
  from_date: string | null;
  to_date: string | null;
  notes: string | null;
  start_place_id: string | null;
  end_place_id: string | null;
};

type TripRange = { start: string; end: string };
type TripPlace = { id: string; name: string };

/** Nowy uczestnik albo edycja istniejącego (`traveler`) — te same pola, inna akcja. */
export function TravelerForm({ tripId, trip, guardians, places, traveler, onDone }: { tripId: string; trip: TripRange; guardians: { id: string; name: string }[]; places: TripPlace[]; traveler?: Traveler; onDone?: () => void }) {
  const placeList = useId();
  const placeName = (id: string | null | undefined) => places.find((place) => place.id === id)?.name ?? "";
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
      <label className="flex items-center gap-2 text-sm">
        <input name="tentative" type="checkbox" defaultChecked={traveler?.tentative ?? false} /> waha się
      </label>
      <label className={label}>
        Jedzie od
        <input name="fromDate" type="date" min={trip.start} max={trip.end} className={input} defaultValue={traveler?.from_date ?? ""} />
      </label>
      <label className={label}>
        Jedzie do
        <input name="toDate" type="date" min={trip.start} max={trip.end} className={input} defaultValue={traveler?.to_date ?? ""} />
      </label>
      <label className={`${label} col-span-2 sm:col-span-3`}>
        Uwagi
        <input name="notes" maxLength={2000} className={input} placeholder="np. dojedzie po pracy" defaultValue={traveler?.notes ?? ""} />
      </label>
      <label className={`${label} col-span-2 sm:col-span-3`}>
        Start
        <input name="startPlace" list={placeList} maxLength={200} className={input} placeholder="np. Wrocław" defaultValue={placeName(traveler?.start_place_id)} />
      </label>
      <label className={`${label} col-span-2 sm:col-span-3`}>
        Koniec
        <input name="endPlace" list={placeList} maxLength={200} className={input} placeholder="np. Jakuszyce" defaultValue={placeName(traveler?.end_place_id)} />
      </label>
      <datalist id={placeList}>
        {places.map((place) => (
          <option key={place.id} value={place.name} />
        ))}
      </datalist>
      <p className="col-span-2 text-xs text-zinc-500 sm:col-span-6">Puste daty oznaczają cały wyjazd. Start i koniec wybierz z listy miejsc albo wpisz nowe: pojawi się na stronie „Miejsca”.</p>
      <div className="col-span-2 flex gap-2 sm:col-span-5">
        <button disabled={pending} className="btn-primary btn-sm">
          {pending ? "Zapisuję…" : traveler ? "Zapisz" : "Dodaj"}
        </button>
        {traveler && onDone && (
          <button type="button" onClick={onDone} className="btn-secondary btn-sm">
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
/** Kto może jechać razem: grupy po miejscu i dniu, osobno na początek i koniec wyjazdu. */
function SharedTransport({ people, places }: { people: Traveler[]; places: TripPlace[] }) {
  const plan = transportPlan(people.map((person) => ({ ...person, isDriver: person.is_driver, startPlaceId: person.start_place_id, endPlaceId: person.end_place_id, fromDate: person.from_date, toDate: person.to_date })));
  if (plan.starts.length === 0 && plan.ends.length === 0) return null;
  const placeName = (id: string) => places.find((place) => place.id === id)?.name ?? "?";
  const day = (date: string) => `${date.slice(8)}.${date.slice(5, 7)}`;
  const part = (title: string, prefix: string, groups: typeof plan.starts, missing: typeof plan.noStart) => (
    <div className="flex flex-col gap-1">
      <h3 className="font-medium">{title}</h3>
      {groups.length === 0 && <p className="text-zinc-500">Nikt jeszcze nie ma tego wpisanego.</p>}
      <ul className="flex flex-col gap-0.5">
        {groups.map((group) => (
          <li key={`${group.placeId}|${group.date ?? ""}`}>
            <span className="font-medium">{placeName(group.placeId)}</span>
            {group.date ? ` (${prefix} ${day(group.date)})` : ""}: {group.people.map((person) => `${person.name}${person.isDriver ? " (kierowca)" : ""}${person.tentative ? " (waha się)" : ""}`).join(", ")}
          </li>
        ))}
      </ul>
      {groups.length > 0 && missing.length > 0 && <p className="text-xs text-zinc-500">Bez wpisu: {missing.map((person) => person.name).join(", ")}</p>}
    </div>
  );
  return (
    <div className="flex flex-col gap-2 border-t border-zinc-200 pt-3 text-sm dark:border-zinc-800">
      <h3 className="text-base font-semibold">Wspólny transport</h3>
      {part("Na początek", "od", plan.starts, plan.noStart)}
      {part("Na koniec", "do", plan.ends, plan.noEnd)}
    </div>
  );
}

export function TravelerList({ tripId, trip, people, places, canEdit }: { tripId: string; trip: TripRange; people: Traveler[]; places: TripPlace[]; canEdit: boolean }) {
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
                <TravelerForm tripId={tripId} trip={trip} guardians={guardians} places={places} traveler={person} onDone={() => setEditing(null)} />
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
                    {travelerPresence(person.from_date, person.to_date) ? ` · tylko ${travelerPresence(person.from_date, person.to_date)}` : ""}
                  </span>
                </span>
                {person.tentative && <span className="rounded bg-amber-100 px-1.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">waha się</span>}
                {canEdit && (
                  <span className="text-xs text-zinc-500">
                    <button onClick={() => { setResult({}); setEditing(person.id); }} className="btn-mini">
                      edytuj
                    </button>{" "}
                    <button onClick={() => remove(person)} disabled={pending} className="btn-mini btn-mini-danger">
                      usuń
                    </button>
                  </span>
                )}
                {(person.start_place_id || person.end_place_id) && (
                  <p className="w-full text-xs text-zinc-600 dark:text-zinc-400">
                    {[person.start_place_id && `start: ${places.find((place) => place.id === person.start_place_id)?.name ?? "?"}`, person.end_place_id && `koniec: ${places.find((place) => place.id === person.end_place_id)?.name ?? "?"}`].filter(Boolean).join(" · ")}
                  </p>
                )}
                {person.notes && <p className="w-full whitespace-pre-line text-xs text-zinc-600 dark:text-zinc-400">{person.notes}</p>}
              </li>
            ),
          )}
        </ul>
      )}
      <Status state={result} />
      <SharedTransport people={people} places={places} />
      {canEdit && <TravelerForm tripId={tripId} trip={trip} guardians={guardians} places={places} />}
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
      <button disabled={pending} className="btn-mini btn-mini-danger self-start">
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
