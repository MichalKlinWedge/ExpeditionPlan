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
 * Scena idzie etapami (`scenePhases`), każda mapa najwyżej 5 s: wstęp zaczyna dojazd, zakończenie powrót, potem cała
 * trasa; dzień to widok dnia z kartą „Plan dnia”, przybliżenia tras pieszych (inny kolor), a gdy zostaje czas — kolejne
 * miejsca dnia. Zdjęcia są najważniejsze: mapy biorą najwyżej 40% sceny ze zdjęciami, resztę dostają zdjęcia.
 * Podkład muzyczny (opcjonalny) gra w pętli od `skipS` (pominięty początek pliku): narasta na ekranie startowym, pod lektorem cichnie (`MUSIC_UNDER_VOICE`),
 * między scenami wraca, a na ekranie końcowym wygasa.
 * Kafle OpenFreeMap (wyświetlanie na żywo, bez pobierania na zapas — docs/USLUGI.md).
 */

const STYLE = "https://tiles.openfreemap.org/styles/liberty";
const SEA = "#2e7d74";
const PIN = "#e0662f";
/** Trasy piesze i rowerowe: odróżniają się od przejazdów. */
const FOOT = "#c2410c";
/** Rysowanie tras sceny: na odcinek, w granicach całości (krótka scena nie miga, długa nie ciągnie się). */
const DRAW_PER_LINE_MS = 900;
const DRAW_MIN_MS = 2_500;
const DRAW_MAX_MS = 3_500;
/** Etapy sceny dnia: widok dnia najwyżej tyle, trasa piesza w tych granicach (najwyżej 3 trasy), zdjęcie co najmniej tyle. */
const MAP_MS = 5_000;
const MAP_MIN_MS = 2_500;
const WALK_MS = 4_000;
const MAX_WALKS = 2;
/** Mapy w scenie ze zdjęciami: razem najwyżej taki ułamek sceny. */
const MAP_SHARE = 0.4;
const PHOTO_MIN_MS = 2_500;
const WALK_DRAW_MS = 2_500;
const GAP_MS = 700;
/** Cisza przed lektorem pierwszej sceny: mapa rusza, głos dopiero potem. */
const LEAD_MS = 1_000;
/** Przerwa po lektorze ostatniej sceny, zanim pojawi się ekran końcowy. */
const TAIL_MS = 1_000;
/** Ekrany startowy i końcowy. */
const TITLE_MS = 3_000;
const END_MS = 2_000;
/** Podkład pod lektorem: ułamek głośności ustawionej przez organizatora. */
const MUSIC_UNDER_VOICE = 0.3;
/** Jak szybko podkład dochodzi do docelowej głośności: ułamek różnicy na krok zegara (100 ms). */
export const MUSIC_EASE = 0.2;

export type PlayerMusic = { url: string; volume: number; name: string; /** Pominięty początek pliku (s). */ skipS: number };

/** Miejsce startu podkładu: pominięty początek, chyba że plik jest od niego krótszy. */
export const musicStart = (music: PlayerMusic, durationS: number) => (Number.isFinite(durationS) && music.skipS >= durationS ? 0 : music.skipS);

export type ShowMapData = { lines: { coordinates: [number, number][]; routed: boolean; foot?: boolean }[]; pins: { lng: number; lat: number; name: string }[] };

/** Trasa piesza sceny: linie mapy sceny (`lines`, indeksy), a bez nich miejsce do przybliżenia (`at`). */
export type PlayerWalk = { title: string; label: string; facts: string; lines: number[]; at?: [number, number]; profile?: { km: number; ele: number }[] };

/** Profil trasy pieszej w ujęciu tej trasy (wspólny dla odtwarzacza i eksportu): punkty w ułamkach 0–1 i podpisy. */
export function walkProfile(scene: PlayerScene, phase: ScenePhase): { points: [number, number][]; low: number; high: number; km: number } | null {
  if (phase.kind !== "walk") return null;
  const profile = scene.walks[phase.index]?.profile;
  if (profile === undefined || profile.length < 2) return null;
  const heights = profile.map((point) => point.ele);
  const [low, high] = [Math.min(...heights), Math.max(...heights)];
  const km = profile.at(-1)!.km;
  const range = Math.max(high - low, 1);
  return { points: profile.map((point) => [km === 0 ? 0 : point.km / km, (point.ele - low) / range]), low, high, km };
}

