"use client";

import { trackFromGpx, type TrackLine } from "@expeditionplan/core";
import { type ReactNode, useState, useTransition } from "react";

import type { FormState } from "@/app/actions";
import { type RouteEditInput, updateRoute } from "@/app/route-actions";

export type RouteEditorValues = {
  name: string;
  kind: "foot" | "car";
  url: string;
  km: string;
  time: string;
  ascent: string;
  descent: string;
  difficulty: string;
  waymarking: string;
  notes: string;
  fromRef: string;
  toRef: string;
  hasLine: boolean;
};

/** „1:30” albo „90” → minuty; puste = brak. */
function minutes(text: string): number | null {
  const value = text.trim();
  if (value === "") return null;
  const match = /^(\d+):(\d{1,2})$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : Math.round(Number(value.replace(",", ".")));
}

const number = (text: string) => (text.trim() === "" ? null : Number(text.replace(",", ".")));
const textOrNull = (text: string) => (text.trim() === "" ? null : text.trim());

/**
 * Edycja trasy na jej stronie (`updateRoute` → core `editRoute`): nazwa, skąd i dokąd, link, liczby, trudność,
 * oznakowanie, uwagi i linia z pliku GPX (zamiana albo usunięcie). Podpięte punkty mogą od razu wziąć nowe liczby.
 */
