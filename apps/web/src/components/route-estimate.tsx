"use client";

import { formatMinutes } from "@expeditionplan/core";
import { useState, useTransition } from "react";

import type { FormState } from "@/app/actions";
import { saveItemRoute } from "@/app/track-actions";

/**
 * Trasa z mapy na karcie punktu: link (mapy.com → Udostępnij) i liczby, które mapa pokazuje. Czas od razu
 * przelicza plan dnia. Zapisuje tylko to, co zmieniono — sam link nie rusza czasu ani linii przejazdu.
 * Wgrany GPX wypełnia pola sam (nowe `current` po zapisie); „Wstaw z pliku” wraca do jego liczb po ręcznej zmianie.
 */

type Values = { distanceKm?: number; durationMin?: number; ascentM?: number };

const text = (value: number | undefined) => (value === undefined ? "" : String(value).replace(".", ","));
const number = (value: string) => Number(value.trim().replace(",", "."));

export function RouteEstimate({ tripId, itemRef, url, current, fromFile }: { tripId: string; itemRef: string; url: string | undefined; current: Values; fromFile?: Values | undefined }) {
  const [link, setLink] = useState(url ?? "");
  const [km, setKm] = useState(text(current.distanceKm));
  const [hours, setHours] = useState(current.durationMin === undefined ? "" : String(Math.floor(current.durationMin / 60)));
  const [minutes, setMinutes] = useState(current.durationMin === undefined ? "" : String(current.durationMin % 60));
  const [ascent, setAscent] = useState(text(current.ascentM));
  const [state, setState] = useState<FormState>({});
  const [pending, start] = useTransition();

  // Liczby zmienione poza formularzem (wgrany GPX) trafiają do pól.
  const saved = `${current.distanceKm}|${current.durationMin}|${current.ascentM}`;
  const [seen, setSeen] = useState(saved);
  if (saved !== seen) {
    setSeen(saved);
    setKm(text(current.distanceKm));
    setHours(current.durationMin === undefined ? "" : String(Math.floor(current.durationMin / 60)));
    setMinutes(current.durationMin === undefined ? "" : String(current.durationMin % 60));
    setAscent(text(current.ascentM));
  }

  const fill = (values: Values) => {
    if (values.distanceKm !== undefined) setKm(text(values.distanceKm));
    if (values.ascentM !== undefined) setAscent(text(values.ascentM));
    if (values.durationMin !== undefined) {
      setHours(String(Math.floor(values.durationMin / 60)));
      setMinutes(String(values.durationMin % 60));
    }
  };

  const save = () => {
    const distanceKm = number(km);
    const duration = number(hours || "0") * 60 + number(minutes || "0");
    const climb = number(ascent);
    const address = link.trim();
    if (km.trim() !== "" && !(distanceKm >= 0)) return setState({ error: "Długość to liczba kilometrów, np. 12,4." });
    if (!Number.isInteger(duration) || duration < 0) return setState({ error: "Czas to pełne godziny i minuty." });
    if (ascent.trim() !== "" && !(Number.isInteger(climb) && climb >= 0)) return setState({ error: "Podejście to pełne metry." });
    if (address !== "" && !/^https?:\/\//i.test(address)) return setState({ error: "Link musi zaczynać się od https://." });
    const hasTime = hours.trim() !== "" || minutes.trim() !== "";
    const fields = {
      ...(address !== (url ?? "") ? { url: address === "" ? null : address } : {}),
      ...(km.trim() !== "" && distanceKm !== current.distanceKm ? { distanceKm } : {}),
      ...(hasTime && duration !== current.durationMin ? { durationMin: duration } : {}),
      ...(ascent.trim() !== "" && climb !== current.ascentM ? { ascentM: climb } : {}),
    };
    if (Object.keys(fields).length === 0) return setState({ ok: "Bez zmian." });
    start(async () => setState(await saveItemRoute(tripId, itemRef, fields)));
  };

  const showFile = fromFile !== undefined && (fromFile.distanceKm !== current.distanceKm || fromFile.durationMin !== current.durationMin || fromFile.ascentM !== current.ascentM);
  const field = "field px-2 py-1 text-sm";
  return (
    <div className="flex flex-col gap-2 border-t border-zinc-200 pt-2 dark:border-zinc-800">
      <label className="flex flex-col gap-1 text-xs text-zinc-500">
        Link do trasy (mapy.com → Udostępnij)
        <input value={link} onChange={(event) => setLink(event.target.value)} inputMode="url" placeholder="https://mapy.com/s/…" disabled={pending} className={field} />
        <span>Link tylko otwiera trasę: długość i czas nie przeliczają się z niego.</span>
      </label>
      <div className="flex flex-wrap items-end gap-3 text-xs text-zinc-500">
        <label className="flex flex-col gap-1">
          Długość (km)
          <input value={km} onChange={(event) => setKm(event.target.value)} inputMode="decimal" disabled={pending} className={`${field} w-20`} />
        </label>
        <label className="flex flex-col gap-1">
          Czas: godz.
          <input value={hours} onChange={(event) => setHours(event.target.value)} inputMode="numeric" disabled={pending} className={`${field} w-16`} />
        </label>
        <label className="flex flex-col gap-1">
          min
          <input value={minutes} onChange={(event) => setMinutes(event.target.value)} inputMode="numeric" disabled={pending} className={`${field} w-16`} />
        </label>
        <label className="flex flex-col gap-1">
          Podejście (m)
          <input value={ascent} onChange={(event) => setAscent(event.target.value)} inputMode="numeric" disabled={pending} className={`${field} w-20`} />
        </label>
        <button type="button" onClick={save} disabled={pending} className="btn-primary btn-sm">
          {pending ? "Zapisuję…" : "Zapisz trasę"}
        </button>
      </div>
      {showFile && (
        <button type="button" onClick={() => fill(fromFile)} className="btn-mini self-start">
          Wstaw z pliku GPX: {text(fromFile.distanceKm)} km{fromFile.ascentM !== undefined ? ` · ↑ ${fromFile.ascentM} m` : ""}
          {fromFile.durationMin !== undefined ? ` · ok. ${formatMinutes(fromFile.durationMin)}` : ""}
        </button>
      )}
      <p className="text-xs text-zinc-500">Wpisz liczby z mapy albo wgraj niżej plik GPX, który sam je wypełni i narysuje przebieg na mapie planu (czas z pliku liczy norma DIN). Czas przeliczy godziny tego dnia, a „Przelicz przejazdy” nie nadpisze go szacunkiem.</p>
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
      {state.ok && <p className="text-xs text-emerald-700 dark:text-emerald-400">{state.ok}</p>}
    </div>
  );
}
