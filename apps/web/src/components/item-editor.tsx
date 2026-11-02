"use client";

import { useState } from "react";

import type { PlanItem as Item } from "@expeditionplan/core";

/**
 * Edycja punktu planu (MVP-3): nazwa, rodzaj, godzina z precyzją, czas trwania (przedział),
 * bufor, stała godzina, priorytet i kolejność cięcia. Puste pole = brak wartości.
 */

const KINDS: Record<string, string> = {
  visit: "zwiedzanie",
  activity: "aktywność",
  meal: "posiłek",
  transport: "przejazd",
  lodging: "nocleg",
  errand: "sprawa",
  meetup: "spotkanie",
  free: "czas wolny",
  decision: "decyzja",
};

const PRECISION: Record<string, string> = {
  none: "bez godziny (po poprzednim)",
  exact: "dokładnie",
  approx: "około",
  range: "przedział",
  part_of_day: "pora dnia",
  day: "cały dzień",
  relative: "względnie (+h:mm)",
};

const PARTS: Record<string, string> = { morning: "rano", midday: "południe", afternoon: "popołudnie", evening: "wieczór", night: "noc" };

const input = "w-full field px-2 py-1 text-sm";
const label = "flex flex-col gap-1 text-xs text-zinc-500";

const num = (text: string) => (text.trim() === "" ? undefined : Math.max(0, Math.round(Number(text))));

type Draft = {
  title: string;
  kind: Item["kind"];
  precision: string;
  start: string;
  end: string;
  partOfDay: string;
  offset: string;
  from: "anchor" | "previous";
  durationMin: string;
  durationMaxMin: string;
  bufferAfterMin: string;
  isFixed: boolean;
  priority: string;
  cutRank: string;
};

function toDraft(item: Item): Draft {
  const time = item.time;
  const offset = time?.precision === "relative" ? time.offsetMin : undefined;
  return {
    title: item.title,
    kind: item.kind,
    precision: time?.precision ?? "none",
    start: time && "start" in time ? time.start : "",
    end: time && "end" in time && time.end ? time.end : "",
    partOfDay: time?.precision === "part_of_day" ? time.partOfDay : "morning",
    offset: offset === undefined ? "" : `${Math.floor(offset / 60)}:${String(offset % 60).padStart(2, "0")}`,
    from: time?.precision === "relative" ? time.from : "previous",
    durationMin: item.durationMin?.toString() ?? "",
    durationMaxMin: item.durationMaxMin?.toString() ?? "",
    bufferAfterMin: item.bufferAfterMin?.toString() ?? "",
    isFixed: item.isFixed ?? false,
    priority: item.priority ?? "",
    cutRank: item.cutRank?.toString() ?? "",
  };
}

