"use client";

import { trackFromGpx } from "@expeditionplan/core";
import { useId, useState, useTransition } from "react";

import type { FormState } from "@/app/actions";
import { removeTrackLine, saveTrack } from "@/app/track-actions";
import { IconAction } from "@/components/icon-action";

/**
 * Wgranie śladu GPX do punktu: plik czyta przeglądarka (odczyt, statystyki, uproszczenie), a linia
 * i liczby od razu idą do planu. Ślad trafia na mapę dnia i do telefonu (offline), czas przelicza dzień.
 */
export function TrackUpload({ tripId, itemRef, hasLine }: { tripId: string; itemRef: string; hasLine: boolean }) {
  const [state, setState] = useState<FormState>({});
  const [pending, start] = useTransition();
  const fileId = useId();

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
      <div className="flex flex-col gap-1">
        <label htmlFor={fileId} className="text-xs text-zinc-500">
          {hasLine ? "Zamień ślad (plik .gpx)" : "Dodaj ślad (plik .gpx z mapy.cz, Komoot, Garmina, Strava…)"} — zapisze się od razu z długością, czasem i podejściem, a brakujący start i koniec ustawi się sam
        </label>
        {/* Wybór pliku i usunięcie śladu w jednej linii. */}
        <div className="flex flex-wrap items-center gap-2">
          <input
            id={fileId}
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
          {hasLine && (
            <IconAction kind="remove" tip="Usuń ślad" disabled={pending} onClick={() => window.confirm("Usunąć ślad z tego punktu?") && start(async () => setState(await removeTrackLine(tripId, itemRef)))} />
          )}
        </div>
      </div>
      {pending && <p className="text-xs text-zinc-500">Zapisuję ślad…</p>}
      {state.error && <p className="text-xs msg-error">{state.error}</p>}
      {state.ok && <p className="text-xs msg-ok">{state.ok}</p>}
    </div>
  );
}
