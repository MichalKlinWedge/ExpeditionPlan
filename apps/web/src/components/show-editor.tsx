"use client";

import { plural } from "@expeditionplan/core";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { FormState } from "@/app/actions";
import { draftShow, recordShowScene, saveShowText, setShowVoice } from "@/app/show-actions";
import { MicIcon, SpeakerIcon } from "@/components/icons";
import { PlanActionButton } from "@/components/plan-action-button";

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

function SceneText({ tripId, scene, live }: { tripId: string; scene: EditorScene; live?: Live }) {
  const router = useRouter();
  const [text, setText] = useState(scene.text);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<FormState | null>(null);
  const changed = text.trim() !== scene.text.trim();
  const save = () =>
    start(async () => {
      const answer = await saveShowText(tripId, scene.key, text);
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

export function ShowEditor({ tripId, scenes, voice, voices, toRecord }: { tripId: string; scenes: EditorScene[]; voice: string; voices: readonly { name: string; label: string }[]; toRecord: string[] }) {
  const router = useRouter();
  const [picked, setPicked] = useState(voice);
  const [progress, setProgress] = useState<{ done: number; total: number; waiting?: number } | null>(null);
  const [live, setLive] = useState<Record<string, Live>>({});
  const [message, setMessage] = useState<FormState | null>(null);
  const [pending, start] = useTransition();

  const changeVoice = (name: string) => {
    setPicked(name);
    start(async () => {
      const answer = await setShowVoice(tripId, name);
      setMessage(answer);
      if (answer.ok) router.refresh();
    });
  };

  const record = async () => {
    setMessage(null);
    setProgress({ done: 0, total: toRecord.length });
    let seconds = 0;
    setLive({});
    for (const [at, key] of toRecord.entries()) {
      setLive((now) => ({ ...now, [key]: "recording" }));
      let answer = await recordShowScene(tripId, key);
      // Limit zapytań Google: odczekać i spróbować jeszcze raz, najwyżej kilka razy na scenę.
      for (let tries = 0; answer.wait !== undefined && tries < MAX_WAITS; tries += 1) {
        for (let left = answer.wait; left > 0; left -= 1) {
          setProgress({ done: at, total: toRecord.length, waiting: left });
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        setProgress({ done: at, total: toRecord.length });
        answer = await recordShowScene(tripId, key);
      }
      if (answer.error) {
        setLive((now) => {
          const next = { ...now };
          delete next[key];
          return next;
        });
        setMessage({ error: `Scena ${at + 1} z ${toRecord.length}: ${answer.error}` });
        setProgress(null);
        router.refresh();
        return;
      }
      seconds += answer.seconds ?? 0;
      setLive((now) => ({ ...now, [key]: { seconds: answer.seconds ?? 0 } }));
      setProgress({ done: at + 1, total: toRecord.length });
    }
    setProgress(null);
    setMessage({ ok: `Nagrano ${plural(toRecord.length, ["scenę", "sceny", "scen"])}, razem ${seconds < 60 ? `${seconds} s` : `ok. ${(Math.round(seconds / 6) / 10).toLocaleString("pl-PL")} min`}.` });
    router.refresh();
  };

  return (
    <section className="card flex flex-col gap-3 p-4">
      <h2 className="card-title">Lektor</h2>
      <PlanActionButton ai run={draftShow.bind(null, tripId)} label={scenes.some((scene) => scene.text !== "") ? "Przygotuj tekst z AI od nowa" : "Przygotuj tekst z AI"} note="Z planu, opisów miejsc i dziennika; teksty poprawione ręcznie zostają" />
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
        <button onClick={() => void record()} disabled={toRecord.length === 0 || progress !== null || pending} className="btn-secondary btn-sm">
          <MicIcon className="size-4" />
          {progress?.waiting ? `Limit zapytań Google, czekam ${progress.waiting} s…` : progress ? `Nagrywam ${progress.done + 1} z ${progress.total}…` : toRecord.length > 0 ? `Nagraj lektora (${plural(toRecord.length, ["scena", "sceny", "scen"])})` : "Wszystko nagrane"}
        </button>
        <span className="text-xs text-zinc-500">Głos syntetyczny Gemini TTS; nagrywa się tylko scena z nowym tekstem</span>
      </div>
      {message?.error && <p className="text-sm text-red-600">{message.error}</p>}
      {message?.ok && <p className="text-sm text-green-700 dark:text-green-400">{message.ok}</p>}
      <ol className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {scenes.map((scene) => (
          <SceneText key={`${scene.key}:${scene.text}`} tripId={tripId} scene={scene} {...(live[scene.key] !== undefined ? { live: live[scene.key] } : {})} />
        ))}
      </ol>
    </section>
  );
}