/** Co mapa pokazuje: cały dzień (`null`) albo przybliżoną trasę pieszą lub miejsce (`at`). */
export type MapFocus = { key: string; lines: number[]; at?: [number, number] } | null;

/** Dojazd (wstęp) albo powrót (zakończenie): własna mapa, cała, z lotem. */
export type PlayerApproach = { map: ShowMapData; label: string; title: string; facts: string };

export type PlayerScene = {
  key: string;
  kind: "intro" | "about" | "day" | "outro" | "title" | "end";
  heading: string;
  subheading?: string;
  text: string;
  images: ShowImage[];
  map: ShowMapData;
  audio?: { url: string; durationMs: number };
  /** Karta „Plan dnia” (liczby i najważniejsze punkty) i trasy piesze do przybliżenia. */
  stats: string[];
  points: string[];
  walks: PlayerWalk[];
  approach?: PlayerApproach;
  /** Kolaż zdjęć (wstęp): jeden etap ze wszystkimi naraz. */
  collage?: ShowImage[];
  /** Kolaż ze zdjęć opisów miejsc (wstęp filmu), etap `collage` z `index` 1. */
  guideCollage?: ShowImage[];
  /** Scena bez mapy (wstęp filmu): plansza z tekstem (`text`), potem kolaże i zdjęcia. */
  mapless?: boolean;
  /** Zdjęcia wybrane w edycji (`ShowScript.photos`): scena trwa tyle, żeby pokazać każde (`chosenPhotosMs`). */
  chosen?: boolean;
  /** Wstęp z mapą dojazdu, ale bez mapy całej trasy. */
  noOverview?: boolean;
  /** Plansza „Kto jedzie i plan” na końcu wstępu: etap `text` z `index` 1. */
  plan?: { people: string[]; days: string[] };
};

/** Kolaż etapu `collage`: `index` 0 — z dziennika (`collage`), 1 — z opisów miejsc (`guideCollage`). */
export const collageAt = (scene: PlayerScene, index: number): ShowImage[] | undefined => (index === 1 ? scene.guideCollage : scene.collage);

/**
 * Najkrótsza scena, w której zmieści się każde wybrane zdjęcie (po `PHOTO_MIN_MS`) obok map (razem najwyżej
 * `MAP_SHARE` sceny, każda co najmniej `MAP_MIN_MS`): wybranych zdjęć nic nie ucina, po lektorze zdjęcia lecą dalej.
 */
const chosenPhotosMs = (scene: PlayerScene) => {
  const slides = scene.images.length + (scene.collage && scene.collage.length > 0 ? 1 : 0) + (scene.guideCollage && scene.guideCollage.length > 0 ? 1 : 0) + (scene.plan ? 1 : 0);
  if (!scene.chosen || slides === 0) return 0;
  const shots = 1 + (scene.approach ? 1 : 0);
  return Math.max((slides * PHOTO_MIN_MS) / (1 - MAP_SHARE), slides * PHOTO_MIN_MS + shots * MAP_MIN_MS);
};

const sceneMs = (scene: PlayerScene) =>
  scene.kind === "title"
    ? TITLE_MS
    : scene.kind === "end"
      ? END_MS
      : Math.max(scene.audio?.durationMs ?? (scene.text.trim() === "" ? 5_000 : readingMs(scene.text)), chosenPhotosMs(scene));

