"use client";

import { useActionState, useState } from "react";

import { type FormState, saveBrief } from "@/app/actions";
import { FlagIcon, ListIcon, RouteIcon, ShieldIcon, TicketIcon } from "@/components/icons";
import { ClimateHint } from "@/components/climate-hint";
import type { ClimateSource } from "@/lib/climate-place";
import { IconAction } from "@/components/icon-action";

/**
 * Kreator briefu (SPECYFIKACJA M2) w pięciu krokach. Stan trzyma cały szkic w jednym obiekcie,
 * a do akcji idzie JSON — walidację robi `TripBrief` na serwerze, tu tylko podpowiadamy.
 * Pola wieloelementowe (miejsca, dieta, „koniecznie”) są tekstem: jedna pozycja w linii.
 */

type Fixed = {
  kind: string;
  title: string;
  status?: string;
  reference?: string;
  startLocal?: string;
  startTz?: string;
  endLocal?: string;
  from?: string;
  to?: string;
  note?: string;
};

export type BriefDraft = {
  goal: string;
  location: { kind: string; countries: string[]; places: string[] };
  profiles: string[];
  transport: string[];
  budget: { level: string; currency: string; capMinor?: number };
  constraints: {
    pace: string;
    dayStart?: string;
    dayEnd?: string;
    maxDrivingMinPerDay?: number;
    noDrivingAfterDark: boolean;
    diet: string[];
    allergies: string[];
    accessibility: string[];
    notes: string[];
  };
  fixed: Fixed[];
  mustSee: string[];
  avoid: string[];
  notes: string[];
};

const PROFILES: Record<string, string> = {
  sightseeing: "zwiedzanie",
  relax: "odpoczynek",
  trekking: "trekking i góry",
  food_culture: "jedzenie i kultura",
  photo: "fotografia",
  sport: "sport",
  family: "z dziećmi",
  road_trip: "road trip",
};

const TRANSPORT: Record<string, string> = {
  flight: "samolot",
  own_car: "własne auto",
  rental_car: "wynajęte auto",
  hired_driver: "kierowca na miejscu",
  public: "komunikacja publiczna",
  taxi: "taksówki",
  bike: "rower",
  walk: "pieszo",
};

const LOCATION: Record<string, string> = {
  city: "miasto",
  region: "region",
  route: "trasa przez kilka miejsc",
  base_camps: "kilka baz noclegowych",
  outdoor: "w terenie (szlak, chatka)",
};

const FIXED_KIND: Record<string, string> = {
  flight: "lot",
  train: "pociąg",
  lodging: "nocleg",
  car_rental: "wynajem auta",
  event: "wydarzenie (mecz, koncert)",
  activity: "aktywność",
  package: "pakiet",
  ticket: "bilet",
  other: "inne",
};

const STEPS = ["Cel i miejsce", "Styl i transport", "Ograniczenia", "Już ustalone", "Podsumowanie"];
const STEP_ICONS = [FlagIcon, RouteIcon, ShieldIcon, TicketIcon, ListIcon];

const input = "w-full field px-3 py-2 text-sm";
const label = "flex flex-col gap-1 text-sm";
const button = "btn-primary";
const secondary = "btn-secondary";

const lines = (text: string) => text.split("\n").map((line) => line.trim()).filter(Boolean);
const number = (text: string) => (text.trim() === "" ? undefined : Number(text));

function Choices({ options, value, onChange }: { options: Record<string, string>; value: string[]; onChange: (next: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {Object.entries(options).map(([key, name]) => {
        const on = value.includes(key);
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(on ? value.filter((each) => each !== key) : [...value, key])}
            className={`rounded-full border px-3 py-1 text-sm ${on ? "border-sea bg-sea text-white" : "border-zinc-300 dark:border-zinc-700"}`}>
            {name}
          </button>
        );
      })}
    </div>
  );
}

function Lines({ title, hint, value, onChange }: { title: string; hint?: string; value: string[]; onChange: (next: string[]) => void }) {
  const [text, setText] = useState(value.join("\n"));
  return (
    <label className={label}>
      {title}
      <textarea
        rows={3}
        className={input}
        placeholder={hint}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          onChange(lines(event.target.value));
        }}
      />
    </label>
  );
}

