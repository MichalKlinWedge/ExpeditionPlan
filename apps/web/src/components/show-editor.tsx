"use client";

import { MUSIC_MAX_BYTES, plural, type ShowKind, showMusicFile } from "@expeditionplan/core";
import { dbErrorMessage } from "@expeditionplan/sync";
import { useRouter } from "next/navigation";
import { type ChangeEvent, useRef, useState, useTransition } from "react";

import type { FormState } from "@/app/actions";
import { draftShow, recordShowScene, saveShowText, setShowMusic, setShowMusicSettings, setShowVoice, voiceSample } from "@/app/show-actions";
import { IconAction } from "@/components/icon-action";
import { MicIcon, PencilIcon, SpeakerIcon } from "@/components/icons";
import { PlanActionButton } from "@/components/plan-action-button";
import { createClient } from "@/lib/supabase/client";

/**
 * Edycja pokazu (organizator i edytor w trybie edycji): szkic tekstu z AI, poprawki scen, głos lektora i nagrywanie.
 * Nagrywanie idzie scena po scenie (osobne wywołania akcji), z postępem; błąd zatrzymuje kolejkę, gotowe nagrania zostają.
 */

/** Ile razy czekać na limit zapytań przy jednej scenie, zanim kolejka stanie. */
const MAX_WAITS = 4;

/** Stan nagrania sceny: bez tekstu, tekst bez nagrania, nagranie starszego tekstu albo głosu, nagranie aktualne. */
export type RecordingStatus = "none" | "new" | "old" | "ready";

export type EditorScene = { key: string; heading: string; subheading?: string; text: string; edited: boolean; status: RecordingStatus; seconds?: number };

/** Na żywo w trakcie nagrywania, zanim strona się odświeży: ta scena się nagrywa albo właśnie się nagrała. */
type Live = "recording" | { seconds: number };

const BADGE = "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium";

/** Znaczek stanu nagrania przy scenie; zmieniony, niezapisany tekst unieważnia nagranie już w polu. */
function RecordingBadge({ status, seconds, live, unsaved }: { status: RecordingStatus; seconds?: number; live?: Live; unsaved: boolean }) {
  if (live === "recording") {
    return (
      <span className={`${BADGE} animate-pulse bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200`}>
        <MicIcon className="size-3.5" /> nagrywam…
      </span>
    );
  }
  if (unsaved) {
    return <span className={`${BADGE} bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200`}>✎ tekst zmieniony: zapisz{status === "ready" || status === "old" ? " i nagraj od nowa" : ""}</span>;
  }
  const done = live !== undefined ? live.seconds : status === "ready" ? seconds : undefined;
  if (done !== undefined) {
    return (
      <span className={`${BADGE} bg-green-100 text-green-900 dark:bg-green-900/40 dark:text-green-200`} title="Nagranie pasuje do tego tekstu i głosu">
        <SpeakerIcon className="size-3.5" /> ✓ nagrane · {done} s
      </span>
    );
  }
  if (status === "old") {
    return (
      <span className={`${BADGE} bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200`} title="Nagranie jest ze starszego tekstu albo innego głosu i nie gra w pokazie">
        <SpeakerIcon className="size-3.5" /> nagranie nieaktualne
      </span>
    );
  }
  if (status === "new") return <span className={`${BADGE} bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300`}>nienagrane</span>;
  return <span className={`${BADGE} bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400`}>bez tekstu</span>;
}

/** Odsłuchanie próbki wybranego głosu; nagrana raz, potem z pliku (`voiceSample`). */
function VoiceSample({ tripId, voice }: { tripId: string; voice: string }) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [state, setState] = useState<"idle" | "loading" | "playing">("idle");
  const [error, setError] = useState<string | null>(null);
  const player = useRef<HTMLAudioElement | null>(null);
  const play = async () => {
    if (state === "playing") {
      player.current?.pause();
      setState("idle");
      return;
    }
    setError(null);
    let url = urls[voice];
    if (url === undefined) {
      setState("loading");
      const answer = await voiceSample(tripId, voice);
      if (!answer.url) {
        setError(answer.error ?? "Nie udało się nagrać próbki.");
        setState("idle");
        return;
      }
      url = answer.url;
      setUrls((now) => ({ ...now, [voice]: answer.url! }));
    }
    player.current?.pause();
    const audio = new Audio(url);
    player.current = audio;
    audio.onended = () => setState("idle");
    setState("playing");
    await audio.play().catch(() => setState("idle"));
  };
  return (
    <>
      <button type="button" onClick={() => void play()} disabled={state === "loading"} className="btn-secondary btn-sm" title="Krótka próbka tego głosu">
        <SpeakerIcon className="size-4" />
        {state === "loading" ? "nagrywam próbkę…" : state === "playing" ? "zatrzymaj" : "posłuchaj"}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </>
  );
}

