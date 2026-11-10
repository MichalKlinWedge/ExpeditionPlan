"use client";

import { formatMinutes, instantToZoned, itemTrackWalk, MINUTE, minutesToKm, TRACK_POI_KIND, TRACK_POI_TYPE, type TrackPoi, type TripDocument, variantsForItem } from "@expeditionplan/core";
import type { TripState } from "@expeditionplan/sync";
import { useState, useTransition } from "react";

import type { FormState } from "@/app/actions";
import { findTrackPois } from "@/app/track-actions";
import { readChosenVariants } from "@/lib/plan-variants";
import { useHydrated } from "@/lib/use-hydrated";

type Props = { tripId: string; doc: TripDocument; inputs: TripState["inputs"]; itemRef: string; canEdit: boolean };

const POI_ICON: Record<TrackPoi["kind"], string> = { water: "💧", shelter: "🏠", exit: "↘" };
const TREND: Record<"up" | "down" | "flat", string> = { up: "↗ podejście", down: "↘ zejście", flat: "→ płasko" };
const round5 = (minutes: number) => Math.max(5, Math.round(minutes / 5) * 5);
const km = (value: number) => `${(Math.round(value * 10) / 10).toLocaleString("pl-PL")} km`;

/**
 * Profil wysokości i trudność trasy ze śladu GPX (`core/track-profile.ts`): wykres, odcinki z czasem
 * wg DIN 33466 (dopasowanym do czasu punktu w planie), meta względem zachodu słońca i punkt, w którym
 * najpóźniej zawrócić. Godzina wyjścia z silnika planu dla wariantów wybranych w widoku planu — tylko
 * w przeglądarce. Woda, schroniska i zejścia z OpenStreetMap na kliknięcie (`core/track-pois.ts`).
 */