/** „1:20” albo „80” → minuty. */
function offsetMinutes(text: string): number {
  const match = /^(\d+):(\d{1,2})$/.exec(text.trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : Number(text) || 0;
}

function toPatch(draft: Draft, item: Item): Partial<Item> {
  const tz = item.time && "tz" in item.time ? item.time.tz : undefined;
  let time: Item["time"];
  switch (draft.precision) {
    case "exact":
    case "approx":
      time = { precision: draft.precision, start: draft.start, ...(draft.end ? { end: draft.end } : {}), ...(tz ? { tz } : {}) };
      break;
    case "range":
      time = { precision: "range", start: draft.start, end: draft.end, ...(tz ? { tz } : {}) };
      break;
    case "part_of_day":
      time = { precision: "part_of_day", partOfDay: draft.partOfDay as "morning", ...(tz ? { tz } : {}) };
      break;
    case "day":
      time = { precision: "day" };
      break;
    case "relative":
      time = { precision: "relative", offsetMin: offsetMinutes(draft.offset), from: draft.from };
      break;
    default:
      time = undefined;
  }
  const cutRank = num(draft.cutRank);
  return {
    title: draft.title.trim() || item.title,
    kind: draft.kind,
    time,
    durationMin: num(draft.durationMin),
    durationMaxMin: num(draft.durationMaxMin),
    bufferAfterMin: num(draft.bufferAfterMin),
    isFixed: draft.isFixed || undefined,
    priority: (draft.priority || undefined) as Item["priority"],
    cutRank: cutRank === 0 ? undefined : cutRank,
    // Szczegóły przejazdu istnieją tylko przy punkcie `transport`.
    leg: draft.kind === "transport" ? item.leg : undefined,
  };
}

export function ItemEditor({ item, onSave, onCancel }: { item: Item; onSave: (patch: Partial<Item>) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(item));
  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));
  const needsStart = ["exact", "approx", "range"].includes(draft.precision);

  return (
    <form
      className="my-2 grid grid-cols-2 gap-2 rounded-md border border-zinc-200 p-3 sm:grid-cols-4 dark:border-zinc-800"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(toPatch(draft, item));
      }}>
      <label className={`${label} col-span-2`}>
        Nazwa
        <input className={input} value={draft.title} onChange={(event) => set({ title: event.target.value })} />
      </label>
      <label className={label}>
        Rodzaj
        <select className={input} value={draft.kind} onChange={(event) => set({ kind: event.target.value as Item["kind"] })}>
          {Object.entries(KINDS).map(([key, name]) => (
            <option key={key} value={key}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label className={label}>
        Godzina
        <select className={input} value={draft.precision} onChange={(event) => set({ precision: event.target.value })}>
          {Object.entries(PRECISION).map(([key, name]) => (
            <option key={key} value={key}>
              {name}
            </option>
          ))}
        </select>
      </label>
      {needsStart && (
        <label className={label}>
          Od
          <input type="time" required className={input} value={draft.start} onChange={(event) => set({ start: event.target.value })} />
        </label>
      )}
      {needsStart && (
        <label className={label}>
          Do{draft.precision === "range" ? "" : " (opcjonalnie)"}
          <input type="time" required={draft.precision === "range"} className={input} value={draft.end} onChange={(event) => set({ end: event.target.value })} />
        </label>
      )}
      {draft.precision === "part_of_day" && (
        <label className={label}>
          Pora
          <select className={input} value={draft.partOfDay} onChange={(event) => set({ partOfDay: event.target.value })}>
            {Object.entries(PARTS).map(([key, name]) => (
              <option key={key} value={key}>
                {name}
              </option>
            ))}
          </select>
        </label>
      )}
      {draft.precision === "relative" && (
        <>
          <label className={label}>
            Przesunięcie (h:mm)
            <input className={input} value={draft.offset} onChange={(event) => set({ offset: event.target.value })} placeholder="1:20" />
          </label>
          <label className={label}>
            Od czego
            <select className={input} value={draft.from} onChange={(event) => set({ from: event.target.value as Draft["from"] })}>
              <option value="previous">początku poprzedniego punktu</option>
              <option value="anchor">godziny zero dnia</option>
            </select>
          </label>
        </>
      )}
      <label className={label}>
        Trwa (min)
        <input type="number" min={0} className={input} value={draft.durationMin} onChange={(event) => set({ durationMin: event.target.value })} />
      </label>
      <label className={label}>
        Najdłużej (min)
        <input type="number" min={0} className={input} value={draft.durationMaxMin} onChange={(event) => set({ durationMaxMin: event.target.value })} />
      </label>
      <label className={label}>
        Bufor po (min)
        <input type="number" min={0} className={input} value={draft.bufferAfterMin} onChange={(event) => set({ bufferAfterMin: event.target.value })} />
      </label>
      <label className={label}>
        Priorytet
        <select className={input} value={draft.priority} onChange={(event) => set({ priority: event.target.value })}>
          <option value="">—</option>
          <option value="must">koniecznie</option>
          <option value="should">warto</option>
          <option value="optional">opcjonalnie</option>
        </select>
      </label>
      <label className={label}>
        Kolejność cięcia
        <input type="number" min={0} className={input} value={draft.cutRank} onChange={(event) => set({ cutRank: event.target.value })} placeholder="1 = pierwsze" />
      </label>
      <label className="flex items-center gap-2 text-xs text-zinc-500">
        <input type="checkbox" checked={draft.isFixed} onChange={(event) => set({ isFixed: event.target.checked })} />
        stała godzina
      </label>
      <div className="col-span-2 flex gap-2 sm:col-span-4">
        <button className="btn-primary btn-sm">Zapisz</button>
        <button type="button" onClick={onCancel} className="btn-secondary btn-sm">
          Anuluj
        </button>
      </div>
    </form>
  );
}