export function RouteEditor({ tripId, trackRef, initial, places, users, top }: { tripId: string; trackRef: string; initial: RouteEditorValues; places: { ref: string; name: string }[]; users: number; top?: ReactNode }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<FormState>({});
  const [values, setValues] = useState(initial);
  // `undefined` = linia bez zmian, `null` = usunięta, linia = nowa z pliku.
  const [line, setLine] = useState<TrackLine | null | undefined>(undefined);
  const [file, setFile] = useState("");
  const [updateUsers, setUpdateUsers] = useState(users > 0);
  const set = (patch: Partial<RouteEditorValues>) => setValues((current) => ({ ...current, ...patch }));
  const foot = values.kind === "foot";

  const read = async (picked: File | undefined) => {
    setMessage({});
    if (picked === undefined) return;
    if (picked.size > 30 * 1024 * 1024) return setMessage({ error: "Plik ma ponad 30 MB." });
    try {
      const parsed = trackFromGpx(await picked.text());
      setLine(parsed.line);
      setFile(picked.name);
      set({
        km: String(parsed.stats.distanceKm),
        time: String(parsed.stats.durationMin),
        ...(parsed.stats.ascentM !== null ? { ascent: String(parsed.stats.ascentM) } : {}),
        ...(parsed.stats.descentM !== null ? { descent: String(parsed.stats.descentM) } : {}),
      });
    } catch (e) {
      setMessage({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  const save = () =>
    start(async () => {
      setMessage({});
      const numbers = { km: number(values.km), time: minutes(values.time), ascent: number(values.ascent), descent: number(values.descent) };
      if (Object.values(numbers).some((each) => each !== null && !(each >= 0))) {
        setMessage({ error: "Długość, czas, podejście i zejście to liczby, czas jako 1:30 albo w minutach." });
        return;
      }
      const fields: RouteEditInput = {
        name: values.name,
        url: textOrNull(values.url),
        distanceKm: numbers.km,
        durationMin: numbers.time,
        ...(foot ? { ascentM: numbers.ascent === null ? null : Math.round(numbers.ascent), descentM: numbers.descent === null ? null : Math.round(numbers.descent) } : {}),
        difficulty: textOrNull(values.difficulty),
        waymarking: textOrNull(values.waymarking),
        routeNotes: textOrNull(values.notes),
        ...(line !== undefined ? { geojson: line } : {}),
        ...(values.fromRef !== initial.fromRef ? { fromRef: values.fromRef === "" ? null : values.fromRef } : {}),
        ...(values.toRef !== initial.toRef ? { toRef: values.toRef === "" ? null : values.toRef } : {}),
      };
      const result = await updateRoute(tripId, trackRef, fields, updateUsers);
      setMessage(result);
      if (result.ok) {
        setLine(undefined);
        setFile("");
      }
    });

  const field = "field px-2 py-1 text-sm";
  const label = "flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400";
  const placeOptions = (current: string) => (
    <>
      <option value="">—</option>
      {/* Koniec zapisany bez miejsca wyjazdu (z nazwy pliku) zostaje, póki nie wybierzesz innego. */}
      {current === "keep" && <option value="keep">(jak zapisano)</option>}
      {places.map((place) => (
        <option key={place.ref} value={place.ref}>
          {place.name}
        </option>
      ))}
    </>
  );
  const hasLine = line === undefined ? values.hasLine : line !== null;

  return (
    <form
      className="card flex flex-col gap-3 p-4 text-sm"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}>
      <h2 className="card-title">Edycja trasy</h2>
      {top}
      <div className="grid gap-2 sm:grid-cols-2">
        <label className={`${label} sm:col-span-2`}>
          Nazwa
          <input value={values.name} onChange={(event) => set({ name: event.target.value })} maxLength={120} required className={field} />
        </label>
        <label className={label}>
          Skąd
          <select value={values.fromRef} onChange={(event) => set({ fromRef: event.target.value })} className={field}>
            {placeOptions(initial.fromRef)}
          </select>
        </label>
        <label className={label}>
          Dokąd
          <select value={values.toRef} onChange={(event) => set({ toRef: event.target.value })} className={field}>
            {placeOptions(initial.toRef)}
          </select>
        </label>
        <label className={`${label} sm:col-span-2`}>
          Link do trasy
          <input value={values.url} onChange={(event) => set({ url: event.target.value })} type="url" maxLength={500} placeholder="https://" className={field} />
        </label>
        <label className={label}>
          Długość (km)
          <input value={values.km} onChange={(event) => set({ km: event.target.value })} inputMode="decimal" className={field} />
        </label>
        <label className={label}>
          Czas (1:30 albo w minutach)
          <input value={values.time} onChange={(event) => set({ time: event.target.value })} className={field} />
        </label>
        {foot && (
          <>
            <label className={label}>
              Podejście (m)
              <input value={values.ascent} onChange={(event) => set({ ascent: event.target.value })} inputMode="numeric" className={field} />
            </label>
            <label className={label}>
              Zejście (m)
              <input value={values.descent} onChange={(event) => set({ descent: event.target.value })} inputMode="numeric" className={field} />
            </label>
            <label className={label}>
              Trudność
              <input value={values.difficulty} onChange={(event) => set({ difficulty: event.target.value })} maxLength={120} placeholder="np. średnia, T2" className={field} />
            </label>
            <label className={label}>
              Oznakowanie
              <input value={values.waymarking} onChange={(event) => set({ waymarking: event.target.value })} maxLength={200} placeholder="np. szlak czerwony, potem żółty" className={field} />
            </label>
          </>
        )}
        <label className={`${label} sm:col-span-2`}>
          Uwagi
          <textarea value={values.notes} onChange={(event) => set({ notes: event.target.value })} maxLength={2000} rows={3} className={field} />
        </label>
        <div className={`${label} sm:col-span-2`}>
          {hasLine ? "Zamień linię (plik .gpx)" : "Linia trasy (plik .gpx)"}
          <span className="flex flex-wrap items-center gap-2">
            <input
              type="file"
              accept=".gpx,application/gpx+xml"
              aria-label="Plik GPX"
              onChange={(event) => {
                void read(event.target.files?.[0]);
                event.target.value = "";
              }}
              className="text-sm"
            />
            {file !== "" && <span>{file}: nowa linia, liczby z pliku wpisane wyżej</span>}
            {hasLine && (
              <button type="button" onClick={() => setLine(null)} className="btn-mini btn-mini-danger">
                usuń linię
              </button>
            )}
            {line === null && <span>linia zniknie po zapisie</span>}
          </span>
        </div>
      </div>
      {users > 0 && (
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={updateUsers} onChange={(event) => setUpdateUsers(event.target.checked)} />
          Zaktualizuj podpięte punkty ({users}): przebieg, długość i czas z tej trasy, plan dnia się przeliczy
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className="btn-primary btn-sm">
          {pending ? "Zapisuję…" : "Zapisz"}
        </button>
        <button
          type="button"
          onClick={() => {
            setValues(initial);
            setLine(undefined);
            setFile("");
            setMessage({});
          }}
          disabled={pending}
          className="btn-secondary btn-sm">
          Anuluj
        </button>
      </div>
      {message.error && <p className="text-sm msg-error">{message.error}</p>}
      {message.ok && <p className="text-sm msg-ok">{message.ok}</p>}
    </form>
  );
}