function SceneText({ tripId, kind, scene, live }: { tripId: string; kind: ShowKind; scene: EditorScene; live?: Live }) {
  const router = useRouter();
  const [text, setText] = useState(scene.text);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<FormState | null>(null);
  const changed = text.trim() !== scene.text.trim();
  const save = () =>
    start(async () => {
      const answer = await saveShowText(tripId, kind, scene.key, text);
      setResult(answer);
      if (answer.ok) router.refresh();
    });
  return (
    <li className="flex flex-col gap-1.5 p-3">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium">{scene.heading}</span>
        {scene.subheading && <span className="text-xs text-zinc-500">{scene.subheading}</span>}
        <span className="flex-1" />
        {scene.edited && <span className="text-xs text-zinc-500">poprawione ręcznie</span>}
        <RecordingBadge status={scene.status} {...(scene.seconds !== undefined ? { seconds: scene.seconds } : {})} {...(live !== undefined ? { live } : {})} unsaved={changed} />
      </div>
      <textarea value={text} onChange={(event) => setText(event.target.value)} rows={Math.min(8, Math.max(2, Math.ceil(text.length / 90)))} maxLength={3000} className="field p-2 text-sm" placeholder="Tekst lektora tej sceny (pusty: scena bez lektora, z samym nagłówkiem)" />
      {(changed || result) && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {changed && (
            <button onClick={save} disabled={pending} className="btn-mini">
              {pending ? "zapisuję…" : "zapisz"}
            </button>
          )}
          {result?.error && <span className="text-red-600">{result.error}</span>}
          {!changed && result?.ok && <span className="text-green-700 dark:text-green-400">{result.ok}</span>}
        </div>
      )}
    </li>
  );
}

