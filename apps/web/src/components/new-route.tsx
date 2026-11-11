"use client";

import { trackFromGpx, type TrackLine } from "@expeditionplan/core";
import { useState, useTransition } from "react";

import type { FormState } from "@/app/actions";
import { addRoute } from "@/app/route-actions";

type Numbers = { km: string; time: string; ascent: string };

/** „1:30” albo „90” → minuty; puste = brak. */
function minutes(text: string): number | undefined {
  const value = text.trim();
  if (value === "") return undefined;
  const match = /^(\d+):(\d{1,2})$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : Math.round(Number(value.replace(",", ".")));
}

const number = (text: string) => (text.trim() === "" ? undefined : Number(text.replace(",", ".")));

/**
 * „+ Dodaj trasę” w „Trasach”: trasa bez punktu planu, do podpięcia później. Nazwa, pieszo albo autem, skąd i dokąd
 * (miejsca wyjazdu ze współrzędnymi), link z mapy, plik GPX (czyta go przeglądarka i podpowiada km, czas i podejście)
 * oraz liczby wpisane ręcznie.
 */
export function NewRoute({ tripId, places }: { tripId: string; places: { ref: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<FormState>({});
  const [kind, setKind] = useState<"foot" | "car">("foot");
  const [name, setName] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [url, setUrl] = useState("");
  const [numbers, setNumbers] = useState<Numbers>({ km: "", time: "", ascent: "" });
  const [gpx, setGpx] = useState<{ line: TrackLine; descentM: number | null; file: string } | null>(null);
  const set = (patch: Partial<Numbers>) => setNumbers((current) => ({ ...current, ...patch }));

  const read = async (file: File | undefined) => {
    setMessage({});
    if (file === undefined) return;
    if (file.size > 30 * 1024 * 1024) return setMessage({ error: "Plik ma ponad 30 MB." });
    try {
      const parsed = trackFromGpx(await file.text());
      setGpx({ line: parsed.line, descentM: parsed.stats.descentM, file: file.name });
      if (name.trim() === "" && parsed.name) setName(parsed.name);
      set({ km: String(parsed.stats.distanceKm), time: String(parsed.stats.durationMin), ascent: parsed.stats.ascentM === null ? "" : String(parsed.stats.ascentM) });
    } catch (e) {
      setMessage({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  const reset = () => {
    setName("");
    setFrom("");
    setTo("");
    setUrl("");
    setNumbers({ km: "", time: "", ascent: "" });
    setGpx(null);
  };

  const save = () =>
    start(async () => {
      setMessage({});
      const km = number(numbers.km);
      const time = minutes(numbers.time);
      const ascent = number(numbers.ascent);
      if ([km, time, ascent].some((each) => each !== undefined && !(each >= 0))) {
        setMessage({ error: "Długość, czas i podejście to liczby, czas jako 1:30 albo w minutach." });
        return;
      }
      const result = await addRoute(tripId, {
        kind,
        name,
        ...(url.trim() !== "" ? { url: url.trim() } : {}),
        ...(km !== undefined ? { distanceKm: km } : {}),
        ...(time !== undefined ? { durationMin: time } : {}),
        ...(ascent !== undefined && kind === "foot" ? { ascentM: Math.round(ascent) } : {}),
        ...(gpx !== null ? { geojson: gpx.line, ...(gpx.descentM !== null && kind === "foot" ? { descentM: gpx.descentM } : {}) } : {}),
        ...(from !== "" ? { fromRef: from } : {}),
        ...(to !== "" ? { toRef: to } : {}),
      });
      setMessage(result);
      if (result.ok) {
        reset();
        setOpen(false);
      }
    });

  if (!open) {
    return (
      <div className="flex flex-col gap-2">
        <button type="button" onClick={() => setOpen(true)} className="btn-secondary btn-sm self-start">
          + Dodaj trasę
        </button>
        {message.ok && <p className="text-sm msg-ok">{message.ok}</p>}
      </div>
    );
  }
  const field = "field px-2 py-1 text-sm";
  const label = "flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400";
  const placeOptions = places.map((place) => (
    <option key={place.ref} value={place.ref}>
      {place.name}
    </option>
  ));
  return (
    <form
      className="card flex flex-col gap-3 p-4 text-sm"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}>
      <h2 className="card-title">Nowa trasa</h2>
      <div className="flex flex-wrap items-center gap-2">
        {(["foot", "car"] as const).map((each) => (
          <button key={each} type="button" onClick={() => setKind(each)} aria-pressed={kind === each} className="toggle-chip">
            {each === "foot" ? "🥾 pieszo" : "🚗 autem"}
          </button>
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className={`${label} sm:col-span-2`}>
          Nazwa
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required placeholder={kind === "foot" ? "np. Na Śnieżnik przez Halę pod Śnieżnikiem" : "np. Wrocław → Nysa przez Brzeg"} className={field} />
        </label>
        <label className={label}>
          Skąd
          <select value={from} onChange={(event) => setFrom(event.target.value)} className={field}>
            <option value="">—</option>
            {placeOptions}
          </select>
        </label>
        <label className={label}>
          Dokąd
          <select value={to} onChange={(event) => setTo(event.target.value)} className={field}>
            <option value="">—</option>
            {placeOptions}
          </select>
        </label>
        <label className={`${label} sm:col-span-2`}>
          Link do trasy (mapy.com, Mapy Google, Komoot…)
          <input value={url} onChange={(event) => setUrl(event.target.value)} type="url" maxLength={500} placeholder="https://" className={field} />
        </label>
        <div className={`${label} sm:col-span-2`}>
          Plik GPX (opcjonalnie: linia na mapie i podpowiedź liczb)
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
          {gpx !== null && (
            <span className="flex flex-wrap items-center gap-2">
              {gpx.file}: {gpx.line.coordinates.length} punktów
              <button type="button" onClick={() => setGpx(null)} className="btn-mini btn-mini-danger">
                usuń plik
              </button>
            </span>
          )}
        </div>
        <label className={label}>
          Długość (km)
          <input value={numbers.km} onChange={(event) => set({ km: event.target.value })} inputMode="decimal" className={field} />
        </label>
        <label className={label}>
          Czas (1:30 albo w minutach)
          <input value={numbers.time} onChange={(event) => set({ time: event.target.value })} className={field} />
        </label>
        {kind === "foot" && (
          <label className={label}>
            Podejście (m)
            <input value={numbers.ascent} onChange={(event) => set({ ascent: event.target.value })} inputMode="numeric" className={field} />
          </label>
        )}
      </div>
      <p className="text-xs text-zinc-500">Wystarczy plik GPX, link albo skąd i dokąd. Trasa z tymi samymi końcami co inna trafi do jej wariantów; do punktu podepniesz ją tutaj albo na karcie punktu.</p>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className="btn-primary btn-sm">
          {pending ? "Zapisuję…" : "Zapisz"}
        </button>
        <button
          type="button"
          onClick={() => {
            reset();
            setOpen(false);
          }}
          disabled={pending}
          className="btn-secondary btn-sm">
          Anuluj
        </button>
      </div>
      {message.error && <p className="text-sm msg-error">{message.error}</p>}
    </form>
  );
}
