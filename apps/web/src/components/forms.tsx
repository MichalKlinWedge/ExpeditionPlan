"use client";

import { ID_DOCUMENT, type IdDocument, idDocumentProblem, transportPlan } from "@expeditionplan/core";
import { useActionState, useId, useState, useTransition } from "react";

import { acceptInvite, addTraveler, createInvite, createTrip, type FormState, importSamples, importTripFile, removeTraveler, removeTrip, updateTraveler } from "@/app/actions";
import { PlacePin } from "@/components/place-pin";
import { IconAction } from "@/components/icon-action";
import { travelerPresence } from "@/lib/labels";

/** Formularze MVP-1 — stan i błędy z akcji serwera przez `useActionState`. */

const input = "w-full field px-3 py-2 text-sm";
const button = "btn-primary";
const label = "flex flex-col gap-1 text-sm";

function Status({ state }: { state: FormState }) {
  if (state.error) return <p className="text-sm msg-error">{state.error}</p>;
  if (state.ok) return <p className="text-sm msg-ok">{state.ok}</p>;
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
  passport_until: string | null;
  id_card_until: string | null;
};

type TripRange = { start: string; end: string };
type TripPlace = { id: string; ref: string; name: string };

/** Nowy uczestnik albo edycja istniejącego (`traveler`) — te same pola, inna akcja. */
export function TravelerForm({ tripId, trip, guardians, places, traveler, onDone, onCancel = onDone }: { tripId: string; trip: TripRange; guardians: { id: string; name: string }[]; places: TripPlace[]; traveler?: Traveler; onDone?: () => void; onCancel?: () => void }) {
  const placeList = useId();
  const placeName = (id: string | null | undefined) => places.find((place) => place.id === id)?.name ?? "";
  // Tylko dla pinezek przy „Start” i „Koniec” — pola zostają niekontrolowane.
  const [startName, setStartName] = useState(placeName(traveler?.start_place_id));
  const [endName, setEndName] = useState(placeName(traveler?.end_place_id));
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
      <label className={label} title="Tylko data, bez numeru. U osoby z kontem uzupełni się też w jej innych wyjazdach, gdzie pole jest puste.">
        Paszport ważny do
        <input name="passportUntil" type="date" className={input} defaultValue={traveler?.passport_until ?? ""} />
      </label>
      <label className={label} title="Tylko data, bez numeru. U osoby z kontem uzupełni się też w jej innych wyjazdach, gdzie pole jest puste.">
        Dowód ważny do
        <input name="idCardUntil" type="date" className={input} defaultValue={traveler?.id_card_until ?? ""} />
      </label>
      <label className={`${label} col-span-2 sm:col-span-3`}>
        Uwagi
        <input name="notes" maxLength={2000} className={input} placeholder="np. dojedzie po pracy" defaultValue={traveler?.notes ?? ""} />
      </label>
      <label className={`${label} col-span-2 sm:col-span-3`}>
        Start
        <span className="flex items-stretch gap-1">
          <input name="startPlace" list={placeList} maxLength={200} className={`${input} min-w-0`} placeholder="np. Wrocław" defaultValue={placeName(traveler?.start_place_id)} onChange={(event) => setStartName(event.target.value)} />
          <PlacePin tripId={tripId} places={places} name={startName} />
        </span>
      </label>
      <label className={`${label} col-span-2 sm:col-span-3`}>
        Koniec
        <span className="flex items-stretch gap-1">
          <input name="endPlace" list={placeList} maxLength={200} className={`${input} min-w-0`} placeholder="np. Jakuszyce" defaultValue={placeName(traveler?.end_place_id)} onChange={(event) => setEndName(event.target.value)} />
          <PlacePin tripId={tripId} places={places} name={endName} />
        </span>
      </label>
      <datalist id={placeList}>
        {places.map((place) => (
          <option key={place.id} value={place.name} />
        ))}
      </datalist>
      <p className="col-span-2 text-xs text-zinc-500 sm:col-span-6">Paszport i dowód: tylko data ważności, bez numeru — do ostrzeżeń w „Gotowości do wyjazdu”. Puste daty obecności oznaczają cały wyjazd. Start i koniec wybierz z listy miejsc albo wpisz nowe: pojawi się na stronie „Miejsca”.</p>
      <div className="col-span-2 flex gap-2 sm:col-span-5">
        <button disabled={pending} className="btn-primary btn-sm">
          {pending ? "Zapisuję…" : traveler ? "Zapisz" : "Dodaj"}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="btn-secondary btn-sm">
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

export function TravelerList({ tripId, trip, people, places, canEdit, today }: { tripId: string; trip: TripRange; people: Traveler[]; places: TripPlace[]; canEdit: boolean; today: string }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [result, setResult] = useState<FormState>({});
  const [pending, start] = useTransition();
  const nameOf = new Map(people.map((person) => [person.id, person.name]));
  const guardians = people.filter((person) => person.age === null || person.age >= 18);
  const remove = (person: Traveler) => {
    if (!window.confirm(`Usunąć uczestnika „${person.name}”?`)) return;
    start(async () => setResult(await removeTraveler(tripId, person.id)));
  };
  const placeName = (id: string | null) => (id === null ? null : (places.find((place) => place.id === id)?.name ?? "?"));
  // Kolumna tylko wtedy, gdy ktoś ma w niej dane — tabela nie rośnie o puste kolumny.
  const show = {
    age: people.some((person) => person.age !== null),
    family: people.some((person) => person.household),
    when: people.some((person) => travelerPresence(person.from_date, person.to_date) !== null),
    route: people.some((person) => person.start_place_id || person.end_place_id),
    documents: people.some((person) => person.passport_until !== null || person.id_card_until !== null),
  };
  const columns = 1 + Object.values(show).filter(Boolean).length + (canEdit ? 1 : 0);
  return (
    <div className="flex flex-col gap-3">
      {people.length === 0 ? (
        <p className="text-sm text-zinc-500">Brak uczestników.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-zinc-500">
              <tr>
                <th className="py-1 pr-3 font-normal">Uczestnik</th>
                {show.age && <th className="py-1 pr-3 font-normal">Wiek</th>}
                {show.family && <th className="py-1 pr-3 font-normal">Rodzina</th>}
                {show.when && <th className="py-1 pr-3 font-normal">Kiedy</th>}
                {show.route && <th className="py-1 pr-3 font-normal">Start / koniec</th>}
                {show.documents && <th className="py-1 pr-3 font-normal">Dokumenty</th>}
                {canEdit && <th className="w-px py-1 font-normal" aria-label="Działania" />}
              </tr>
            </thead>
            <tbody>
              {people.map((person) =>
                editing === person.id ? (
                  <tr key={person.id} className="border-t border-zinc-200 dark:border-zinc-800">
                    <td colSpan={columns} className="py-2">
                      <div className="card p-3">
                        <TravelerForm tripId={tripId} trip={trip} guardians={guardians} places={places} traveler={person} onDone={() => setEditing(null)} />
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={person.id} className="border-t border-zinc-200 align-top dark:border-zinc-800">
                    <td className="py-1.5 pr-3">
                      <span className="flex flex-wrap items-baseline gap-x-2">
                        <span>
                          <span className="font-medium">{person.name}</span>
                          {person.nickname ? ` „${person.nickname}”` : ""}
                        </span>
                        {person.tentative && <span className="rounded bg-amber-100 px-1.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">waha się</span>}
                      </span>
                      {person.guardian_id && <span className="block text-xs text-zinc-500">pod opieką: {nameOf.get(person.guardian_id) ?? "?"}</span>}
                      {person.is_driver && <span className="block text-xs text-zinc-500">kierowca</span>}
                      {person.notes && <span className="block whitespace-pre-line text-xs text-zinc-600 dark:text-zinc-400">{person.notes}</span>}
                    </td>
                    {show.age && <td className="py-1.5 pr-3 whitespace-nowrap">{person.age !== null ? `${person.age} l.` : <span className="text-zinc-500">—</span>}</td>}
                    {show.family && (
                      <td className="py-1.5 pr-3">{person.household ?? <span className="text-zinc-500">—</span>}</td>
                    )}
                    {show.when && <td className="py-1.5 pr-3">{travelerPresence(person.from_date, person.to_date) ?? <span className="text-zinc-500">cały wyjazd</span>}</td>}
                    {show.route && (
                      <td className="py-1.5 pr-3">
                        {person.start_place_id ? <span className="block">{placeName(person.start_place_id)}</span> : <span className="block text-zinc-500">—</span>}
                        {person.end_place_id && person.end_place_id !== person.start_place_id && <span className="block text-xs text-zinc-500">koniec: {placeName(person.end_place_id)}</span>}
                      </td>
                    )}
                    {show.documents && (
                      <td className="py-1.5 pr-3">
                        <TravelerDocuments person={person} back={person.to_date ?? trip.end} today={today} />
                      </td>
                    )}
                    {canEdit && (
                      <td className="py-1.5 whitespace-nowrap">
                        <IconAction kind="edit" onClick={() => { setResult({}); setEditing(person.id); }} />{" "}
                        <IconAction kind="remove" onClick={() => remove(person)} disabled={pending} />
                      </td>
                    )}
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
      <Status state={result} />
      {canEdit && <NewTraveler tripId={tripId} trip={trip} guardians={guardians} places={places} />}
      <SharedTransport people={people} places={places} />
    </div>
  );
}

/** Nowy uczestnik: formularz dopiero po kliknięciu, we własnej ramce, żeby nie zlewał się z listą. */
function NewTraveler({ tripId, trip, guardians, places }: { tripId: string; trip: TripRange; guardians: { id: string; name: string }[]; places: TripPlace[] }) {
  const [open, setOpen] = useState(false);
  const [added, setAdded] = useState(0);
  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setOpen(true)} className="btn-secondary btn-sm">
          + Dodaj uczestnika
        </button>
        {added > 0 && <span className="msg-ok text-xs">Dodano.</span>}
      </div>
    );
  }
  return (
    <section className="panel flex flex-col gap-3">
      <h3 className="text-sm font-semibold">Nowy uczestnik</h3>
      <TravelerForm
        tripId={tripId}
        trip={trip}
        guardians={guardians}
        places={places}
        onDone={() => {
          setOpen(false);
          setAdded((count) => count + 1);
        }}
        onCancel={() => setOpen(false)}
      />
    </section>
  );
}

/** Ważność paszportu i dowodu przy osobie; dokument, który nie wystarczy, na czerwono (nieważny w trakcie) albo bursztynowo (paszport bez 6 miesięcy zapasu). */
function TravelerDocuments({ person, back, today }: { person: Traveler; back: string; today: string }) {
  const docs = [
    ["passport", person.passport_until],
    ["id_card", person.id_card_until],
  ].filter((pair): pair is [IdDocument, string] => pair[1] !== null);
  if (docs.length === 0) return <span className="text-zinc-500">—</span>;
  return (
    <p className="flex flex-col text-xs text-zinc-600 dark:text-zinc-400">
      {docs.map(([document, until]) => {
        const found = idDocumentProblem(document, until, back, today);
        return (
          <span key={document} className={found === null ? undefined : found.problem === "short_margin" ? "text-amber-700 dark:text-amber-400" : "text-red-700 dark:text-red-400"}>
            {found === null ? `${ID_DOCUMENT[document]} ważny do ${dayMonthYear(until)}` : `⚠ ${found.text}`}
          </span>
        );
      })}
    </p>
  );
}

const dayMonthYear = (date: string) => `${Number(date.slice(8))}.${date.slice(5, 7)}.${date.slice(0, 4)}`;

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