export function ShowEditor({
  tripId,
  kind,
  scenes,
  voice,
  voices,
  toRecord,
}: {
  tripId: string;
  kind: ShowKind;
  scenes: EditorScene[];
  voice: string;
  voices: readonly { name: string; label: string }[];
  toRecord: string[];
}) {
  const router = useRouter();
  const [picked, setPicked] = useState(voice);
  const [progress, setProgress] = useState<{ done: number; total: number; waiting?: number } | null>(null);
  const [live, setLive] = useState<Record<string, Live>>({});
  const [message, setMessage] = useState<FormState | null>(null);
  const [pending, start] = useTransition();

  const changeVoice = (name: string) => {
    setPicked(name);
    start(async () => {
      const answer = await setShowVoice(tripId, kind, name);
      setMessage(answer);
      if (answer.ok) router.refresh();
    });
  };

  const written = scenes.filter((scene) => scene.status !== "none").map((scene) => scene.key);
  const record = async (keys: string[], retake: boolean) => {
    if (retake && !window.confirm(`Nagrać od nowa ${plural(keys.length, ["scenę", "sceny", "scen"])}? Obecne nagrania zastąpią nowe ujęcia.`)) return;
    setMessage(null);
    setProgress({ done: 0, total: keys.length });
    let seconds = 0;
    setLive({});
    for (const [at, key] of keys.entries()) {
      setLive((now) => ({ ...now, [key]: "recording" }));
      let answer = await recordShowScene(tripId, kind, key, retake);
      // Limit zapytań Google: odczekać i spróbować jeszcze raz, najwyżej kilka razy na scenę.
      for (let tries = 0; answer.wait !== undefined && tries < MAX_WAITS; tries += 1) {
        for (let left = answer.wait; left > 0; left -= 1) {
          setProgress({ done: at, total: keys.length, waiting: left });
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        setProgress({ done: at, total: keys.length });
        answer = await recordShowScene(tripId, kind, key, retake);
      }
      if (answer.error) {
        setLive((now) => {
          const next = { ...now };
          delete next[key];
          return next;
        });
        setMessage({ error: `Scena ${at + 1} z ${keys.length}: ${answer.error}` });
        setProgress(null);
        router.refresh();
        return;
      }
      seconds += answer.seconds ?? 0;
      setLive((now) => ({ ...now, [key]: { seconds: answer.seconds ?? 0 } }));
      setProgress({ done: at + 1, total: keys.length });
    }
    setProgress(null);
    setMessage({ ok: `Nagrano ${plural(keys.length, ["scenę", "sceny", "scen"])}, razem ${seconds < 60 ? `${seconds} s` : `ok. ${(Math.round(seconds / 6) / 10).toLocaleString("pl-PL")} min`}.` });
    router.refresh();
  };

  return (
    <section className="card flex flex-col gap-3 p-4">
      <h2 className="card-title">Lektor</h2>
      <PlanActionButton
        ai
        run={draftShow.bind(null, tripId, kind)}
        label={scenes.some((scene) => scene.text !== "") ? "Przygotuj tekst z AI od nowa" : "Przygotuj tekst z AI"}
        note={kind === "film" ? "Z wpisów i zdjęć dziennika, na tle planu; teksty poprawione ręcznie zostają" : "Zapowiedź z planu i opisów miejsc; teksty poprawione ręcznie zostają"}
      />
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          Głos
          <select value={picked} onChange={(event) => changeVoice(event.target.value)} disabled={pending || progress !== null} className="field px-2 py-1 text-sm">
            {voices.map((each) => (
              <option key={each.name} value={each.name}>
                {each.name} — {each.label}
              </option>
            ))}
          </select>
        </label>
        <VoiceSample tripId={tripId} voice={picked} />
        <button onClick={() => void record(toRecord, false)} disabled={toRecord.length === 0 || progress !== null || pending} className="btn-secondary btn-sm">
          <MicIcon className="size-4" />
          {progress?.waiting ? `Limit zapytań Google, czekam ${progress.waiting} s…` : progress ? `Nagrywam ${progress.done + 1} z ${progress.total}…` : toRecord.length > 0 ? `Nagraj lektora (${plural(toRecord.length, ["scena", "sceny", "scen"])})` : "Wszystko nagrane"}
        </button>
        {written.length > 0 && progress === null && (
          <button onClick={() => void record(written, true)} disabled={pending} className="btn-secondary btn-sm" title="Nowe ujęcia wszystkich scen z tekstem, także już nagranych">
            nagraj od nowa wszystko
          </button>
        )}
        <span className="text-xs text-zinc-500">Głos syntetyczny Gemini TTS; nagrywa się tylko scena z nowym tekstem</span>
      </div>
      {message?.error && <p className="text-sm text-red-600">{message.error}</p>}
      {message?.ok && <p className="text-sm text-green-700 dark:text-green-400">{message.ok}</p>}
      <ol className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {scenes.map((scene) => (
          <SceneText key={`${scene.key}:${scene.text}`} tripId={tripId} kind={kind} scene={scene} {...(live[scene.key] !== undefined ? { live: live[scene.key] } : {})} />
        ))}
      </ol>
    </section>
  );
}

const MUSIC_ACCEPT = ".mp3,.m4a,.aac,.ogg,.wav,audio/mpeg,audio/mp4,audio/x-m4a,audio/aac,audio/ogg,audio/wav";

/**
 * Podkład muzyczny: plik idzie z przeglądarki prosto do bucketu `show_audio` (akcja serwera przyjmuje do 4 MB),
 * potem akcja zapisuje go w scenariuszu; nieudany zapis sprząta plik. Głośność zapisuje się po chwili od przesunięcia.
 */
export function ShowMusicEditor({ tripId, kind, music }: { tripId: string; kind: ShowKind; music: { url: string; name: string; volume: number; skipS: number } | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<FormState | null>(null);
  const [level, setLevel] = useState(Math.round((music?.volume ?? 0.5) * 100));
  const [skip, setSkip] = useState(String(music?.skipS ?? 0).replace(".", ","));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file === undefined) return;
    setMessage(null);
    const target = showMusicFile(tripId, file, Date.now().toString(36));
    if (target === null) return setMessage({ error: "Ten format nie przejdzie: wybierz MP3, M4A, AAC, OGG albo WAV." });
    if (file.size > MUSIC_MAX_BYTES) return setMessage({ error: `Plik ma ${Math.round(file.size / 1024 / 1024)} MB, a podkład może mieć do 20 MB.` });
    setBusy(true);
    const bucket = createClient().storage.from("show_audio");
    const sent = await bucket.upload(target.path, file, { contentType: target.contentType, upsert: false });
    if (sent.error) {
      setBusy(false);
      return setMessage({ error: /row-level security|unauthorized/i.test(sent.error.message) ? "Podkład wgrywa tylko organizator albo edytor." : dbErrorMessage(sent.error, "Nie wgrano pliku. Spróbuj jeszcze raz.") });
    }
    const answer = await setShowMusic(tripId, kind, { path: target.path, name: file.name });
    if (answer.error) await bucket.remove([target.path]);
    setBusy(false);
    setMessage(answer);
    if (answer.ok) router.refresh();
  };

  const remove = async () => {
    if (!window.confirm("Usunąć podkład muzyczny z pokazu?")) return;
    setBusy(true);
    const answer = await setShowMusic(tripId, kind, null);
    setBusy(false);
    setMessage(answer);
    if (answer.ok) router.refresh();
  };

  const saveSettings = (settings: { percent?: number; skipS?: number }) =>
    void setShowMusicSettings(tripId, kind, settings).then((answer) => {
      setMessage(answer.error ? answer : null);
      if (answer.ok) router.refresh();
    });

  const changeLevel = (value: number) => {
    setLevel(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => saveSettings({ percent: value }), 600);
  };

  // Sekundy z przecinkiem albo kropką; zapis po chwili od ostatniej zmiany, puste pole to 0.
  const changeSkip = (text: string) => {
    setSkip(text);
    if (skipTimer.current) clearTimeout(skipTimer.current);
    const value = text.trim() === "" ? 0 : Number(text.replace(",", "."));
    if (!Number.isFinite(value) || value < 0 || value > 3600) return setMessage({ error: "Początek do pominięcia: liczba sekund od 0 do 3600." });
    setMessage(null);
    skipTimer.current = setTimeout(() => saveSettings({ skipS: value }), 800);
  };

  const picker = <input type="file" accept={MUSIC_ACCEPT} onChange={(event) => void upload(event)} disabled={busy} className="sr-only" />;

  return (
    <section className="card flex flex-col gap-3 p-4">
      <h2 className="card-title">Podkład muzyczny</h2>
      {music ? (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="font-medium break-all">{music.name}</span>
          {/* Odsłuch od pominiętego początku (fragment `#t=`). */}
          <audio key={music.skipS} controls src={`${music.url}#t=${music.skipS}`} preload="none" className="h-8 max-w-full" />
          <label className="flex items-center gap-2">
            Głośność
            <input type="range" min={5} max={100} step={5} value={level} onChange={(event) => changeLevel(Number(event.target.value))} disabled={busy} />
            <span className="w-10 text-zinc-500">{level}%</span>
          </label>
          <label className="flex items-center gap-2" title="Ile sekund z początku pliku pominąć, np. ciszę albo wstęp">
            Pomiń początek
            <input type="text" inputMode="decimal" value={skip} onChange={(event) => changeSkip(event.target.value)} disabled={busy} className="field w-16 px-2 py-1 text-right text-sm" />
            s
          </label>
          {/* Ikony jak w innych sekcjach (`IconAction`); wybór pliku to <label>, więc ołówek ma tę samą klasę ręcznie. */}
          <span className="flex items-center gap-1">
            <label title="zmień plik" aria-label="zmień plik" className={`btn-mini btn-icon cursor-pointer ${busy ? "opacity-50" : ""}`}>
              {busy ? "wgrywam…" : <PencilIcon className="size-3.5" />}
              {picker}
            </label>
            <IconAction kind="remove" tip="usuń muzykę" onClick={() => void remove()} disabled={busy} />
          </span>
        </div>
      ) : (
        <label className={`btn-secondary btn-sm w-fit cursor-pointer ${busy ? "opacity-50" : ""}`}>
          {busy ? "Wgrywam…" : "+ Dodaj plik z muzyką"}
          {picker}
        </label>
      )}
      {message?.error && <p className="text-sm text-red-600">{message.error}</p>}
      {message?.ok && <p className="text-sm text-green-700 dark:text-green-400">{message.ok}</p>}
      <p className="text-xs text-zinc-500">
        MP3, M4A, AAC, OGG albo WAV do 20 MB. Gra w pętli przez cały pokaz (od pominiętego początku): pod lektorem ciszej, na ekranie końcowym wygasa. Nazwa pliku jest na ekranie końcowym (tam autor utworu z licencją CC BY).
        Wgrywaj utwory własne albo z licencją, która na to pozwala: pod publicznym linkiem pokazu muzyka też gra.
      </p>
    </section>
  );
}
