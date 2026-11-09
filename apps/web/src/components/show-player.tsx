"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import { readingMs, type ShowCredits, type ShowImage } from "@expeditionplan/core";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { SpeakerIcon } from "@/components/icons";
import { polishLabels } from "@/components/plan-map";

// Eksport do pliku wideo dopiero na kliknięcie: osobna paczka, tylko w przeglądarce.
const ShowExport = dynamic(() => import("@/components/show-export").then((module) => module.ShowExport), { ssr: false });

/**
 * Odtwarzacz pokazu z lektorem: mapa sceny (przelot kamery do trasy dnia i rysowanie linii), potem zdjęcia z powolnym
 * zbliżeniem, na dole nagłówek sceny i napisy z tekstu lektora. Scena z nagraniem trwa tyle, co nagranie; bez nagrania —
 * tyle, ile czyta się napisy (`readingMs`). Start zawsze z kliknięcia: przeglądarka nie pozwala grać dźwięku bez niego.
 * Film otwiera ekran startowy (nazwa i daty wyjazdu), zamyka ekran końcowy. Lektor wchodzi po chwili ciszy na pierwszej
 * scenie (`LEAD_MS`), a po ostatnim zdaniu jest jeszcze `TAIL_MS` przed ekranem końcowym. Trasy dnia rysują się po kolei.
 * Podkład muzyczny (opcjonalny) gra w pętli od `skipS` (pominięty początek pliku): narasta na ekranie startowym, pod lektorem cichnie (`MUSIC_UNDER_VOICE`),
 * między scenami wraca, a na ekranie końcowym wygasa.
 * Kafle OpenFreeMap (wyświetlanie na żywo, bez pobierania na zapas — docs/USLUGI.md).
 */

const STYLE = "https://tiles.openfreemap.org/styles/liberty";
const SEA = "#2e7d74";
const PIN = "#e0662f";
/** Rysowanie tras sceny: na odcinek, w granicach całości (krótka scena nie miga, długa nie ciągnie się). */
const DRAW_PER_LINE_MS = 900;
const DRAW_MIN_MS = 2_500;
const DRAW_MAX_MS = 7_000;
const GAP_MS = 700;
/** Cisza przed lektorem pierwszej sceny: mapa rusza, głos dopiero potem. */
const LEAD_MS = 1_000;
/** Przerwa po lektorze ostatniej sceny, zanim pojawi się ekran końcowy. */
const TAIL_MS = 1_000;
/** Ekrany startowy i końcowy. */
const TITLE_MS = 4_000;
const END_MS = 5_000;
/** Podkład pod lektorem: ułamek głośności ustawionej przez organizatora. */
const MUSIC_UNDER_VOICE = 0.3;
/** Jak szybko podkład dochodzi do docelowej głośności: ułamek różnicy na krok zegara (100 ms). */
export const MUSIC_EASE = 0.2;

export type PlayerMusic = { url: string; volume: number; name: string; /** Pominięty początek pliku (s). */ skipS: number };

/** Miejsce startu podkładu: pominięty początek, chyba że plik jest od niego krótszy. */
export const musicStart = (music: PlayerMusic, durationS: number) => (Number.isFinite(durationS) && music.skipS >= durationS ? 0 : music.skipS);

export type ShowMapData = { lines: { coordinates: [number, number][]; routed: boolean }[]; pins: { lng: number; lat: number; name: string }[] };

export type PlayerScene = {
  key: string;
  kind: "intro" | "day" | "outro" | "title" | "end";
  heading: string;
  subheading?: string;
  text: string;
  images: ShowImage[];
  map: ShowMapData;
  audio?: { url: string; durationMs: number };
};

const sceneMs = (scene: PlayerScene) =>
  scene.kind === "title" ? TITLE_MS : scene.kind === "end" ? END_MS : (scene.audio?.durationMs ?? (scene.text.trim() === "" ? 5_000 : readingMs(scene.text)));

export const isCard = (scene: PlayerScene) => scene.kind === "title" || scene.kind === "end";

/**
 * Czas sceny `index`: cisza przed lektorem (tylko pierwsza scena po ekranie startowym), lektor albo czas czytania
 * napisów i przerwa przed następną (ekrany przechodzą od razu; po ostatniej scenie z lektorem dłuższa).
 */
