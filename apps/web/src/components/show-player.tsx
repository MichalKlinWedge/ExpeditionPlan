"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import { readingMs, type ShowCredits, type ShowImage } from "@expeditionplan/core";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { SpeakerIcon } from "@/components/icons";
import { polishLabels } from "@/components/plan-map";

/**
 * Odtwarzacz pokazu z lektorem: mapa sceny (przelot kamery do trasy dnia i rysowanie linii), potem zdjęcia z powolnym
 * zbliżeniem, na dole nagłówek sceny i napisy z tekstu lektora. Scena z nagraniem trwa tyle, co nagranie; bez nagrania —
 * tyle, ile czyta się napisy (`readingMs`). Start zawsze z kliknięcia: przeglądarka nie pozwala grać dźwięku bez niego.
 * Kafle OpenFreeMap (wyświetlanie na żywo, bez pobierania na zapas — docs/USLUGI.md).
 */

const STYLE = "https://tiles.openfreemap.org/styles/liberty";
const SEA = "#2e7d74";
const PIN = "#e0662f";
const DRAW_MS = 2_500;
const GAP_MS = 700;

export type ShowMapData = { lines: { coordinates: [number, number][]; routed: boolean }[]; pins: { lng: number; lat: number; name: string }[] };

export type PlayerScene = {
  key: string;
  kind: "intro" | "day" | "outro";
  heading: string;
  subheading?: string;
  text: string;
  images: ShowImage[];
  map: ShowMapData;
  audio?: { url: string; durationMs: number };
};

const sceneMs = (scene: PlayerScene) => scene.audio?.durationMs ?? (scene.text.trim() === "" ? 5_000 : readingMs(scene.text));

