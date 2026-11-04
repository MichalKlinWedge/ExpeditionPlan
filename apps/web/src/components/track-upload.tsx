"use client";

import { trackFromGpx } from "@expeditionplan/core";
import { useState, useTransition } from "react";

import type { FormState } from "@/app/actions";
import { removeTrackLine, saveTrack } from "@/app/track-actions";

/**
 * Wgranie śladu GPX do punktu: plik czyta przeglądarka (odczyt, statystyki, uproszczenie), a linia
 * i liczby od razu idą do planu. Ślad trafia na mapę dnia i do telefonu (offline), czas przelicza dzień.
 */
export function TrackUpload({ tripId, itemRef, hasLine }: { tripId: string; itemRef: string; hasLine: boolean }) {
  const [state, setState] = useState<FormState>({});
  const [pending, start] = useTransition();

  const read = async (file: File | undefined) => {
    setState({});
    if (file === undefined) return;
    if (file.size > 30 * 1024 * 1024) return setState({ error: "Plik ma ponad 30 MB." });
    start(async () => {
      try {
        const { name, line, stats } = trackFromGpx(await file.text());
        setState(await saveTrack(tripId, itemRef, { name, geojson: line, stats }));
      } catch (e) {
        setState({ error: e instanceof Error ? e.message : String(e) });
      }
    });
  };

  return (
    <div className="flex flex-col gap-2 text-sm">
      <label className="flex flex-col gap-1 text-xs text-zinc-500">
        {hasLine ? "Zamień ślad (plik .gpx)" : "Dodaj ślad (plik .gpx z mapy.cz, Komoot, Garmina, Strava…)"} — zapisze się od razu z długością, czasem i podejściem
        <input
          type="file"
          accept=".gpx,application/gpx+xml"
          disabled={pending}
          onChange={(event) => {
            void read(event.target.files?.[0]);
            // Ten sam plik można wybrać ponownie, np. po ręcznej zmianie liczb.
            event.target.value = "";
          }}
          className="text-sm"
        />
      </label>
      {pending && <p className="text-xs text-zinc-500">Zapisuję ślad…</p>}
      {hasLine && (
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