/** Kolumny kolażu: 2 i 3 zdjęcia w rzędzie, 4 w kwadracie, więcej po 3 (na wąskim ekranie po 2). */
export const collageGrid = (count: number) => (count <= 3 ? { columns: count } : count === 4 ? { columns: 2 } : { columns: 3 });
const collageColumns = (count: number) => (count <= 2 ? "grid-cols-2" : count === 3 ? "grid-cols-3" : count === 4 ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3");

export const isCard = (scene: PlayerScene) => scene.kind === "title" || scene.kind === "end";

/**
 * Czas sceny `index`: cisza przed lektorem (tylko pierwsza scena po ekranie startowym), lektor albo czas czytania
 * napisów i przerwa przed następną (ekrany przechodzą od razu; po ostatniej scenie z lektorem dłuższa).
 */
export function sceneTiming(scenes: PlayerScene[], index: number): { lead: number; duration: number; gap: number } {
  const scene = scenes[index]!;
  return { lead: index === 1 ? LEAD_MS : 0, duration: sceneMs(scene), gap: isCard(scene) ? 0 : index === scenes.length - 2 ? TAIL_MS : GAP_MS };
}

/**
 * Etap sceny: mapa dojazdu/powrotu, widok dnia (albo całej trasy), przybliżenie trasy pieszej (`index` w `walks`),
 * przybliżenie miejsca (`index` w `map.pins`) albo zdjęcie (`index` w `images`).
 */
export type ScenePhase = { kind: "approach" | "map" | "walk" | "pin" | "collage" | "photo" | "text"; index: number; start: number; end: number };

/** Etap ze zdjęciami (kolaż albo zdjęcie) albo plansza z tekstem: zasłania mapę i nie ma karty. */
export const isPhotoPhase = (phase: ScenePhase) => phase.kind === "photo" || phase.kind === "collage" || phase.kind === "text";

/** Etapy po mapach, po kolei: kolaż z opisów miejsc, kolaż zdjęć dni, zdjęcia, plansza „Kto jedzie i plan”. */
function introSlides(scene: PlayerScene): { kind: "collage" | "photo" | "text"; index: number }[] {
  return [
    ...(scene.guideCollage && scene.guideCollage.length > 0 ? [{ kind: "collage" as const, index: 1 }] : []),
    ...(scene.collage && scene.collage.length > 0 ? [{ kind: "collage" as const, index: 0 }] : []),
    ...scene.images.map((_, index) => ({ kind: "photo" as const, index })),
    ...(scene.plan ? [{ kind: "text" as const, index: 1 }] : []),
  ];
}

/**
 * Scena bez mapy (wstęp filmu): plansza z tytułem i liczbami (`MAP_MS`, a bez zdjęć cała scena), potem kolaż
 * z opisów miejsc, kolaż z dziennika i zdjęcia, po równo w reszcie czasu.
 */
function maplessPhases(scene: PlayerScene, span: number): ScenePhase[] {
  const slides = introSlides(scene);
  const textMs = slides.length === 0 ? span : Math.min(MAP_MS, span / (slides.length + 1));
  const phases: ScenePhase[] = [{ kind: "text", index: 0, start: 0, end: textMs }];
  const per = slides.length === 0 ? 0 : (span - textMs) / slides.length;
  slides.forEach((slide, at) => phases.push({ ...slide, start: textMs + at * per, end: textMs + (at + 1) * per }));
  phases.at(-1)!.end = Math.max(phases.at(-1)!.end, span);
  return phases;
}

/**
 * Etapy sceny w czasie `span`. Mapy po kolei, każda najwyżej `MAP_MS`: dojazd/powrót, widok, do `MAX_WALKS` tras pieszych.
 * Ze zdjęciami mapy razem biorą najwyżej `MAP_SHARE` sceny (najpierw odpadają trasy, potem mapy się skracają, do
 * `MAP_MIN_MS`), a zdjęcia całą resztę, po równo (co najmniej `PHOTO_MIN_MS`; co się nie zmieści, przepada): mało zdjęć
 * to dłużej każde, nigdy powtórka. Scena bez zdjęć wypełnia czas odrzuconymi trasami, potem przybliżeniami kolejnych
 * miejsc (każde do `MAP_MS`, co najmniej `MAP_MIN_MS`).
 * Ostatni etap trwa do końca sceny.
 */
export function scenePhases(scene: PlayerScene, span: number): ScenePhase[] {
  if (isCard(scene)) return [{ kind: "map", index: 0, start: 0, end: span }];
  if (scene.mapless) return maplessPhases(scene, span);
  // Kolaż liczy się jak jedno zdjęcie i idzie przed zdjęciami; plansza planu (wstęp) jak zdjęcie, na końcu.
  const slides = introSlides(scene);
  const photos = slides.length;
  const shots: { kind: ScenePhase["kind"]; index: number; ms: number }[] = [];
  if (scene.approach) shots.push({ kind: "approach", index: 0, ms: MAP_MS });
  if (!scene.noOverview) shots.push({ kind: "map", index: 0, ms: MAP_MS });
  for (const index of scene.walks.slice(0, MAX_WALKS).keys()) shots.push({ kind: "walk", index, ms: WALK_MS });
  const total = () => shots.reduce((sum, shot) => sum + shot.ms, 0);
  const limit = photos > 0 ? Math.max(span * MAP_SHARE, MAP_MIN_MS) : span;
  const dropped: typeof shots = [];
  // Najpierw odpadają trasy bez profilu wysokości; trasa z profilem zostaje (najwyżej się skraca).
  const droppable = () => shots.findLastIndex((shot) => shot.kind === "walk" && scene.walks[shot.index]?.profile === undefined);
  while (total() > limit && droppable() !== -1) dropped.unshift(...shots.splice(droppable(), 1));
  if (total() > limit) {
    const scale = limit / total();
    for (const shot of shots) shot.ms = photos > 0 ? Math.max(shot.ms * scale, MAP_MIN_MS) : shot.ms * scale;
  }
  const perPhoto = photos === 0 ? 0 : Math.max((span - total()) / photos, PHOTO_MIN_MS);
  let left = photos === 0 ? span - total() : 0;
  // Wolny czas najpierw wraca do odrzuconych tras pieszych, potem idą miejsca sceny.
  const extra = [...dropped, ...[...scene.map.pins.keys()].map((index) => ({ kind: "pin" as const, index, ms: MAP_MS }))];
  for (const shot of extra) {
    if (left < MAP_MIN_MS) break;
    const ms = Math.min(shot.ms, left);
    shots.push({ ...shot, ms });
    left -= ms;
  }
  const phases: ScenePhase[] = [];
  let at = 0;
  for (const shot of shots) {
    phases.push({ kind: shot.kind, index: shot.index, start: at, end: at + shot.ms });
    at += shot.ms;
  }
  for (const slide of slides) {
    phases.push({ ...slide, start: at, end: at + perPhoto });
    at += perPhoto;
  }
  const last = phases.at(-1)!;
  last.end = Math.max(last.end, span);
  return phases;
}

/** Etap w chwili `elapsed` i ostatni etap mapy (widok albo trasa) do niej: zdjęcie zasłania mapę, która stoi, jak była. */
export function phaseAt(phases: ScenePhase[], elapsed: number): { phase: ScenePhase; mapPhase: ScenePhase } {
  const passed = phases.filter((phase) => phase.start <= elapsed);
  const phase = passed.at(-1) ?? phases[0]!;
  const mapPhase = passed.filter((each) => !isPhotoPhase(each)).at(-1) ?? phases[0]!;
  return { phase, mapPhase };
}

/** Przybliżenie mapy dla etapu: trasa piesza, miejsce albo `null` (cały widok). */
export const mapFocus = (scene: PlayerScene, mapPhase: ScenePhase): MapFocus => {
  if (mapPhase.kind === "pin") {
    const pin = scene.map.pins[mapPhase.index];
    return pin === undefined ? null : { key: `${scene.key}:pin:${mapPhase.index}`, lines: [], at: [pin.lng, pin.lat] };
  }
  const walk = mapPhase.kind === "walk" ? scene.walks[mapPhase.index] : undefined;
  return walk === undefined ? null : { key: `${scene.key}:walk:${mapPhase.index}`, lines: walk.lines, ...(walk.at ? { at: walk.at } : {}) };
};

/** Dane mapy etapu: mapa dojazdu albo powrotu, inaczej mapa sceny. */
export const mapDataFor = (scene: PlayerScene, mapPhase: ScenePhase): ShowMapData => (mapPhase.kind === "approach" && scene.approach ? scene.approach.map : scene.map);

/** Karta w prawym górnym rogu dla etapu (wspólna dla odtwarzacza i eksportu); zdjęcia i ekrany jej nie mają. */
export type PhaseCard = { label: string; title?: string; lines: string[]; bullets: string[] };

export function phaseCard(scene: PlayerScene, phase: ScenePhase): PhaseCard | null {
  if (isCard(scene)) return null;
  if (phase.kind === "approach" && scene.approach) return { label: scene.approach.label, title: scene.approach.title, lines: scene.approach.facts ? [scene.approach.facts] : [], bullets: [] };
  if (phase.kind === "walk") {
    const walk = scene.walks[phase.index];
    return walk ? { label: walk.label, title: walk.title, lines: walk.facts ? [walk.facts] : [], bullets: [] } : null;
  }
  if (phase.kind === "pin") {
    const pin = scene.map.pins[phase.index];
    return pin ? { label: scene.kind === "day" ? "Na trasie dnia" : "Na trasie", title: pin.name, lines: [], bullets: [] } : null;
  }
  if (phase.kind === "map" && (scene.stats.length > 0 || scene.points.length > 0)) {
    return { label: scene.kind === "day" ? "Plan dnia" : "Wyjazd", ...(scene.stats.length > 0 ? { title: scene.stats.join(" · ") } : {}), lines: [], bullets: scene.points };
  }
  return null;
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
    lines: { type: "FeatureCollection" as const, features: data.lines.map((line) => ({ type: "Feature" as const, properties: { routed: line.routed, foot: line.foot === true }, geometry: { type: "LineString" as const, coordinates: line.coordinates } })) },
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
export function ShowMap({
  data,
  sceneKey,
  focus = null,
  capture = false,
  onMap,
}: {
  data: ShowMapData;
  sceneKey: string;
  /** Przybliżona trasa piesza; obiekt stały dla etapu (zmiana = nowe ujęcie). */
  focus?: MapFocus;
  capture?: boolean;
  onMap?: (map: MapLibreMap) => void;
}) {
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
          created.addLayer({ id: "show-lines", type: "line", source: "show-lines", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-width": 5, "line-color": ["case", ["get", "foot"], FOOT, SEA] } });
          // Przybliżona trasa piesza rysuje się na wierzchu, grubiej.
          created.addSource("show-focus", { type: "geojson", data: geojson({ lines: [], pins: [] }).lines });
          created.addLayer({ id: "show-focus-halo", type: "line", source: "show-focus", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#ffffff", "line-width": 11, "line-opacity": 0.8 } });
          created.addLayer({ id: "show-focus", type: "line", source: "show-focus", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-width": 6, "line-color": FOOT } });
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

  // Nowa scena: przelot do jej trasy, potem trasy rysują się po kolei, w kolejności planu. Etap trasy pieszej: cały dzień
  // narysowany, przelot do tej trasy i rysowanie jej na wierzchu.
  useEffect(() => {
    if (map === null) return;
    const source = map.getSource("show-lines") as GeoJSONSource | undefined;
    const focusSource = map.getSource("show-focus") as GeoJSONSource | undefined;
    const empty = geojson({ lines: [], pins: [] }).lines;
    (map.getSource("show-pins") as GeoJSONSource | undefined)?.setData(geojson(data).pins);
    focusSource?.setData(empty);
    map.stop();
    const padding = { top: 60, bottom: 140, left: 60, right: 60 };
    let target = source;
    let lines = data.lines;
    let drawMs = Math.min(Math.max(data.lines.length * DRAW_PER_LINE_MS, DRAW_MIN_MS), DRAW_MAX_MS);
    let delay = 1_200;
    if (focus === null) {
      source?.setData(empty);
      const bounds = boundsOf(data);
      if (bounds !== null) map.fitBounds(bounds, { padding, maxZoom: 14, duration: 2_200, essential: true });
    } else {
      source?.setData(geojson(data).lines);
      lines = focus.lines.flatMap((at) => (data.lines[at] ? [data.lines[at]] : []));
      const bounds = boundsOf({ lines, pins: [] });
      if (bounds !== null) map.fitBounds(bounds, { padding, maxZoom: 15, duration: 1_800, essential: true });
      else if (focus.at) map.flyTo({ center: focus.at, zoom: 13, duration: 1_800, essential: true });
      target = focusSource;
      drawMs = WALK_DRAW_MS;
      delay = 900;
    }
    let frame = 0;
    let started = 0;
    const step = (now: number) => {
      started ||= now;
      const progress = Math.min((now - started - delay) / drawMs, 1);
      if (progress > 0) target?.setData(geojson({ lines: drawnLines(lines, progress), pins: [] }).lines);
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    if (lines.length > 0) frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [map, data, sceneKey, focus]);

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
      { key: "title", kind: "title", heading: trip.title, subheading: trip.dates, text: "", images: [], map: first?.map ?? blank, stats: [], points: [], walks: [] },
      ...story,
      { key: "end", kind: "end", heading: "Koniec", subheading: `${trip.title} · ${trip.dates}`, text: "", images: [], map: last?.map ?? blank, stats: [], points: [], walks: [] },
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
  // Napisy domyślnie wyłączone: lektor mówi, a kadr zostaje dla zdjęć.
  const [subtitles, setSubtitles] = useState(false);
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

  const phases = useMemo(() => scenePhases(scene, span), [scene, span]);
  const { phase, mapPhase } = phaseAt(phases, elapsed);
  const photo = phase.kind === "photo" ? phase.index : -1;
  const perPhoto = phase.end - phase.start;
  // Obiekt stały dla etapu: mapa robi nowe ujęcie tylko przy zmianie etapu.
  const focusKey = `${scene.key}:${mapPhase.kind}:${mapPhase.index}`;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const focus = useMemo(() => mapFocus(scene, mapPhase), [focusKey]);
  const mapData = mapDataFor(scene, mapPhase);
  const card = phaseCard(scene, phase);
  const profile = walkProfile(scene, phase);
  const share = span === 0 ? 0 : elapsed / span;
  // Napisy idą za głosem; w ciszy przed lektorem ich nie ma.
  const line = elapsed < lead ? undefined : (lines.find((each) => (duration === 0 ? 0 : narrated / duration) <= each.until) ?? lines.at(-1));

  return (
    <div className="flex flex-col gap-3">
      <div ref={stage} className="relative aspect-[4/5] w-full sm:aspect-video overflow-hidden rounded-xl bg-black text-white [&:fullscreen]:rounded-none">
        <ShowMap data={mapData} sceneKey={scene.key} focus={focus} />

        {profile && (
          // Profil wysokości trasy pieszej (ślad GPX z wysokościami), w lewym górnym rogu w ujęciu tej trasy.
          <div className="pointer-events-none absolute top-3 left-3 z-[15] flex w-[45%] flex-col gap-1 rounded-lg bg-black/60 px-3 py-2 text-[10px] backdrop-blur-sm sm:w-[36%] sm:text-xs">
            <p className="tracking-wider text-white/70 uppercase">Profil trasy</p>
            <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-14 w-full sm:h-20" aria-hidden="true">
              <path d={`M0,40 ${profile.points.map(([x, y]) => `L${(x * 100).toFixed(1)},${(38 - y * 34).toFixed(1)}`).join(" ")} L100,40 Z`} fill="rgba(255,255,255,0.25)" />
              <path d={profile.points.map(([x, y], at) => `${at === 0 ? "M" : "L"}${(x * 100).toFixed(1)},${(38 - y * 34).toFixed(1)}`).join(" ")} fill="none" stroke="#f97316" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
            </svg>
            <p className="flex justify-between text-white/85">
              <span>
                {profile.low}–{profile.high} m n.p.m.
              </span>
              <span>{profile.km.toLocaleString("pl-PL", { maximumFractionDigits: 1 })} km</span>
            </p>
          </div>
        )}

        {card && (
          <div className="pointer-events-none absolute top-3 right-3 z-[15] flex max-w-[55%] flex-col gap-1 rounded-lg bg-black/60 px-3 py-2 text-xs backdrop-blur-sm sm:max-w-[40%] sm:text-sm">
            <p className="text-[10px] tracking-wider text-white/70 uppercase sm:text-xs">{card.label}</p>
            {card.title && <p className="font-semibold">{card.title}</p>}
            {card.lines.map((line) => (
              <p key={line} className="text-white/85">
                {line}
              </p>
            ))}
            {card.bullets.length > 0 && (
              <ul className="flex flex-col gap-0.5 text-white/90">
                {card.bullets.map((point) => (
                  <li key={point}>• {point}</li>
                ))}
              </ul>
            )}
          </div>
        )}

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

        {scene.mapless && (
          // Wstęp filmu bez mapy: plansza z tytułem, terminem i liczbami wyjazdu.
          <div className={`pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-[#1b2a3a] px-8 text-center transition-opacity duration-1000 ${phase.kind === "text" && phase.index === 0 ? "opacity-100" : "opacity-0"}`}>
            <div className="topo absolute inset-0 opacity-60" />
            <p className="relative text-3xl font-bold sm:text-5xl">{scene.heading}</p>
            {scene.subheading && <p className="relative text-base text-white/85 sm:text-xl">{scene.subheading}</p>}
            {scene.stats.length > 0 && <p className="relative text-sm text-white/75 sm:text-lg">{scene.stats.join(" · ")}</p>}
          </div>
        )}

        {scene.plan && (
          // Plansza „Kto jedzie i plan” na końcu wstępu: imiona i dni w skrócie.
          <div className={`pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-[#1b2a3a] px-8 text-center transition-opacity duration-1000 ${phase.kind === "text" && phase.index === 1 ? "opacity-100" : "opacity-0"}`}>
            <div className="topo absolute inset-0 opacity-60" />
            {scene.plan.people.length > 0 && (
              <>
                <p className="relative text-xs tracking-widest text-white/70 uppercase sm:text-sm">Kto jedzie</p>
                <p className="relative max-w-4xl text-lg sm:text-2xl">{scene.plan.people.join(", ")}</p>
              </>
            )}
            <p className="relative mt-3 text-xs tracking-widest text-white/70 uppercase sm:text-sm">Plan</p>
            <ul className="relative flex max-w-4xl flex-wrap justify-center gap-x-5 gap-y-1 text-sm text-white/90 sm:text-lg">
              {scene.plan.days.map((day) => (
                <li key={day}>{day}</li>
              ))}
            </ul>
          </div>
        )}

        {[0, 1].map((which) => {
          const collage = collageAt(scene, which);
          if (!collage || collage.length === 0) return null;
          const on = phase.kind === "collage" && phase.index === which;
          return (
            // Kolaż: wszystkie zdjęcia naraz, siatka 2–3 kolumny, całość powoli się przybliża.
            <div key={which} className={`pointer-events-none absolute inset-0 z-10 bg-black p-1 transition-opacity duration-1000 ${on ? "opacity-100" : "opacity-0"}`}>
              <div className={`grid size-full gap-1 ${on ? "show-kenburns" : ""} ${collageColumns(collage.length)}`} style={{ gridAutoRows: "1fr", animationDuration: `${perPhoto + 1_000}ms` }}>
                {collage.map((image) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={image.url} src={image.url} alt={image.caption} className="size-full min-h-0 object-cover" />
                ))}
              </div>
            </div>
          );
        })}

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
        <button onClick={() => setSubtitles((value) => !value)} className="btn-secondary btn-sm">{subtitles ? "Ukryj napisy" : "Pokaż napisy"}</button>
        <button onClick={fullscreen} className="btn-secondary btn-sm">Pełny ekran</button>
        {exportable && (
          <button
            onClick={() => {
              setPlaying(false);
              setExporting(true);
            }}
            disabled={exporting}
            className="btn-secondary btn-sm"
            title="Nagranie filmu do pliku w tej przeglądarce"
          >
            Eksport do MP4
          </button>
        )}
      </div>

      {exporting && <ShowExport scenes={scenes} trip={trip} subtitles={subtitles} {...(music ? { music } : {})} onClose={() => setExporting(false)} />}

      <div className="flex flex-wrap gap-1">
        {story.map((each, at) => (
          <button key={each.key} onClick={() => go(at + 1)} className={`btn-mini ${at + 1 === index ? "ring-2 ring-sea" : ""}`} title={`${each.heading}${each.audio ? " · z lektorem" : ""}`}>
            {each.kind === "intro" ? "Start" : each.kind === "about" ? "Dokąd" : each.kind === "outro" ? "Koniec" : each.heading.split(" · ")[0]}
            {each.audio ? <SpeakerIcon className="size-3.5 msg-ok" /> : each.text.trim() !== "" ? " ✎" : ""}
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
                  {image.own ? ` — fot. ${image.author || "własne"}` : (
                    <>
                      {image.author ? ` — ${image.author}` : ""}
                      {image.license ? `, ${image.license}` : ""} (Wikimedia Commons)
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </details>
      )}
    </div>
  );
}