/** Zdania tekstu z udziałem w długości (napisy idą proporcjonalnie do liczby znaków). */
function sentences(text: string): { text: string; until: number }[] {
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

/** Linia rysowana od początku do końca: gradient po długości linii z przezroczystym ogonem. */
const drawn = (progress: number) =>
  progress >= 1 ? SEA : ["step", ["line-progress"], SEA, Math.max(progress, 0.0001), "rgba(46,125,116,0)"];

function ShowMap({ data, sceneKey }: { data: ShowMapData; sceneKey: string }) {
  const container = useRef<HTMLDivElement>(null);
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
        });
        // Przypis u góry: na dole są nagłówek sceny i napisy.
        created.addControl(new maplibre.AttributionControl({ compact: true, customAttribution: '<a href="https://openrouteservice.org/" target="_blank">Trasy: openrouteservice.org</a>' }), "top-left");
        created.on("error", (event) => console.warn("Mapa pokazu:", event.error?.message));
        created.on("load", () => {
          if (cancelled || created === undefined) return;
          polishLabels(created);
          created.addSource("show-lines", { type: "geojson", data: geojson({ lines: [], pins: [] }).lines, lineMetrics: true });
          created.addLayer({ id: "show-lines-halo", type: "line", source: "show-lines", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#ffffff", "line-width": 8, "line-opacity": 0.6 } });
          created.addLayer({ id: "show-lines", type: "line", source: "show-lines", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-width": 5, "line-gradient": drawn(0) as never } });
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
        });
      },
      (error: unknown) => setFailure(error instanceof Error ? error.message : String(error)),
    );
    return () => {
      cancelled = true;
      created?.remove();
    };
  }, []);

  // Nowa scena: przelot do jej trasy, potem linia rysuje się od startu do mety.
  useEffect(() => {
    if (map === null) return;
    const { lines, pins } = geojson(data);
    map.setPaintProperty("show-lines", "line-gradient", drawn(0) as never);
    (map.getSource("show-lines") as GeoJSONSource | undefined)?.setData(lines);
    (map.getSource("show-pins") as GeoJSONSource | undefined)?.setData(pins);
    const bounds = boundsOf(data);
    map.stop();
    if (bounds !== null) map.fitBounds(bounds, { padding: { top: 60, bottom: 140, left: 60, right: 60 }, maxZoom: 14, duration: 2_200, essential: true });
    let frame = 0;
    let started = 0;
    const step = (now: number) => {
      started ||= now;
      const progress = Math.min((now - started - 1_200) / DRAW_MS, 1);
      if (progress > 0) map.setPaintProperty("show-lines", "line-gradient", drawn(progress) as never);
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

export function ShowPlayer({ scenes, credits }: { scenes: PlayerScene[]; credits: ShowCredits }) {
  const stage = useRef<HTMLDivElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [subtitles, setSubtitles] = useState(true);
  const [ended, setEnded] = useState(false);
  const scene = scenes[index]!;
  const duration = sceneMs(scene);
  const lines = useMemo(() => sentences(scene.text), [scene.text]);

  /** Czas sceny bez nagrania: przeżywa pauzę, a zeruje się przy zmianie sceny. */
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
      setIndex(Math.max(0, next));
    },
    [scenes.length],
  );

  // Zegar sceny: z nagrania, gdy jest, inaczej z upływu czasu; na końcu krótka przerwa i następna scena.
  // `setInterval`, a nie klatki animacji: w karcie w tle klatki stają, a lektor ma czytać dalej.
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
      if (scene.audio && element) {
        clock.current = element.currentTime * 1000;
        if (element.ended) waited += step;
      } else {
        if (clock.current >= duration) waited += step;
        clock.current = Math.min(clock.current + step, duration);
      }
      setElapsed(clock.current);
      if (waited >= GAP_MS) {
        moved = true;
        go(index + 1);
      }
    }, 100);
    return () => clearInterval(timer);
  }, [playing, index, scene.audio, duration, go]);

  useEffect(() => {
    const element = audio.current;
    if (element === null || !scene.audio) return;
    if (playing) void element.play().catch(() => setPlaying(false));
    else element.pause();
  }, [playing, index, scene.audio]);

  const toggle = () => {
    if (ended) {
      clock.current = 0;
      setEnded(false);
      setIndex(0);
      setElapsed(0);
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

  const mapPhase = scene.images.length === 0 ? duration : Math.min(Math.max(4_500, duration * 0.35), duration * 0.6);
  const perPhoto = scene.images.length === 0 ? 0 : Math.max((duration - mapPhase) / scene.images.length, 3_000);
  const photo = elapsed < mapPhase ? -1 : Math.min(Math.floor((elapsed - mapPhase) / perPhoto), scene.images.length - 1);
  const share = duration === 0 ? 0 : elapsed / duration;
  const line = lines.find((each) => share <= each.until) ?? lines.at(-1);

  return (
    <div className="flex flex-col gap-3">
      <div ref={stage} className="relative aspect-[4/5] w-full sm:aspect-video overflow-hidden rounded-xl bg-black text-white [&:fullscreen]:rounded-none">
        <ShowMap data={scene.map} sceneKey={scene.key} />

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
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button onClick={() => go(index - 1)} disabled={index === 0} className="btn-secondary btn-sm" aria-label="Poprzednia scena">⏮</button>
        <button onClick={toggle} className="btn-secondary btn-sm">{playing ? "⏸ Pauza" : "▶ Odtwórz"}</button>
        <button onClick={() => go(index + 1)} disabled={index === scenes.length - 1} className="btn-secondary btn-sm" aria-label="Następna scena">⏭</button>
        <span className="text-zinc-500">
          scena {index + 1} z {scenes.length}
        </span>
        <span className="flex-1" />
        <button onClick={() => setSubtitles((value) => !value)} className="btn-mini">{subtitles ? "ukryj napisy" : "pokaż napisy"}</button>
        <button onClick={fullscreen} className="btn-mini">pełny ekran</button>
      </div>

      <div className="flex flex-wrap gap-1">
        {scenes.map((each, at) => (
          <button key={each.key} onClick={() => go(at)} className={`btn-mini ${at === index ? "ring-2 ring-sea" : ""}`} title={`${each.heading}${each.audio ? " · z lektorem" : ""}`}>
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