export function sceneTiming(scenes: PlayerScene[], index: number): { lead: number; duration: number; gap: number } {
  const scene = scenes[index]!;
  return { lead: index === 1 ? LEAD_MS : 0, duration: sceneMs(scene), gap: isCard(scene) ? 0 : index === scenes.length - 2 ? TAIL_MS : GAP_MS };
}

/** Które zdjęcie sceny widać po `elapsed` ms (−1: jeszcze mapa); najpierw mapa, potem zdjęcia po równo. */
export function photoAt(count: number, span: number, elapsed: number): { photo: number; mapPhase: number; perPhoto: number } {
  const mapPhase = count === 0 ? span : Math.min(Math.max(4_500, span * 0.35), span * 0.6);
  const perPhoto = count === 0 ? 0 : Math.max((span - mapPhase) / count, 3_000);
  return { mapPhase, perPhoto, photo: elapsed < mapPhase ? -1 : Math.min(Math.floor((elapsed - mapPhase) / perPhoto), count - 1) };
}

/** Długość odcinka w przybliżeniu płaskim (stopnie, długość skrócona o cos szerokości): do podziału czasu rysowania. */
function lengthOf(coordinates: [number, number][]): number[] {
  const steps: number[] = [];
  for (let at = 1; at < coordinates.length; at++) {
    const [a, b] = [coordinates[at - 1]!, coordinates[at]!];
    const scale = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
    steps.push(Math.hypot((b[0] - a[0]) * scale, b[1] - a[1]));
  }
  return steps;
}

/** Trasy narysowane do ułamka `progress` całej długości, po kolei: wcześniejsze w całości, bieżąca do miejsca, dalsze wcale. */
export function drawnLines(lines: ShowMapData["lines"], progress: number): ShowMapData["lines"] {
  if (progress >= 1) return lines;
  const steps = lines.map((line) => lengthOf(line.coordinates));
  const total = steps.flat().reduce((sum, step) => sum + step, 0);
  let left = total * Math.max(progress, 0);
  const out: ShowMapData["lines"] = [];
  for (const [at, line] of lines.entries()) {
    const coordinates: [number, number][] = [line.coordinates[0]!];
    for (const [step, length] of steps[at]!.entries()) {
      const [a, b] = [line.coordinates[step]!, line.coordinates[step + 1]!];
      if (left >= length) {
        coordinates.push(b);
        left -= length;
        continue;
      }
      const part = length === 0 ? 0 : left / length;
      coordinates.push([a[0] + (b[0] - a[0]) * part, a[1] + (b[1] - a[1]) * part]);
      left = 0;
      break;
    }
    if (coordinates.length > 1) out.push({ ...line, coordinates });
    if (left <= 0) break;
  }
  return out;
}

/** Zdania tekstu z udziałem w długości (napisy idą proporcjonalnie do liczby znaków). */
export function sentences(text: string): { text: string; until: number }[] {
  const parts = text.split(/(?<=[.!?…])\s+/).map((part) => part.trim()).filter((part) => part !== "");
  const total = parts.reduce((sum, part) => sum + part.length, 0) || 1;
  let sum = 0;
  return parts.map((part) => {
    sum += part.length;
    return { text: part, until: sum / total };
  });
}

function geojson(data: ShowMapData) {
  return {
    lines: { type: "FeatureCollection" as const, features: data.lines.map((line) => ({ type: "Feature" as const, properties: { routed: line.routed }, geometry: { type: "LineString" as const, coordinates: line.coordinates } })) },
    pins: { type: "FeatureCollection" as const, features: data.pins.map((pin) => ({ type: "Feature" as const, properties: { name: pin.name }, geometry: { type: "Point" as const, coordinates: [pin.lng, pin.lat] } })) },
  };
}

function boundsOf(data: ShowMapData): [[number, number], [number, number]] | null {
  const points = [...data.lines.flatMap((line) => line.coordinates), ...data.pins.map((pin): [number, number] => [pin.lng, pin.lat])];
  if (points.length === 0) return null;
  const lngs = points.map((point) => point[0]);
  const lats = points.map((point) => point[1]);
  return [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]];
}

/**
 * Mapa sceny. `capture`: do eksportu (bufor rysowania zostaje, żeby kadr dało się skopiować na kanwę, piksel 1:1),
 * `onMap` dostaje gotową mapę.
 */