export function BriefForm({ tripId, tripTz, initial, travelers, term }: { tripId: string; tripTz: string; initial: BriefDraft; travelers: number; term: { startDate: string; endDate: string; today: string; climate: ClimateSource } }) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<BriefDraft>(initial);
  const [state, action, pending] = useActionState(saveBrief.bind(null, tripId), {} as FormState);
  const update = (patch: Partial<BriefDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const constraints = (patch: Partial<BriefDraft["constraints"]>) => update({ constraints: { ...draft.constraints, ...patch } });
  const setFixed = (index: number, patch: Partial<Fixed>) =>
    update({ fixed: draft.fixed.map((each, i) => (i === index ? { ...each, ...patch } : each)) });

  // Puste pola opcjonalne nie idą do walidacji jako "" — Zod oczekuje braku pola.
  const payload = JSON.stringify({
    ...draft,
    fixed: draft.fixed.map((each) => Object.fromEntries(Object.entries(each).filter(([, value]) => value !== "" && value !== undefined))),
  });

  return (
    <form action={action} className="flex flex-col gap-6">
      <input type="hidden" name="brief" value={payload} />
      {/* Kroki jako mini kafelki w jednym rzędzie — przejście do dowolnego kroku jednym dotknięciem. */}
      <nav aria-label="Kroki briefu" className="-mx-1 overflow-x-auto px-1">
        <ol className="flex gap-2">
          {STEPS.map((name, index) => {
            const Icon = STEP_ICONS[index]!;
            const active = index === step;
            return (
              <li key={name} className="min-w-0 flex-1 shrink-0 basis-20">
                <button
                  type="button"
                  onClick={() => setStep(index)}
                  aria-current={active ? "step" : undefined}
                  className={`flex w-full flex-col items-center gap-1 rounded-xl border px-2 py-2 text-center transition ${active ? "border-sea bg-sea text-white" : index < step ? "border-sea/40 bg-sea-light text-sea dark:bg-sea/15 dark:text-teal-300" : "border-zinc-200 text-zinc-500 hover:border-sea hover:text-sea dark:border-zinc-800"}`}>
                  <Icon className="size-5" />
                  <span className="text-[11px] leading-tight font-medium">
                    {index + 1}. {name}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {step === 0 && (
        <div className="flex flex-col gap-4">
          <label className={label}>
            Po co ten wyjazd i co jest w nim najważniejsze
            <textarea rows={3} className={input} value={draft.goal} onChange={(event) => update({ goal: event.target.value })} placeholder="Pustynia i medyna z dziećmi, bez jazdy po zmroku, jeden dzień nad oceanem." />
          </label>
          <label className={label}>
            Rodzaj
            <select className={input} value={draft.location.kind} onChange={(event) => update({ location: { ...draft.location, kind: event.target.value } })}>
              {Object.entries(LOCATION).map(([key, name]) => (
                <option key={key} value={key}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className={label}>
            Kraje (kody, np. MA albo PL, HR)
            <input
              className={input}
              defaultValue={draft.location.countries.join(", ")}
              onChange={(event) => update({ location: { ...draft.location, countries: event.target.value.toUpperCase().split(/[\s,]+/).filter(Boolean) } })}
            />
          </label>
          <Lines title="Miejsca w kolejności (jedno w linii)" hint={"Marrakesz\nAgafay\nEssaouira"} value={draft.location.places} onChange={(places) => update({ location: { ...draft.location, places } })} />
          <ClimateHint source={term.climate} name={draft.location.places[0]} countryCode={draft.location.countries[0]} start={term.startDate} end={term.endDate} today={term.today} />
        </div>
      )}

      {step === 1 && (
        <div className="flex flex-col gap-4">
          <div className={label}>
            Charakter wyjazdu
            <Choices options={PROFILES} value={draft.profiles} onChange={(profiles) => update({ profiles })} />
          </div>
          <div className={label}>
            Transport
            <Choices options={TRANSPORT} value={draft.transport} onChange={(transport) => update({ transport })} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <label className={label}>
              Budżet
              <select className={input} value={draft.budget.level} onChange={(event) => update({ budget: { ...draft.budget, level: event.target.value } })}>
                <option value="low">oszczędny</option>
                <option value="medium">średni</option>
                <option value="premium">wygodny</option>
              </select>
            </label>
            <label className={label}>
              Waluta
              <input className={`${input} uppercase`} maxLength={3} value={draft.budget.currency} onChange={(event) => update({ budget: { ...draft.budget, currency: event.target.value.toUpperCase() } })} />
            </label>
            <label className={label}>
              Pułap całości (opcjonalnie)
              <input
                type="number"
                min={0}
                className={input}
                defaultValue={draft.budget.capMinor === undefined ? "" : draft.budget.capMinor / 100}
                onChange={(event) => update({ budget: { ...draft.budget, capMinor: number(event.target.value) === undefined ? undefined : Math.round(Number(event.target.value) * 100) } })}
              />
            </label>
          </div>
          <Lines title="Koniecznie zobaczyć" value={draft.mustSee} onChange={(mustSee) => update({ mustSee })} />
          <Lines title="Czego unikać" value={draft.avoid} onChange={(avoid) => update({ avoid })} />
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-3">
            <label className={label}>
              Tempo
              <select className={input} value={draft.constraints.pace} onChange={(event) => constraints({ pace: event.target.value })}>
                <option value="calm">spokojne</option>
                <option value="normal">normalne</option>
                <option value="intense">intensywne</option>
              </select>
            </label>
            <label className={label}>
              Dzień od
              <input type="time" className={input} value={draft.constraints.dayStart ?? ""} onChange={(event) => constraints({ dayStart: event.target.value || undefined })} />
            </label>
            <label className={label}>
              Dzień do
              <input type="time" className={input} value={draft.constraints.dayEnd ?? ""} onChange={(event) => constraints({ dayEnd: event.target.value || undefined })} />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className={label}>
              Najdłuższa jazda dziennie (min)
              <input type="number" min={1} className={input} defaultValue={draft.constraints.maxDrivingMinPerDay ?? ""} onChange={(event) => constraints({ maxDrivingMinPerDay: number(event.target.value) })} />
            </label>
            <label className="flex items-center gap-2 self-end text-sm">
              <input type="checkbox" checked={draft.constraints.noDrivingAfterDark} onChange={(event) => constraints({ noDrivingAfterDark: event.target.checked })} />
              bez jazdy po zmroku
            </label>
          </div>
          <Lines title="Dieta" hint="wegetariańska" value={draft.constraints.diet} onChange={(diet) => constraints({ diet })} />
          <Lines title="Alergie" value={draft.constraints.allergies} onChange={(allergies) => constraints({ allergies })} />
          <Lines title="Dostępność" hint="bez długich podejść dla babci" value={draft.constraints.accessibility} onChange={(accessibility) => constraints({ accessibility })} />
          <Lines title="Inne ograniczenia" hint="być w chatce najpóźniej o 14:00–15:00" value={draft.constraints.notes} onChange={(notes) => constraints({ notes })} />
        </div>
      )}

      {step === 3 && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-zinc-500">Kupione loty, noclegi, bilety — AI zaplanuje wokół nich, nie zamiast nich.</p>
          {draft.fixed.map((each, index) => (
            <fieldset key={index} className="grid grid-cols-2 gap-3 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
              <label className={label}>
                Rodzaj
                <select className={input} value={each.kind} onChange={(event) => setFixed(index, { kind: event.target.value })}>
                  {Object.entries(FIXED_KIND).map(([key, name]) => (
                    <option key={key} value={key}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label className={label}>
                Co
                <input className={input} value={each.title} onChange={(event) => setFixed(index, { title: event.target.value })} placeholder="Lot WRO → RAK" />
              </label>
              <label className={label}>
                Od (czas lokalny)
                <input type="datetime-local" className={input} value={each.startLocal ?? ""} onChange={(event) => setFixed(index, { startLocal: event.target.value || undefined, startTz: each.startTz ?? tripTz })} />
              </label>
              <label className={label}>
                Do (czas lokalny)
                <input type="datetime-local" className={input} value={each.endLocal ?? ""} onChange={(event) => setFixed(index, { endLocal: event.target.value || undefined })} />
              </label>
              <label className={label}>
                Strefa godzin
                <input className={input} value={each.startTz ?? tripTz} onChange={(event) => setFixed(index, { startTz: event.target.value })} />
              </label>
              <label className={label}>
                Numer rezerwacji / lotu
                <input className={input} value={each.reference ?? ""} onChange={(event) => setFixed(index, { reference: event.target.value })} />
              </label>
              <label className={`${label} col-span-2`}>
                Uwagi
                <input className={input} value={each.note ?? ""} onChange={(event) => setFixed(index, { note: event.target.value })} />
              </label>
              <IconAction kind="remove" className="justify-self-start" onClick={() => update({ fixed: draft.fixed.filter((_, i) => i !== index) })} />
            </fieldset>
          ))}
          <button type="button" className={`${secondary} self-start`} onClick={() => update({ fixed: [...draft.fixed, { kind: "flight", title: "", startTz: tripTz }] })}>
            Dodaj ustalony element
          </button>
        </div>
      )}

      {step === 4 && (
        <div className="flex flex-col gap-3 text-sm">
          <Lines title="Wszystko inne, co AI powinno wiedzieć" value={draft.notes} onChange={(notes) => update({ notes })} />
          <ul className="flex flex-col gap-1 text-zinc-600 dark:text-zinc-400">
            <li>Cel: {draft.goal || "—"}</li>
            <li>
              Miejsca: {draft.location.places.join(" → ") || "—"} ({draft.location.countries.join(", ") || "brak krajów"})
            </li>
            <li>Charakter: {draft.profiles.map((key) => PROFILES[key]).join(", ") || "—"}</li>
            <li>Transport: {draft.transport.map((key) => TRANSPORT[key]).join(", ") || "—"}</li>
            <li>Uczestnicy: {travelers} (z listy uczestników wyjazdu)</li>
            <li>Już ustalone: {draft.fixed.length}</li>
          </ul>
        </div>
      )}

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state.ok && <p className="text-sm text-green-700 dark:text-green-400">{state.ok}</p>}
      <div className="flex gap-3">
        <button type="button" className={secondary} disabled={step === 0} onClick={() => setStep(step - 1)}>
          Wstecz
        </button>
        {step < STEPS.length - 1 && (
          <button type="button" className={secondary} onClick={() => setStep(step + 1)}>
            Dalej
          </button>
        )}
        <button disabled={pending} className={button}>
          {pending ? "Zapisuję…" : "Zapisz brief"}
        </button>
      </div>
    </form>
  );
}