export function TrackProfile({ tripId, doc, inputs, itemRef, canEdit }: Props) {
  const hydrated = useHydrated();
  const [hover, setHover] = useState<number | null>(null);
  const [state, setState] = useState<FormState>({});
  const [pending, start] = useTransition();
  const item = doc.items.find((each) => each.ref === itemRef);
  const track = item?.activity?.trackRef === undefined ? undefined : doc.tracks.find((each) => each.ref === item.activity!.trackRef);
  // Godzina wyjścia dla wariantów wybranych w widoku planu — wybór jest tylko w przeglądarce.
  const options = hydrated && item !== undefined ? { activeVariants: variantsForItem(doc, item, { ...inputs.activeVariants, ...readChosenVariants(tripId, doc) }).variants, delays: inputs.delays, skipRefs: inputs.skipRefs, done: inputs.done, pulled: inputs.pulled } : null;
  const walk = item === undefined ? null : itemTrackWalk(doc, item, options ?? {});
  if (item === undefined || track === undefined || walk === null) return null;

  const { profile, sections, pace } = walk;
  const day = doc.days.find((each) => each.ref === item.dayRef);
  // Przed hydratacją bez godzin: serwer nie zna wariantów wybranych w tej karcie przeglądarki.
  const startAt = options === null ? null : walk.start;
  const tz = walk.tz ?? "UTC";
  const light = options === null ? null : walk.daylight;
  const clock = (minutes: number) => (startAt === null ? null : instantToZoned(startAt + minutes * MINUTE, tz).time);
  const pois = track.pois?.items ?? [];

  // Wykres: oś X — km, oś Y — wysokość; nad osią znaczniki wody, schronień i zejść.
  const W = 640;
  const H = 170;
  const pad = { left: 44, right: 8, top: 22, bottom: 22 };
  const total = Math.max(profile.totalKm, 0.1);
  const lo = profile.minEle ?? 0;
  const hi = Math.max(profile.maxEle ?? 1, lo + 50);
  // Zaokrąglone do 0,1 px: ułamki liczone na serwerze i w przeglądarce różnią się na ostatnich cyfrach.
  const x = (value: number) => Math.round((pad.left + (value / total) * (W - pad.left - pad.right)) * 10) / 10;
  const y = (ele: number) => Math.round((pad.top + (1 - (ele - lo) / (hi - lo)) * (H - pad.top - pad.bottom)) * 10) / 10;
  const withEle = profile.points.filter((point) => point.ele !== null) as { km: number; ele: number }[];
  const path = withEle.map((point, i) => `${i === 0 ? "M" : "L"}${x(point.km).toFixed(1)},${y(point.ele).toFixed(1)}`).join(" ");
  const area = withEle.length > 1 ? `${path} L${x(withEle.at(-1)!.km).toFixed(1)},${H - pad.bottom} L${x(withEle[0]!.km).toFixed(1)},${H - pad.bottom} Z` : "";
  const forwardAt = (value: number) => minutesToKm(sections, value);
  const eleAt = (value: number) => withEle.reduce<{ km: number; ele: number } | null>((best, point) => (best === null || Math.abs(point.km - value) < Math.abs(best.km - value) ? point : best), null)?.ele ?? null;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((part) => part * total);

  const fetchPois = () =>
    start(async () => {
      setState({});
      setState(await findTrackPois(tripId, itemRef));
    });

  return (
    <section className="card flex flex-col gap-3 p-4 text-sm">
      <h2 className="card-title">Profil i trudność trasy</h2>
      {profile.hasElevation ? (
        <figure className="flex flex-col gap-1">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="h-auto w-full touch-none select-none"
            role="img"
            aria-label={`Profil wysokości: ${lo}–${hi} m n.p.m. na ${km(total)}`}
            onPointerMove={(event) => {
              const box = event.currentTarget.getBoundingClientRect();
              const at = (((event.clientX - box.left) / box.width) * W - pad.left) / (W - pad.left - pad.right);
              setHover(at < 0 || at > 1 ? null : at * total);
            }}
            onPointerLeave={() => setHover(null)}>
            {[lo, (lo + hi) / 2, hi].map((ele) => (
              <g key={ele}>
                <line x1={pad.left} x2={W - pad.right} y1={y(ele)} y2={y(ele)} stroke="currentColor" strokeOpacity={0.12} />
                <text x={pad.left - 4} y={y(ele) + 4} textAnchor="end" fontSize={11} fill="currentColor" fillOpacity={0.6}>
                  {Math.round(ele)}
                </text>
              </g>
            ))}
            {ticks.map((value) => (
              <text key={value} x={x(value)} y={H - 6} textAnchor={value === 0 ? "start" : value === total ? "end" : "middle"} fontSize={11} fill="currentColor" fillOpacity={0.6}>
                {km(value)}
              </text>
            ))}
            {sections.slice(1).map((section) => (
              <line key={section.fromKm} x1={x(section.fromKm)} x2={x(section.fromKm)} y1={pad.top} y2={H - pad.bottom} stroke="currentColor" strokeOpacity={0.15} strokeDasharray="2 3" />
            ))}
            <path d={area} fill="var(--color-sea)" fillOpacity={0.18} />
            <path d={path} fill="none" stroke="var(--color-sea)" strokeWidth={2} />
            {light?.turnaround && (
              <g>
                <line x1={x(light.turnaround.km)} x2={x(light.turnaround.km)} y1={pad.top - 4} y2={H - pad.bottom} stroke="var(--color-signal)" strokeWidth={2} strokeDasharray="5 3" />
                <text x={x(light.turnaround.km) + 4} y={pad.top + 8} fontSize={11} fill="var(--color-signal)">
                  zawróć
                </text>
              </g>
            )}
            {pois.map((poi) => (
              <text key={poi.osmId} x={x(poi.km)} y={pad.top - 6} textAnchor="middle" fontSize={12}>
                <title>{`${TRACK_POI_TYPE[poi.type] ?? poi.type}${poi.name ? `: ${poi.name}` : ""} · ${km(poi.km)}`}</title>
                {POI_ICON[poi.kind]}
              </text>
            ))}
            {hover !== null && (
              <g pointerEvents="none">
                <line x1={x(hover)} x2={x(hover)} y1={pad.top} y2={H - pad.bottom} stroke="currentColor" strokeOpacity={0.5} />
                {eleAt(hover) !== null && <circle cx={x(hover)} cy={y(eleAt(hover)!)} r={3.5} fill="var(--color-sea)" />}
              </g>
            )}
          </svg>
          <figcaption className="min-h-5 text-xs text-zinc-500 tabular-nums">
            {hover === null
              ? `Najniżej ${lo} m, najwyżej ${hi} m n.p.m. Najedź na wykres, żeby zobaczyć wysokość i godzinę.`
              : `${km(hover)} · ${eleAt(hover) ?? "?"} m n.p.m. · ${formatMinutes(round5(forwardAt(hover)))} od startu${clock(forwardAt(hover)) ? ` (ok. ${clock(forwardAt(hover))})` : ""}`}
          </figcaption>
        </figure>
      ) : (
        <p className="text-zinc-500">Plik GPX nie ma wysokości: odcinki i czasy liczą się tylko z długości.</p>
      )}

      {light && (
        <div className="flex flex-col gap-1">
          <p className="tabular-nums">
            Wyjście {light.startLocal} · meta ok. {light.finishLocal}
            {light.finishDate ? " (+1)" : ""}
            {light.sunsetLocal ? ` · zachód ${light.sunsetLocal}` : ""}
            {light.duskLocal ? `, zmrok ${light.duskLocal}` : ""}
          </p>
          {light.startsAfterSunset ? (
            <p className="font-semibold text-red-700 dark:text-red-400">⚠ Wyjście po zachodzie słońca — trasa w całości po ciemku.</p>
          ) : light.marginMin !== null && light.marginMin < 0 ? (
            <p className="font-semibold text-red-700 dark:text-red-400">⚠ Meta {formatMinutes(-light.marginMin)} po zachodzie słońca.</p>
          ) : (
            light.marginMin !== null && <p className={light.marginMin < 60 ? "text-amber-700 dark:text-amber-400" : "text-zinc-600 dark:text-zinc-400"}>Zapas do zachodu: {formatMinutes(light.marginMin)}.</p>
          )}
          {light.turnaround && (
            <p className={light.marginMin !== null && light.marginMin < 60 ? "font-semibold" : "text-zinc-600 dark:text-zinc-400"}>
              Punkt bez powrotu: {km(light.turnaround.km)} (wg planu ok. {light.turnaround.atLocal}). Zawrócenie później oznacza powrót do startu po zachodzie — jeśli nie jesteście tam o tej godzinie, zawróćcie albo idźcie do mety lub zejścia.
            </p>
          )}
          {light.pointOfNoReturnKm !== null && light.pointOfNoReturnKm < total - 0.1 && (
            <p className="text-xs text-zinc-500">Od {km(light.pointOfNoReturnKm)} do mety jest bliżej (w czasie) niż z powrotem do startu.</p>
          )}
        </div>
      )}
      {!light && day !== undefined && hydrated && <p className="text-xs text-zinc-500">Punkt nie wchodzi do wyliczeń dnia — bez godzin i słońca.</p>}
      {day === undefined && <p className="text-xs text-zinc-500">Godziny i słońce pokażą się, gdy punkt będzie w dniu planu.</p>}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs tabular-nums">
          <thead className="text-zinc-500">
            <tr>
              <th className="py-1 pr-2 font-normal">Odcinek</th>
              <th className="py-1 pr-2 font-normal">Kierunek</th>
              <th className="py-1 pr-2 font-normal">Przewyższenie</th>
              {profile.hasElevation && <th className="py-1 pr-2 font-normal">Wysokość</th>}
              <th className="py-1 pr-2 font-normal">Czas</th>
              {startAt !== null && <th className="py-1 font-normal">Dojście</th>}
            </tr>
          </thead>
          <tbody>
            {sections.map((section) => (
              <tr key={section.fromKm} className="border-t border-zinc-200 dark:border-zinc-800">
                <td className="py-1 pr-2">
                  {(Math.round(section.fromKm * 10) / 10).toLocaleString("pl-PL")}–{km(section.toKm)}
                </td>
                <td className="py-1 pr-2">{TREND[section.trend]}</td>
                <td className="py-1 pr-2">
                  ↑ {section.ascentM} m ↓ {section.descentM} m
                </td>
                {profile.hasElevation && (
                  <td className="py-1 pr-2">
                    {section.fromEle} → {section.toEle} m
                  </td>
                )}
                <td className="py-1 pr-2">{formatMinutes(round5(section.minutes))}</td>
                {startAt !== null && <td className="py-1">{clock(section.endMin)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-zinc-500">
        Czas wg DIN 33466 (4 km/h, 300 m/h w górę, 500 m/h w dół), liczony po odcinkach, bez postojów
        {Math.abs(pace - 1) >= 0.05 ? `; tempo dopasowane do czasu punktu w planie (×${pace.toLocaleString("pl-PL", { maximumFractionDigits: 2 })})` : ""}.
      </p>

      <div className="flex flex-col gap-2">
        <h3 className="font-semibold">Woda, schroniska i zejścia przy śladzie</h3>
        {track.pois === undefined ? (
          <p className="text-zinc-500">{canEdit ? "Jeszcze nie sprawdzone." : "Organizator jeszcze ich nie sprawdził."}</p>
        ) : pois.length === 0 ? (
          <p className="text-zinc-500">OpenStreetMap nie ma przy tym śladzie wody, schronisk ani miejscowości.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {pois.map((poi) => (
              <li key={poi.osmId} className="flex flex-wrap items-baseline gap-x-2 tabular-nums">
                <span className="w-16 shrink-0 text-zinc-500">{km(poi.km)}</span>
                <span aria-hidden="true">{POI_ICON[poi.kind]}</span>
                <span>
                  <span className="sr-only">{TRACK_POI_KIND[poi.kind]}: </span>
                  {TRACK_POI_TYPE[poi.type] ?? poi.type}
                  {poi.name ? (
                    <>
                      {" "}
                      <a href={`https://www.openstreetmap.org/${poi.osmId}`} target="_blank" rel="noreferrer" className="underline">
                        {poi.name}
                      </a>
                    </>
                  ) : null}
                  {poi.potable === false ? " · niepitna wg OSM" : poi.kind === "water" && poi.potable === undefined ? " · nie wiadomo, czy pitna" : ""}
                </span>
                <span className="text-xs text-zinc-500">{poi.offM < 50 ? "na śladzie" : `${poi.offM} m od śladu`}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-zinc-500">
          Zejścia to miejscowości, przystanki i ratownictwo górskie blisko śladu — sprawdź na mapie, czy prowadzi do nich szlak.
          {track.pois !== undefined && ` Sprawdzone ${track.pois.fetchedAt}.`} Dane:{" "}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="underline">
            © OpenStreetMap
          </a>{" "}
          (ODbL),{" "}
          <a href="https://openstreetmap.org/fixthemap" target="_blank" rel="noreferrer" className="underline">
            zgłoś błąd
          </a>
          .
        </p>
        {canEdit && (
          <button type="button" onClick={fetchPois} disabled={pending} className="btn-secondary btn-sm self-start">
            {pending ? "Szukam w OpenStreetMap… (do minuty)" : track.pois === undefined ? "Szukaj wody, schronisk i zejść" : "Sprawdź ponownie"}
          </button>
        )}
        {state.error && <p className="text-xs msg-error">{state.error}</p>}
        {state.ok && <p className="text-xs msg-ok">{state.ok}</p>}
      </div>
    </section>
  );
}
