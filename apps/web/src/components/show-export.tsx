"use client";

import type { ShowImage } from "@expeditionplan/core";
import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  collageAt,
  collageGrid,
  isCard,
  mapDataFor,
  type MapFocus,
  mapFocus,
  MUSIC_EASE,
  musicLevel,
  musicStart,
  phaseAt,
  phaseCard,
  walkProfile,
  type PlayerMusic,
  type PlayerScene,
  scenePhases,
  sceneTiming,
  sentences,
  ShowMap,
  type ShowMapData,
} from "@/components/show-player";

/**
 * Eksport pokazu do pliku wideo w przeglądarce: ten sam film co w odtwarzaczu (te same czasy scen, `sceneTiming`,
 * `scenePhases` z kartami planu i tras pieszych, napisy i podkład), rysowany klatka po klatce na kanwie 1920×1080 i nagrywany przez `MediaRecorder`
 * z dźwiękiem zmiksowanym w Web Audio (lektor + podkład). Mapa to osobna, niewidoczna MapLibre w tym rozmiarze
 * (`ShowMap capture`), kopiowana na kanwę. Nagranie idzie w czasie rzeczywistym, więc trwa tyle co film. Klatki
 * odmierza Web Worker (jego zegar nie zwalnia w zasłoniętym oknie jak `requestAnimationFrame`), ale schowana karta
 * zatrzymuje mapę, więc wtedy eksport staje. MP4 tam, gdzie przeglądarka go nagrywa (Chrome, Edge), inaczej WebM.
 * Nic nie trafia na serwer: plik zostaje w przeglądarce do pobrania.
 */

const W = 1920;
const H = 1080;
const FPS = 30;
const CARD_FADE_MS = 700;
const PHOTO_FADE_MS = 1_000;
const TYPES = ["video/mp4;codecs=avc1.640028,mp4a.40.2", "video/mp4;codecs=avc1,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm"];

/** Format nagrania obsługiwany przez tę przeglądarkę (MP4 najpierw) albo `null`. */
const recordingType = () => (typeof MediaRecorder === "undefined" ? null : (TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? null));

type Status =
  | { phase: "prepare"; note: string }
  | { phase: "record"; at: number; total: number }
  | { phase: "done"; url: string; name: string; bytes: number; mp4: boolean }
  | { phase: "error"; message: string };

async function loadImage(url: string): Promise<HTMLImageElement | null> {
  const image = new Image();
  // Bez CORS kanwa byłaby „brudna” i nagranie by się nie udało: takie zdjęcie pomijamy.
  image.crossOrigin = "anonymous";
  image.src = url;
  try {
    await image.decode();
    return image;
  } catch {
    return null;
  }
}

async function loadAudio(context: AudioContext, url: string): Promise<AudioBuffer | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return await context.decodeAudioData(await response.arrayBuffer());
  } catch {
    return null;
  }
}

/** Tekst pocięty na wiersze nie szersze niż `width`. */
function wrap(context: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter((each) => each !== "")) {
    const next = line === "" ? word : `${line} ${word}`;
    if (line !== "" && context.measureText(next).width > width) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line !== "") lines.push(line);
  return lines;
}