export function ShowMap({ data, sceneKey, capture = false, onMap }: { data: ShowMapData; sceneKey: string; capture?: boolean; onMap?: (map: MapLibreMap) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const ready = useRef(onMap);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let created: MapLibreMap | undefined;
    void import("maplibre-gl").then(
      (maplibre) => {
        if (cancelled || container.current === null) return;
        maplibre.setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).href);
        created = new maplibre.Map({
          container: container.current,
          style: STYLE,
          center: [15, 40],
          zoom: 2,
          interactive: false,
          attributionControl: false,
          ...(capture ? { pixelRatio: 1, canvasContextAttributes: { preserveDrawingBuffer: true } } : {}),
        });
        // Przypis u góry: na dole są nagłówek sceny i napisy.
        created.addControl(new maplibre.AttributionControl({ compact: true, customAttribution: '<a href="https://openrouteservice.org/" target="_blank">Trasy: openrouteservice.org</a>' }), "top-left");
        created.on("error", (event) => console.warn("Mapa pokazu:", event.error?.message));
        created.on("load", () => {
          if (cancelled || created === undefined) return;
          polishLabels(created);
          created.addSource("show-lines", { type: "geojson", data: geojson({ lines: [], pins: [] }).lines });
          created.addLayer({ id: "show-lines-halo", type: "line", source: "show-lines", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#ffffff", "line-width": 8, "line-opacity": 0.6 } });
          created.addLayer({ id: "show-lines", type: "line", source: "show-lines", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-width": 5, "line-color": SEA } });
          created.addSource("show-pins", { type: "geojson", data: geojson({ lines: [], pins: [] }).pins });
          created.addLayer({ id: "show-pins", type: "circle", source: "show-pins", paint: { "circle-radius": 7, "circle-color": PIN, "circle-stroke-color": "#ffffff", "circle-stroke-width": 2.5 } });
          created.addLayer({
            id: "show-pin-names",
            type: "symbol",
            source: "show-pins",
            layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Bold"], "text-size": 15, "text-offset": [0, 1.2], "text-anchor": "top", "text-optional": true },
            paint: { "text-color": "#1f2937", "text-halo-color": "#ffffff", "text-halo-width": 2 },
          });
          setMap(created);
          ready.current?.(created);
        });
      },
      (error: unknown) => setFailure(error instanceof Error ? error.message : String(error)),
    );
    return () => {
      cancelled = true;
      created?.remove();
    };
  }, [capture]);

  // Nowa scena: przelot do jej trasy, potem trasy rysują się po kolei, w kolejności planu.
  useEffect(() => {
    if (map === null) return;
    const source = map.getSource("show-lines") as GeoJSONSource | undefined;
    source?.setData(geojson({ lines: [], pins: [] }).lines);
    (map.getSource("show-pins") as GeoJSONSource | undefined)?.setData(geojson(data).pins);
    const bounds = boundsOf(data);
    map.stop();
    if (bounds !== null) map.fitBounds(bounds, { padding: { top: 60, bottom: 140, left: 60, right: 60 }, maxZoom: 14, duration: 2_200, essential: true });
    const drawMs = Math.min(Math.max(data.lines.length * DRAW_PER_LINE_MS, DRAW_MIN_MS), DRAW_MAX_MS);
    let frame = 0;
    let started = 0;
    const step = (now: number) => {
      started ||= now;
      const progress = Math.min((now - started - 1_200) / drawMs, 1);
      if (progress > 0) source?.setData(geojson({ lines: drawnLines(data.lines, progress), pins: [] }).lines);
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [map, data, sceneKey]);

  return (
    <div className="absolute inset-0 bg-zinc-200">
      <div ref={container} className="size-full" />
      {failure && <p className="absolute inset-x-0 top-1/2 text-center text-sm text-zinc-600">Mapa się nie wczytała: {failure}</p>}
    </div>
  );
}

/** Docelowa głośność podkładu w tej chwili sceny. */
export function musicLevel(scene: PlayerScene, volume: number, clock: number, speaking: boolean): number {
  if (scene.kind === "end") return volume * Math.max(0, 1 - clock / (END_MS - 500));
  return speaking ? volume * MUSIC_UNDER_VOICE : volume;
}

export function ShowPlayer({
  scenes: story,
  credits,
  trip,
  music,
  exportable = false,
}: {
  scenes: PlayerScene[];
  credits: ShowCredits;
  /** `label`: nadtytuł ekranu startowego („Zapowiedź wyjazdu”, „Film z wyjazdu”). */
  trip: { title: string; dates: string; label: string };
  music?: PlayerMusic;
  /** Przycisk eksportu do pliku wideo (w aplikacji; pod publicznym linkiem nie). */
  exportable?: boolean;
}) {
  // Ekrany startowy i końcowy: bez lektora, z mapą pierwszej i ostatniej sceny pod spodem (mapa zdąży się wczytać).
  const scenes = useMemo<PlayerScene[]>(() => {
    const first = story[0];
    const last = story.at(-1);
    const blank = { lines: [], pins: [] };
    return [
      { key: "title", kind: "title", heading: trip.title, subheading: trip.dates, text: "", images: [], map: first?.map ?? blank },
      ...story,
      { key: "end", kind: "end", heading: "Koniec", subheading: `${trip.title} · ${trip.dates}`, text: "", images: [], map: last?.map ?? blank },
    ];
  }, [story, trip.title, trip.dates]);
  const stage = useRef<HTMLDivElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const backing = useRef<HTMLAudioElement>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  /** Czas sceny od jej początku (z ciszą przed lektorem) i czas samego lektora. */
  const [elapsed, setElapsed] = useState(0);
  const [narrated, setNarrated] = useState(0);
  const [subtitles, setSubtitles] = useState(true);
  const [ended, setEnded] = useState(false);
  const [exporting, setExporting] = useState(false);
  const scene = scenes[index]!;
  const { lead, duration, gap } = sceneTiming(scenes, index);
  const span = lead + duration;
  const lines = useMemo(() => sentences(scene.text), [scene.text]);

  /** Czas sceny (z ciszą przed lektorem): przeżywa pauzę, a zeruje się przy zmianie sceny. */
  const clock = useRef(0);

  const go = useCallback(
    (next: number) => {
      if (next >= scenes.length) {
        setPlaying(false);
        setEnded(true);
        return;
      }
      clock.current = 0;
      setEnded(false);
      setElapsed(0);
      setNarrated(0);
      setIndex(Math.max(0, next));
    },
    [scenes.length],
  );

  // Zegar sceny: cisza przed lektorem (`lead`), potem nagranie, gdy jest, inaczej upływ czasu; na końcu przerwa
  // (`gap`) i następna scena. `setInterval`, a nie klatki animacji: w karcie w tle klatki stają, a lektor ma czytać dalej.
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let waited = 0;
    let moved = false;
    const timer = setInterval(() => {
      if (moved) return;
      const now = performance.now();
      const step = now - last;
      last = now;
      const element = audio.current;
      let voice: number;
      let finished: boolean;
      if (scene.audio && element) {
        if (clock.current < lead) clock.current = Math.min(clock.current + step, lead);
        // Głos rusza dopiero po ciszy; przeglądarka pozwala, bo pokaz uruchomiło kliknięcie.
        else if (element.paused && !element.ended) void element.play().catch(() => setPlaying(false));
        voice = element.currentTime * 1000;
        if (clock.current >= lead) clock.current = lead + voice;
        finished = element.ended;
      } else {
        finished = clock.current >= span;
        clock.current = Math.min(clock.current + step, span);
        voice = Math.max(clock.current - lead, 0);
      }
      if (finished) waited += step;
      const bed = backing.current;
      if (bed && music) {
        // Pod lektorem (z ciszą przed nim) ciszej; scena z samymi napisami i przerwy między scenami — pełna głośność.
        const target = musicLevel(scene, music.volume, clock.current, scene.audio !== undefined && !finished);
        bed.volume = Math.min(Math.max(bed.volume + (target - bed.volume) * MUSIC_EASE, 0), 1);
      }
      setElapsed(clock.current);
      setNarrated(voice);
      if (finished && waited >= gap) {
        moved = true;
        go(index + 1);
      }
    }, 100);
    return () => clearInterval(timer);
  }, [playing, index, scene, lead, span, gap, go, music]);

  useEffect(() => {
    if (!playing) audio.current?.pause();
  }, [playing, index]);

  // Podkład gra, póki gra pokaz; pauza go zatrzymuje, a koniec pokazu (ostatni ekran minął) też.
  useEffect(() => {
    const bed = backing.current;
    if (bed === null) return;
    if (playing) void bed.play().catch(() => undefined);
    else bed.pause();
  }, [playing]);

  const toggle = () => {
    // Pokaz od początku: podkład też od początku i narasta od ciszy.
    const bed = backing.current;
    if (bed && music && (ended || (index === 0 && clock.current === 0))) {
      bed.currentTime = musicStart(music, bed.duration);
      bed.volume = 0;
    }
    if (ended) {
      clock.current = 0;
      setEnded(false);
      setIndex(0);
      setElapsed(0);
      setNarrated(0);
    }
    setPlaying((value) => !value);
  };

  const fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stage.current?.requestFullscreen();
  };

  // Klawisze jak w odtwarzaczu filmów: spacja, strzałki, F.
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)) return;
      if (event.key === " ") toggle();
      else if (event.key === "ArrowRight") go(index + 1);
      else if (event.key === "ArrowLeft") go(index - 1);
      else if (event.key.toLowerCase() === "f") fullscreen();
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  const { photo, perPhoto } = photoAt(scene.images.length, span, elapsed);
  const share = span === 0 ? 0 : elapsed / span;
  // Napisy idą za głosem; w ciszy przed lektorem ich nie ma.
  const line = elapsed < lead ? undefined : (lines.find((each) => (duration === 0 ? 0 : narrated / duration) <= each.until) ?? lines.at(-1));

  return (
    <div className="flex flex-col gap-3">
      <div ref={stage} className="relative aspect-[4/5] w-full sm:aspect-video overflow-hidden rounded-xl bg-black text-white [&:fullscreen]:rounded-none">
        <ShowMap data={scene.map} sceneKey={scene.key} />

        <div className={`pointer-events-none absolute inset-0 z-[25] flex flex-col items-center justify-center gap-3 bg-[#1b2a3a] px-8 text-center transition-opacity duration-700 ${isCard(scene) ? "opacity-100" : "opacity-0"}`}>
          <div className="topo absolute inset-0 opacity-60" />
          {scene.kind === "end" ? (
            <>
              <p className="relative text-4xl font-bold sm:text-6xl">Koniec</p>
              <p className="relative text-lg text-white/85 sm:text-2xl">{trip.title}</p>
              <p className="relative text-sm text-white/70 sm:text-base">{trip.dates}</p>
              <p className="relative mt-4 text-xs text-white/50">
                Mapy © OpenStreetMap · głos lektora: Gemini TTS{music ? ` · muzyka: ${music.name.replace(/\.[a-z0-9]+$/i, "")}` : ""} · Expedition Planner
              </p>
            </>
          ) : (
            <>
              <p className="relative text-sm tracking-widest text-white/70 uppercase sm:text-base">{trip.label}</p>
              <p className="relative text-4xl font-bold sm:text-6xl">{trip.title}</p>
              <p className="relative text-lg text-white/85 sm:text-2xl">{trip.dates}</p>
            </>
          )}
        </div>

        {scene.images.map((image, at) => (
          <figure key={`${scene.key}-${image.url}`} className={`absolute inset-0 z-10 transition-opacity duration-1000 ${photo === at ? "opacity-100" : "opacity-0"}`}>
            {/* Zdjęcia z Commons i podpisane z dziennika: zwykły <img>, adresy podpisane wygasają. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={image.url} alt={image.caption} className={`size-full object-cover ${photo === at ? "show-kenburns" : ""}`} style={{ animationDuration: `${perPhoto + 1_000}ms` }} />
            {(image.caption || image.credit) && (
              <figcaption className="absolute top-3 right-3 max-w-[60%] rounded bg-black/50 px-2 py-1 text-right text-xs">
                {image.caption}
                {image.credit && <span className="block text-[10px] text-white/70">fot. {image.credit}</span>}
              </figcaption>
            )}
          </figure>
        ))}

        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col gap-2 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-5 pt-16 pb-4 sm:px-8">
          <div>
            <p className="text-lg font-semibold drop-shadow sm:text-2xl">{scene.heading}</p>
            {scene.subheading && <p className="text-sm text-white/80 sm:text-base">{scene.subheading}</p>}
          </div>
          {subtitles && line && <p className="max-w-3xl text-sm leading-snug sm:text-lg">{line.text}</p>}
        </div>

        {(!playing || ended) && (
          <button onClick={toggle} className="absolute inset-0 z-30 flex items-center justify-center bg-black/30 text-white" aria-label={ended ? "Obejrzyj jeszcze raz" : "Odtwórz"}>
            <span className="flex size-20 items-center justify-center rounded-full bg-black/60 text-4xl">{ended ? "↻" : "▶"}</span>
          </button>
        )}

        <div className="absolute inset-x-0 bottom-0 z-20 h-1 bg-white/20">
          <div className="h-full bg-white/80" style={{ width: `${((index + Math.min(share, 1)) / scenes.length) * 100}%` }} />
        </div>
        {scene.audio && <audio ref={audio} key={scene.key} src={scene.audio.url} preload="auto" />}
        {music && (
          // Pętla ręcznie, a nie `loop`: po końcu utwór wraca do pominiętego początku, nie do zera.
          <audio
            ref={backing}
            src={music.url}
            preload="auto"
            onLoadedMetadata={(event) => (event.currentTarget.currentTime = musicStart(music, event.currentTarget.duration))}
            onEnded={(event) => {
              event.currentTarget.currentTime = musicStart(music, event.currentTarget.duration);
              void event.currentTarget.play().catch(() => undefined);
            }}
          />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button onClick={() => go(index - 1)} disabled={index === 0} className="btn-secondary btn-sm" aria-label="Poprzednia scena">⏮</button>
        <button onClick={toggle} className="btn-secondary btn-sm">{playing ? "⏸ Pauza" : "▶ Odtwórz"}</button>
        <button onClick={() => go(index + 1)} disabled={index === scenes.length - 1} className="btn-secondary btn-sm" aria-label="Następna scena">⏭</button>
        <span className="text-zinc-500">{scene.kind === "title" ? "ekran startowy" : scene.kind === "end" ? "ekran końcowy" : `scena ${index} z ${story.length}`}</span>
        <span className="flex-1" />
        <button onClick={() => setSubtitles((value) => !value)} className="btn-mini">{subtitles ? "ukryj napisy" : "pokaż napisy"}</button>
        <button onClick={fullscreen} className="btn-mini">pełny ekran</button>
        {exportable && (
          <button
            onClick={() => {
              setPlaying(false);
              setExporting(true);
            }}
            disabled={exporting}
            className="btn-mini"
            title="Nagranie filmu do pliku w tej przeglądarce"
          >
            eksport do MP4
          </button>
        )}
      </div>

      {exporting && <ShowExport scenes={scenes} trip={trip} subtitles={subtitles} {...(music ? { music } : {})} onClose={() => setExporting(false)} />}

      <div className="flex flex-wrap gap-1">
        {story.map((each, at) => (
          <button key={each.key} onClick={() => go(at + 1)} className={`btn-mini ${at + 1 === index ? "ring-2 ring-sea" : ""}`} title={`${each.heading}${each.audio ? " · z lektorem" : ""}`}>
            {each.kind === "intro" ? "Start" : each.kind === "outro" ? "Koniec" : each.heading.split(" · ")[0]}
            {each.audio ? <SpeakerIcon className="size-3.5 text-green-700 dark:text-green-400" /> : each.text.trim() !== "" ? " ✎" : ""}
          </button>
        ))}
      </div>

      {(credits.articles.length > 0 || credits.images.length > 0) && (
        <details className="text-xs text-zinc-500">
          <summary className="cursor-pointer">Źródła tekstu i zdjęć</summary>
          {credits.articles.length > 0 && (
            <p className="mt-1">
              Tekst lektora częściowo na podstawie artykułów (CC BY-SA 4.0):{" "}
              {credits.articles.map((article, at) => (
                <span key={article.url}>
                  {at > 0 && ", "}
                  <a href={article.url} target="_blank" rel="noreferrer" className="underline">
                    {article.title}
                  </a>
                </span>
              ))}
              .
            </p>
          )}
          {credits.images.length > 0 && (
            <ul className="mt-1 flex flex-col gap-0.5">
              {credits.images.map((image) => (
                <li key={image.sourceUrl}>
                  <a href={image.sourceUrl} target="_blank" rel="noreferrer" className="underline">
                    {image.title.replace(/^File:/, "")}
                  </a>
                  {image.author ? ` — ${image.author}` : ""}
                  {image.license ? `, ${image.license}` : ""} (Wikimedia Commons)
                </li>
              ))}
            </ul>
          )}
        </details>
      )}
    </div>
  );
}
