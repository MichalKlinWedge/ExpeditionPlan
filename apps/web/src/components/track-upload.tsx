"use client";

import { trackFromGpx } from "@expeditionplan/core";
import { useState, useTransition } from "react";

import type { FormState } from "@/app/actions";
import { removeTrackLine, saveTrack, type TrackUpload as Upload } from "@/app/track-actions";

/**
 * Wgranie śladu GPX do punktu: plik czyta przeglądarka (odczyt, statystyki, uproszczenie),
 * podgląd liczb, potem zapis do planu. Ślad trafia na mapę dnia i do telefonu (offline).
 */
export function TrackUpload({ tripId, itemRef, hasLine }: { tripId: string; itemRef: string; hasLine: boolean }) {
  const [state, setState] = useState<FormState>({});
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState<Upload | null>(null);

  const read = async (file: File | undefined) => {
    setState({});
    setDraft(null);
    if (file === undefined) return;
    if (file.size > 30 * 1024 * 1024) return setState({ error: "Plik ma ponad 30 MB." });
    try {
      const { name, line, stats } = trackFromGpx(await file.text());
      setDraft({ name, geojson: line, stats });
    } catch (e) {
      setState({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <div className="flex flex-col gap-2 text-sm">
      <label className="flex flex-col gap-1 text-xs text-zinc-500">
        {hasLine ? "Zamień ślad (plik .gpx)" : "Dodaj ślad (plik .gpx z mapy.cz, Komoot, Garmina, Strava…)"}
        <input type="file" accept=".gpx,application/gpx+xml" disabled={pending} onChange={(event) => void read(event.target.files?.[0])} className="text-sm" />
      </label>
      {draft && (
        <div className="flex flex-wrap items-center gap-3">
          <span>
            {draft.name ? <strong>{draft.name}: </strong> : null}
            {draft.stats.distanceKm.toLocaleString("pl-PL")} km
            {draft.stats.ascentM !== null ? ` · ↑ ${draft.stats.ascentM} m ↓ ${draft.stats.descentM} m` : " · bez wysokości"} · ok. {Math.floor(draft.stats.durationMin / 60)} h{" "}
            {draft.stats.durationMin % 60} min
          </span>
          <button
            disabled={pending}
            onClick={() =>
              start(async () => {
                const result = await saveTrack(tripId, itemRef, draft);
                setState(result);
                if (result.ok) setDraft(null);
              })
            }
            className="btn-primary btn-sm">
            {pending ? "Zapisuję…" : "Zapisz ślad"}
          </button>
        </div>
      )}
      {hasLine && !draft && (
        <button
          disabled={pending}
          onClick={() => window.confirm("Usunąć ślad z tego punktu?") && start(async () => setState(await removeTrackLine(tripId, itemRef)))}
          className="self-start text-xs underline disabled:opacity-50">
          usuń ślad
        </button>
      )}
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
      {state.ok && <p className="text-xs text-green-700 dark:text-green-400">{state.ok}</p>}
    </div>
  );
}