const mmss = (ms: number) => {
  const seconds = Math.max(Math.round(ms / 1000), 0);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

/** Początki scen na osi filmu i długość całości. */
function showTimeline(scenes: PlayerScene[]) {
  const entries: ({ start: number } & ReturnType<typeof sceneTiming>)[] = [];
  let at = 0;
  for (const index of scenes.keys()) {
    const timing = sceneTiming(scenes, index);
    entries.push({ start: at, ...timing });
    at += timing.lead + timing.duration + timing.gap;
  }
  return { entries, total: at };
}

const fileName = (title: string, ext: string) => `${title.replace(/[\\/:*?"<>|]+/g, " ").trim() || "pokaz"} - pokaz.${ext}`;

export function ShowExport({
  scenes,
  trip,
  music,
  subtitles,
  onClose,
}: {
  scenes: PlayerScene[];
  trip: { title: string; dates: string; label: string };
  music?: PlayerMusic;
  subtitles: boolean;
  onClose: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const mapReady = useRef<(() => void) | null>(null);
  const stop = useRef<(() => void) | null>(null);
  const [mapView, setMapView] = useState<{ scene: number; data: ShowMapData; focus: MapFocus }>({ scene: 0, data: scenes[0]!.map, focus: null });
  const [status, setStatus] = useState<Status | null>(null);
  const type = useMemo(() => recordingType(), []);

  const timeline = useMemo(() => showTimeline(scenes), [scenes]);
  const sceneAt = (ms: number) => {
    let index = 0;
    while (index + 1 < timeline.entries.length && timeline.entries[index + 1]!.start <= ms) index += 1;
    return index;
  };

  // Plik wideo trzyma przeglądarka: zwolnić przy zamknięciu.
  const url = status?.phase === "done" ? status.url : null;
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  useEffect(() => () => stop.current?.(), []);

  const start = async () => {
    if (type === null) return;
    map.current = null;
    // Kontekst dźwięku z kliknięcia: inaczej przeglądarka go nie uruchomi.
    const audio = new AudioContext();
    void audio.resume();
    let cancelled = false;
    let ticker: Worker | null = null;
    let clock: string | null = null;
    let recorder: MediaRecorder | null = null;
    const hidden = () => {
      if (document.hidden && recorder?.state === "recording") abort("Karta przeglądarki była schowana, więc obraz stanął. Zacznij eksport od nowa i zostaw tę kartę na wierzchu.");
    };
    const cleanup = () => {
      cancelled = true;
      ticker?.terminate();
      if (clock) URL.revokeObjectURL(clock);
      document.removeEventListener("visibilitychange", hidden);
      void audio.close().catch(() => undefined);
    };
    const abort = (message: string | null) => {
      cleanup();
      if (recorder && recorder.state !== "inactive") {
        recorder.onstop = null;
        recorder.stop();
      }
      setStatus(message === null ? null : { phase: "error", message });
    };
    stop.current = () => abort(null);
    document.addEventListener("visibilitychange", hidden);

    setMapView({ scene: 0, data: scenes[0]!.map, focus: null });
    setStatus({ phase: "prepare", note: "Wczytuję zdjęcia i nagrania…" });
    const urls = [...new Set(scenes.flatMap((scene) => [...scene.images, ...(scene.collage ?? []), ...(scene.guideCollage ?? [])].map((image) => image.url)))];
    const [images, voices, backing] = await Promise.all([
      Promise.all(urls.map(async (each) => [each, await loadImage(each)] as const)).then((pairs) => new Map(pairs)),
      Promise.all(scenes.flatMap((scene) => (scene.audio ? [scene.audio.url] : [])).map(async (each) => [each, await loadAudio(audio, each)] as const)).then((pairs) => new Map(pairs)),
      music ? loadAudio(audio, music.url) : Promise.resolve(null),
    ]);
    if (cancelled) return;
    const missing = [...voices.values()].filter((each) => each === null).length;
    if (missing > 0) return abort(`Nie wczytało się ${missing} nagrań lektora. Odśwież stronę (adresy nagrań wygasają po godzinie) i spróbuj jeszcze raz.`);

    setStatus({ phase: "prepare", note: "Czekam na mapę…" });
    if (map.current === null) await new Promise<void>((resolve) => (mapReady.current = resolve));
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 15_000);
      map.current!.once("idle", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    if (cancelled) return;

    const target = canvas.current!;
    const context = target.getContext("2d")!;
    const font = getComputedStyle(document.body).fontFamily;
    const lines = new Map(scenes.map((scene) => [scene.key, sentences(scene.text)]));
    const destination = audio.createMediaStreamDestination();
    const t0 = audio.currentTime + 0.3;
    const { entries, total } = timeline;

    // Cisza przez cały film: bez żadnego źródła ścieżka dźwięku nie daje próbek, a MP4 bez nich urywa obraz po kilku
    // sekundach (pokaz bez lektora i podkładu).
    const silence = audio.createConstantSource();
    silence.offset.value = 0;
    silence.connect(destination);
    silence.start(audio.currentTime);
    silence.stop(t0 + total / 1000 + 0.5);
    // Lektor scena po scenie, w tych samych chwilach co w odtwarzaczu.
    for (const [index, scene] of scenes.entries()) {
      const buffer = scene.audio ? voices.get(scene.audio.url) : null;
      if (!buffer) continue;
      const source = audio.createBufferSource();
      source.buffer = buffer;
      source.connect(destination);
      source.start(t0 + (entries[index]!.start + entries[index]!.lead) / 1000);
    }
    // Podkład: ta sama głośność co w odtwarzaczu, krok po kroku (100 ms, `musicLevel` + `MUSIC_EASE`).
    if (music && backing) {
      const gain = audio.createGain();
      let level = 0;
      for (let ms = 0; ms <= total; ms += 100) {
        const index = sceneAt(ms);
        const entry = entries[index]!;
        const scene = scenes[index]!;
        const span = entry.lead + entry.duration;
        const inScene = Math.min(ms - entry.start, span);
        level += (musicLevel(scene, music.volume, inScene, scene.audio !== undefined && ms - entry.start < span) - level) * MUSIC_EASE;
        gain.gain.setValueAtTime(level, t0 + ms / 1000);
      }
      const source = audio.createBufferSource();
      source.buffer = backing;
      // Pętla od pominiętego początku, jak w odtwarzaczu.
      const offset = musicStart(music, backing.duration);
      source.loop = true;
      source.loopStart = offset;
      source.loopEnd = backing.duration;
      source.connect(gain).connect(destination);
      source.start(t0, offset);
      source.stop(t0 + total / 1000 + 0.3);
    }

    const drawPhoto = (image: ShowImage, since: number, perPhoto: number, alpha: number) => {
      const picture = images.get(image.url);
      if (!picture || alpha <= 0) return;
      // Powolne zbliżenie jak `.show-kenburns`: scale(1 → 1,12), translate(0 → −2%, −1%).
      const k = Math.min(Math.max(since / (perPhoto + 1_000), 0), 1);
      const ratio = Math.max(W / picture.naturalWidth, H / picture.naturalHeight);
      const [w, h] = [picture.naturalWidth * ratio, picture.naturalHeight * ratio];
      context.save();
      context.globalAlpha = alpha;
      context.translate(W / 2, H / 2);
      context.scale(1 + 0.12 * k, 1 + 0.12 * k);
      context.translate(-W / 2 - 0.02 * W * k, -H / 2 - 0.01 * H * k);
      context.drawImage(picture, (W - w) / 2, (H - h) / 2, w, h);
      context.restore();
      if (!image.caption && !image.credit) return;
      context.save();
      context.globalAlpha = alpha;
      context.textAlign = "right";
      context.textBaseline = "top";
      const credit = image.credit ? `fot. ${image.credit}` : "";
      context.font = `26px ${font}`;
      const captionWidth = context.measureText(image.caption).width;
      context.font = `19px ${font}`;
      const width = Math.min(Math.max(captionWidth, context.measureText(credit).width) + 24, W * 0.6);
      const boxH = (image.caption ? 36 : 0) + (credit ? 28 : 0) + 12;
      context.fillStyle = "rgba(0,0,0,0.5)";
      context.beginPath();
      context.roundRect(W - 28 - width, 28, width, boxH, 6);
      context.fill();
      context.fillStyle = "#ffffff";
      context.font = `26px ${font}`;
      if (image.caption) context.fillText(image.caption, W - 40, 36, width - 24);
      context.fillStyle = "rgba(255,255,255,0.7)";
      context.font = `19px ${font}`;
      if (credit) context.fillText(credit, W - 40, image.caption ? 72 : 36, width - 24);
      context.restore();
    };

    // Kolaż jak w odtwarzaczu: siatka zdjęć na czarnym tle, całość powoli się przybliża.
    const drawCollage = (collage: ShowImage[], since: number, ms: number, alpha: number) => {
      if (alpha <= 0) return;
      const { columns } = collageGrid(collage.length);
      const rows = Math.ceil(collage.length / columns);
      const gap = 8;
      const [cellW, cellH] = [(W - gap * (columns + 1)) / columns, (H - gap * (rows + 1)) / rows];
      const k = Math.min(Math.max(since / (ms + 1_000), 0), 1);
      context.save();
      context.globalAlpha = alpha;
      context.fillStyle = "#000000";
      context.fillRect(0, 0, W, H);
      context.translate(W / 2, H / 2);
      context.scale(1 + 0.12 * k, 1 + 0.12 * k);
      context.translate(-W / 2 - 0.02 * W * k, -H / 2 - 0.01 * H * k);
      for (const [at, image] of collage.entries()) {
        const picture = images.get(image.url);
        if (!picture) continue;
        const [x, y] = [gap + (at % columns) * (cellW + gap), gap + Math.floor(at / columns) * (cellH + gap)];
        const ratio = Math.max(cellW / picture.naturalWidth, cellH / picture.naturalHeight);
        const [w, h] = [picture.naturalWidth * ratio, picture.naturalHeight * ratio];
        context.save();
        context.beginPath();
        context.rect(x, y, cellW, cellH);
        context.clip();
        context.drawImage(picture, x + (cellW - w) / 2, y + (cellH - h) / 2, w, h);
        context.restore();
      }
      context.restore();
    };

    // Plansza wstępu filmu bez mapy, jak w odtwarzaczu: tytuł, termin i liczby na ciemnym tle.
    const drawText = (scene: PlayerScene) => {
      context.save();
      context.fillStyle = "#1b2a3a";
      context.fillRect(0, 0, W, H);
      context.textAlign = "center";
      context.textBaseline = "middle";
      const rows: [string, string, string][] = [
        [scene.heading, `bold 96px ${font}`, "#ffffff"],
        ...(scene.subheading ? [[scene.subheading, `44px ${font}`, "rgba(255,255,255,0.85)"] as [string, string, string]] : []),
        ...(scene.stats.length > 0 ? [[scene.stats.join(" · "), `36px ${font}`, "rgba(255,255,255,0.75)"] as [string, string, string]] : []),
      ];
      const laid = rows.map(([text, style, color]) => {
        context.font = style;
        return { lines: wrap(context, text, W - 240), style, color, size: Number(/(\d+)px/.exec(style)![1]) };
      });
      const height = laid.reduce((sum, row) => sum + row.lines.length * row.size * 1.25, 0) + (laid.length - 1) * 20;
      let y = (H - height) / 2;
      for (const row of laid) {
        context.font = row.style;
        context.fillStyle = row.color;
        for (const line of row.lines) {
          context.fillText(line, W / 2, y + (row.size * 1.25) / 2);
          y += row.size * 1.25;
        }
        y += 20;
      }
      context.restore();
    };

    const drawCard = (scene: PlayerScene, alpha: number) => {
      if (alpha <= 0) return;
      context.save();
      context.globalAlpha = alpha;
      context.fillStyle = "#1b2a3a";
      context.fillRect(0, 0, W, H);
      context.textAlign = "center";
      context.textBaseline = "middle";
      const rows: [string, string, string][] =
        scene.kind === "end"
          ? [
              ["Koniec", `bold 120px ${font}`, "#ffffff"],
              [trip.title, `48px ${font}`, "rgba(255,255,255,0.85)"],
              [trip.dates, `34px ${font}`, "rgba(255,255,255,0.7)"],
              [`Mapy © OpenStreetMap · głos lektora: Gemini TTS${music ? ` · muzyka: ${music.name.replace(/\.[a-z0-9]+$/i, "")}` : ""} · Expedition Planner`, `22px ${font}`, "rgba(255,255,255,0.5)"],
            ]
          : [
              [trip.label.toUpperCase(), `30px ${font}`, "rgba(255,255,255,0.7)"],
              [trip.title, `bold 120px ${font}`, "#ffffff"],
              [trip.dates, `48px ${font}`, "rgba(255,255,255,0.85)"],
            ];
      const laid = rows.map(([text, style, color]) => {
        context.font = style;
        const size = Number(/(\d+)px/.exec(style)![1]);
        return { lines: wrap(context, text, W - 240), style, color, size };
      });
      const height = laid.reduce((sum, row) => sum + row.lines.length * row.size * 1.25, 0) + (laid.length - 1) * 20;
      let y = (H - height) / 2;
      for (const row of laid) {
        context.font = row.style;
        context.fillStyle = row.color;
        for (const line of row.lines) {
          context.fillText(line, W / 2, y + (row.size * 1.25) / 2);
          y += row.size * 1.25;
        }
        y += 20;
      }
      context.restore();
    };

    let shownMap = "0:map:0";
    const phasesOf = new Map(scenes.map((scene, index) => [scene.key, scenePhases(scene, entries[index]!.lead + entries[index]!.duration)]));
    const draw = (ms: number) => {
      const index = sceneAt(Math.max(ms, 0));
      const scene = scenes[index]!;
      const entry = entries[index]!;
      const inScene = Math.max(ms - entry.start, 0);
      const span = entry.lead + entry.duration;
      const elapsed = Math.min(inScene, span);
      const phases = phasesOf.get(scene.key)!;
      const { phase, mapPhase } = phaseAt(phases, elapsed);
      const viewKey = `${index}:${mapPhase.kind}:${mapPhase.index}`;
      if (viewKey !== shownMap) {
        shownMap = viewKey;
        setMapView({ scene: index, data: mapDataFor(scene, mapPhase), focus: mapFocus(scene, mapPhase) });
      }

      context.fillStyle = "#e4e4e7";
      context.fillRect(0, 0, W, H);
      const mapCanvas = map.current?.getCanvas();
      if (mapCanvas) context.drawImage(mapCanvas, 0, 0, W, H);
      context.save();
      context.font = `18px ${font}`;
      context.textBaseline = "top";
      const credit = "© OpenStreetMap · OpenFreeMap · Trasy: openrouteservice.org";
      context.fillStyle = "rgba(255,255,255,0.75)";
      context.fillRect(12, 12, context.measureText(credit).width + 16, 30);
      context.fillStyle = "#333333";
      context.fillText(credit, 20, 18);
      context.restore();

      if (phase.kind === "text") drawText(scene);
      const collage = phase.kind === "collage" ? collageAt(scene, phase.index) : undefined;
      if (collage) {
        // Kolaż wyłania się z planszy albo z poprzedniego kolażu (wstęp filmu bez mapy).
        const since = elapsed - phase.start;
        const fade = Math.min(since / PHOTO_FADE_MS, 1);
        if (fade < 1 && scene.mapless) {
          const before = phases[phases.indexOf(phase) - 1];
          const previous = before?.kind === "collage" ? collageAt(scene, before.index) : undefined;
          if (previous) drawCollage(previous, since + (before!.end - before!.start), before!.end - before!.start, 1);
          else if (before?.kind === "text") drawText(scene);
        }
        drawCollage(collage, since, phase.end - phase.start, fade);
      }
      if (phase.kind === "photo") {
        const perPhoto = phase.end - phase.start;
        const since = elapsed - phase.start;
        const fade = Math.min(since / PHOTO_FADE_MS, 1);
        if (phase.index > 0 && fade < 1) drawPhoto(scene.images[phase.index - 1]!, since + perPhoto, perPhoto, 1);
        else if (phase.index === 0 && fade < 1) {
          const before = phases[phases.indexOf(phase) - 1];
          const previous = before?.kind === "collage" ? collageAt(scene, before.index) : undefined;
          if (previous) drawCollage(previous, since + perPhoto, perPhoto, 1);
        }
        drawPhoto(scene.images[phase.index]!, since, perPhoto, fade);
      }
      // Profil wysokości trasy pieszej, jak w odtwarzaczu (lewy górny róg, pod podpisem map).
      const profile = walkProfile(scene, phase);
      if (profile) {
        const [x, y, w, h] = [28, 56, W * 0.36, 220];
        const [gx, gy, gw, gh] = [x + 20, y + 44, w - 40, h - 100];
        context.save();
        context.fillStyle = "rgba(0,0,0,0.6)";
        context.beginPath();
        context.roundRect(x, y, w, h, 10);
        context.fill();
        context.textBaseline = "top";
        context.font = `20px ${font}`;
        context.fillStyle = "rgba(255,255,255,0.7)";
        context.fillText("PROFIL TRASY", x + 20, y + 14);
        const at = ([px, py]: [number, number]): [number, number] => [gx + px * gw, gy + gh - py * gh];
        context.beginPath();
        context.moveTo(gx, gy + gh);
        for (const point of profile.points) context.lineTo(...at(point));
        context.lineTo(gx + gw, gy + gh);
        context.closePath();
        context.fillStyle = "rgba(255,255,255,0.25)";
        context.fill();
        context.beginPath();
        for (const [index, point] of profile.points.entries()) (index === 0 ? context.moveTo : context.lineTo).call(context, ...at(point));
        context.strokeStyle = "#f97316";
        context.lineWidth = 3;
        context.stroke();
        context.font = `22px ${font}`;
        context.fillStyle = "rgba(255,255,255,0.85)";
        context.fillText(`${profile.low}–${profile.high} m n.p.m.`, x + 20, gy + gh + 14);
        context.textAlign = "right";
        context.fillText(`${profile.km.toLocaleString("pl-PL", { maximumFractionDigits: 1 })} km`, x + w - 20, gy + gh + 14);
        context.restore();
      }

      // Karta etapu, jak w odtwarzaczu (prawy górny róg, `phaseCard`).
      const card = phaseCard(scene, phase);
      if (card) {
        const rows: [string, string, string][] = [
          [card.label.toUpperCase(), `20px ${font}`, "rgba(255,255,255,0.7)"],
          ...(card.title ? [[card.title, `600 30px ${font}`, "#ffffff"] as [string, string, string]] : []),
          ...card.lines.map((line): [string, string, string] => [line, `28px ${font}`, "rgba(255,255,255,0.85)"]),
          ...card.bullets.map((point): [string, string, string] => [`• ${point}`, `26px ${font}`, "rgba(255,255,255,0.9)"]),
        ];
        const maxWidth = W * 0.4;
        const laid = rows.flatMap(([text, style, color]) => {
          context.font = style;
          return wrap(context, text, maxWidth).map((line) => ({ line, style, color, size: Number(/(\d+)px/.exec(style)![1]) }));
        });
        const width = Math.min(Math.max(...laid.map((row) => ((context.font = row.style), context.measureText(row.line).width))) + 40, maxWidth + 40);
        const height = laid.reduce((sum, row) => sum + row.size * 1.35, 0) + 28;
        context.save();
        context.fillStyle = "rgba(0,0,0,0.6)";
        context.beginPath();
        context.roundRect(W - 28 - width, 28, width, height, 10);
        context.fill();
        context.textBaseline = "top";
        let y = 42;
        for (const row of laid) {
          context.font = row.style;
          context.fillStyle = row.color;
          context.fillText(row.line, W - 28 - width + 20, y);
          y += row.size * 1.35;
        }
        context.restore();
      }

      // Dół kadru: nagłówek sceny i napisy na ciemnym przejściu.
      const gradient = context.createLinearGradient(0, H * 0.5, 0, H);
      gradient.addColorStop(0, "rgba(0,0,0,0)");
      gradient.addColorStop(0.5, "rgba(0,0,0,0.4)");
      gradient.addColorStop(1, "rgba(0,0,0,0.8)");
      context.fillStyle = gradient;
      context.fillRect(0, H * 0.5, W, H * 0.5);
      const said = lines.get(scene.key) ?? [];
      const line = !subtitles || inScene < entry.lead ? undefined : (said.find((each) => (entry.duration === 0 ? 0 : (inScene - entry.lead) / entry.duration) <= each.until) ?? said.at(-1));
      context.save();
      context.textAlign = "left";
      context.textBaseline = "alphabetic";
      context.shadowColor = "rgba(0,0,0,0.6)";
      context.shadowBlur = 6;
      let y = H - 56;
      if (line) {
        context.font = `38px ${font}`;
        const rows = wrap(context, line.text, 1500);
        context.fillStyle = "#ffffff";
        for (const [at, row] of rows.entries()) context.fillText(row, 72, y - (rows.length - 1 - at) * 48);
        y -= rows.length * 48 + 16;
      }
      if (scene.subheading) {
        context.font = `32px ${font}`;
        context.fillStyle = "rgba(255,255,255,0.8)";
        context.fillText(scene.subheading, 72, y, W - 144);
        y -= 46;
      }
      context.font = `600 54px ${font}`;
      context.fillStyle = "#ffffff";
      context.fillText(scene.heading, 72, y, W - 144);
      context.restore();

      // Ekrany startowy i końcowy jak w odtwarzaczu: końcowy się wyłania, startowy znika na początku pierwszej sceny.
      if (isCard(scene)) drawCard(scene, scene.kind === "end" ? Math.min(inScene / CARD_FADE_MS, 1) : 1);
      else if (index > 0 && isCard(scenes[index - 1]!) && inScene < CARD_FADE_MS) drawCard(scenes[index - 1]!, 1 - inScene / CARD_FADE_MS);
    };

    const stream = new MediaStream([...target.captureStream(FPS).getVideoTracks(), ...destination.stream.getAudioTracks()]);
    recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 6_000_000, audioBitsPerSecond: 192_000 });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      cleanup();
      const mp4 = type.startsWith("video/mp4");
      const blob = new Blob(chunks, { type: mp4 ? "video/mp4" : "video/webm" });
      setStatus({ phase: "done", url: URL.createObjectURL(blob), name: fileName(trip.title, mp4 ? "mp4" : "webm"), bytes: blob.size, mp4 });
    };
    recorder.start(1_000);
    setStatus({ phase: "record", at: 0, total });
    let shown = -1;
    const tick = () => {
      if (cancelled) return;
      const ms = (audio.currentTime - t0) * 1000;
      draw(Math.min(ms, total));
      const second = Math.floor(ms / 1000);
      if (second !== shown) {
        shown = second;
        setStatus({ phase: "record", at: Math.max(ms, 0), total });
      }
      if (ms >= total + 300) {
        ticker?.terminate();
        if (recorder?.state === "recording") recorder.stop();
      }
    };
    clock = URL.createObjectURL(new Blob([`setInterval(() => postMessage(0), ${Math.round(1000 / FPS)});`], { type: "text/javascript" }));
    ticker = new Worker(clock);
    ticker.onmessage = tick;
  };

  const busy = status?.phase === "prepare" || status?.phase === "record";
  const ext = type?.startsWith("video/mp4") ? "MP4" : "WebM";

  return (
    <section className="card flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="card-title">Eksport filmu</h2>
        <span className="text-xs text-zinc-500">1920×1080, {mmss(timeline.total)}</span>
      </div>
      {type === null ? (
        <p className="text-sm msg-error">Ta przeglądarka nie nagrywa wideo. Otwórz pokaz w Chrome albo Edge.</p>
      ) : (
        <>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Film nagrywa się w tej przeglądarce w czasie rzeczywistym, więc eksport trwa tyle, co pokaz ({mmss(timeline.total)}). Przez ten czas zostaw tę kartę na wierzchu; dźwięku nie słychać, idzie prosto do pliku.
            {ext === "WebM" && " Ta przeglądarka nie zapisuje MP4: plik będzie w formacie WebM (MP4 nagrywa Chrome i Edge)."}
          </p>
          <canvas ref={canvas} width={W} height={H} className={`w-full max-w-xl rounded-lg bg-black ${busy || status?.phase === "done" ? "" : "hidden"}`} />
          {status?.phase === "prepare" && <p className="text-sm">{status.note}</p>}
          {status?.phase === "record" && (
            <div className="flex flex-col gap-1 text-sm">
              <span>
                Nagrywam {mmss(status.at)} z {mmss(status.total)}…
              </span>
              <div className="h-1.5 w-full max-w-xl rounded bg-zinc-200 dark:bg-zinc-800">
                <div className="h-full rounded bg-sea" style={{ width: `${Math.min((status.at / status.total) * 100, 100)}%` }} />
              </div>
            </div>
          )}
          {status?.phase === "error" && <p className="text-sm msg-error">{status.message}</p>}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {status?.phase === "done" && (
              <a href={status.url} download={status.name} className="btn-secondary btn-sm">
                Pobierz {status.mp4 ? "MP4" : "WebM"} ({Math.max(Math.round(status.bytes / 1024 / 1024), 1)} MB)
              </a>
            )}
            {!busy && (
              <button onClick={() => void start()} className="btn-secondary btn-sm">
                {status?.phase === "done" || status?.phase === "error" ? "Nagraj jeszcze raz" : `Nagraj film (${ext})`}
              </button>
            )}
            {busy && (
              <button onClick={() => stop.current?.()} className="btn-mini btn-mini-danger">
                przerwij
              </button>
            )}
            {!busy && (
              <button onClick={onClose} className="btn-secondary btn-sm">
                Zamknij
              </button>
            )}
          </div>
        </>
      )}
      {busy && (
        // Niewidoczna mapa w rozmiarze filmu: z niej kopiuje się kadr mapy.
        <div aria-hidden className="pointer-events-none fixed top-0" style={{ left: -W - 100, width: W, height: H }}>
          <ShowMap
            data={mapView.data}
            sceneKey={scenes[mapView.scene]!.key}
            focus={mapView.focus}
            capture
            onMap={(created) => {
              map.current = created;
              mapReady.current?.();
            }}
          />
        </div>
      )}
    </section>
  );
}
