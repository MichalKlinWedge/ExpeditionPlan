"use client";

import { useState } from "react";

import { ITEM_KIND, type KindChoice, kindChoice, kindChoices, kindPatch, type PlanItem as Item, type VehicleMode, vehicleChoices, vehicleFor, vehicleMode } from "@expeditionplan/core";

/**
 * Edycja punktu planu (MVP-3): nazwa, rodzaj, godzina z precyzją, czas trwania (przedział),
 * bufor, stała godzina, priorytet i kolejność cięcia. Puste pole = brak wartości.
 */

const PRECISION: Record<string, string> = {
  none: "bez godziny (po poprzednim)",
  exact: "dokładnie",
  by: "dokładnie do (np. przyjazd)",
  approx: "około",
  range: "przedział",
  part_of_day: "pora dnia",
  day: "cały dzień",
  relative: "względnie (+h:mm)",
};

const PARTS: Record<string, string> = { morning: "rano", midday: "południe", afternoon: "popołudnie", evening: "wieczór", night: "noc" };

/** Podpowiedzi pól (`title` — po najechaniu myszą). */
const TIP = {
  title: "Nazwa punktu w planie, na mapie, w przypomnieniach na telefonie i w wydruku.",
  kind: "Rodzaj decyduje o ikonie, kolorze na osi dnia i o tym, co punkt potrafi: przejazd ma trasę, skąd i dokąd, posiłek — knajpy w pobliżu, nocleg — dane obiektu.",
  vehicle: "Jak się jedzie albo idzie. Autem, taksówką i pieszo trasę i czas liczy „Przelicz przejazdy”; przy komunikacji publicznej punkt dostaje link do rozkładu.",
  precision:
    "Godzina to „nie wcześniej niż”: punkt zaczyna się o niej albo po końcu poprzednich punktów, jeśli kończą się później.\n• bez godziny — zaraz po poprzednim punkcie\n• dokładnie — o tej godzinie; spóźnienie to ostrzeżenie\n• dokładnie do — ma się skończyć o tej godzinie (np. przyjazd na lotnisko); start liczy się wstecz od czasu trwania\n• około — ostrzeżenie dopiero przy spóźnieniu ponad 15 min\n• przedział — od–do; bez „Trwa” czas punktu to ten przedział\n• pora dnia — nie wcześniej niż początek pory; ostrzeżenie, gdy wyjdzie poza nią\n• cały dzień — bez godziny, w kolejności dnia\n• względnie — przesunięcie od początku poprzedniego punktu albo od „godziny zero” dnia",
  start: "Godzina rozpoczęcia, czasu lokalnego miejsca.",
  end: "Przy „dokładnie” i „około” tylko informacja, do której. Samo „Do” bez „Od” przy „dokładnie” zapisze się jako „dokładnie do”.",
  partOfDay: "Okno pory dnia: punkt nie zacznie się przed jej początkiem, a gdy wypadnie po jej końcu, plan ostrzeże.",
  offset: "O ile później niż punkt odniesienia, np. 1:20 albo 80 (minut).",
  from: "Początek poprzedniego punktu albo „godzina zero” dnia (ustalana w dniu, np. start po przylocie).",
  duration: "Czas punktu w minutach (scenariusz optymistyczny). Przy przejeździe puste = czas trasy.",
  durationMax: "Górna granica czasu, gdy trwa „1–1,5 h”: tyle liczy scenariusz pesymistyczny i propozycje cięć.",
  stops: "Postoje i przerwy w trakcie punktu (np. kawa w trasie, odpoczynek na szlaku): dodają się do czasu trwania albo do czasu drogi i nie giną przy przeliczeniu trasy.",
  buffer: "Zapas po punkcie, zanim ruszy następny (np. zwrot auta, przebranie się po kąpieli).",
  priority: "Jak ważny jest punkt: „koniecznie” nigdy nie trafia do propozycji cięć, „opcjonalnie” idzie tam pierwsze.",
};

const input = "w-full field px-2 py-1 text-sm";
const label = "flex flex-col gap-1 text-xs text-zinc-500";

const num = (text: string) => (text.trim() === "" ? undefined : Math.max(0, Math.round(Number(text))));

type Draft = {
  title: string;
  kind: KindChoice;
  precision: string;
  start: string;
  end: string;
  partOfDay: string;
  offset: string;
  from: "anchor" | "previous";
  durationMin: string;
  durationMaxMin: string;
  stopsMin: string;
  bufferAfterMin: string;
  isFixed: boolean;
  transit: boolean;
  priority: string;
  cutRank: string;
  vehicle: VehicleMode | undefined;
};

function toDraft(item: Item, transitNow: boolean): Draft {
  const time = item.time;
  const offset = time?.precision === "relative" ? time.offsetMin : undefined;
  return {
    title: item.title,
    kind: kindChoice(item),
    precision: time?.precision ?? "none",
    start: time && "start" in time ? time.start : "",
    end: time && "end" in time && time.end ? time.end : "",
    partOfDay: time?.precision === "part_of_day" ? time.partOfDay : "morning",
    offset: offset === undefined ? "" : `${Math.floor(offset / 60)}:${String(offset % 60).padStart(2, "0")}`,
    from: time?.precision === "relative" ? time.from : "previous",
    durationMin: item.durationMin?.toString() ?? "",
    durationMaxMin: item.durationMaxMin?.toString() ?? "",
    stopsMin: item.stopsMin?.toString() ?? "",
    bufferAfterMin: item.bufferAfterMin?.toString() ?? "",
    isFixed: item.isFixed ?? false,
    transit: transitNow,
    priority: item.priority ?? "",
    cutRank: item.cutRank?.toString() ?? "",
    vehicle: vehicleMode(item),
  };
}

/** „1:20” albo „80” → minuty. */
function offsetMinutes(text: string): number {
  const match = /^(\d+):(\d{1,2})$/.exec(text.trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : Number(text) || 0;
}

function toPatch(draft: Draft, item: Item, transitNow: boolean): Partial<Item> {
  const tz = item.time && "tz" in item.time ? item.time.tz : undefined;
  let time: Item["time"];
  switch (draft.precision) {
    case "exact":
    case "approx":
      // „Dokładnie” z samym „Do” = „dokładnie do”: początek policzy silnik od czasu trwania.
      time =
        draft.precision === "exact" && draft.start === "" && draft.end !== ""
          ? { precision: "by", end: draft.end, ...(tz ? { tz } : {}) }
          : { precision: draft.precision, start: draft.start, ...(draft.end ? { end: draft.end } : {}), ...(tz ? { tz } : {}) };
      break;
    case "by":
      time = { precision: "by", end: draft.end, ...(tz ? { tz } : {}) };
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
  const chosen = kindPatch(item, draft.kind, draft.vehicle);
  return {
    title: draft.title.trim() || item.title,
    ...chosen,
    time,
    // Bez szczegółów przejazdu czas drogi zostaje czasem punktu.
    durationMin: num(draft.durationMin) ?? (chosen.leg === undefined ? item.leg?.durationMin : undefined),
    durationMaxMin: num(draft.durationMaxMin),
    stopsMin: num(draft.stopsMin) || undefined,
    bufferAfterMin: num(draft.bufferAfterMin),
    isFixed: draft.isFixed || undefined,
    // Bez zmiany zostaje samo rozpoznanie (np. punkt z rezerwacją lotu); przejazd ma znacznik w „skąd i dokąd”.
    ...(chosen.kind === "transport" ? {} : { transit: draft.transit === transitNow ? item.transit : draft.transit }),
    priority: (draft.priority || undefined) as Item["priority"],
    cutRank: cutRank === 0 ? undefined : cutRank,
  };
}

export function ItemEditor({ item, transitNow = item.transit ?? false, onSave, onCancel }: { item: Item; transitNow?: boolean; onSave: (patch: Partial<Item>) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(item, transitNow));
  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));
  const needsStart = ["exact", "approx", "range"].includes(draft.precision);
  // Przy „dokładnie” wystarczy samo „Do” (wtedy to „dokładnie do”).
  const startRequired = needsStart && !(draft.precision === "exact" && draft.end !== "");

  return (
    <form
      className="my-2 grid grid-cols-2 gap-2 panel p-3 sm:grid-cols-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(toPatch(draft, item, transitNow));
      }}>
      <label className={`${label} col-span-2`} title={TIP.title}>
        Nazwa
        <input className={input} value={draft.title} onChange={(event) => set({ title: event.target.value })} />
      </label>
      <label className={label} title={TIP.kind}>
        Rodzaj
        <select
          className={input}
          value={draft.kind}
          onChange={(event) => {
            const kind = event.target.value as KindChoice;
            set({ kind, vehicle: vehicleFor(kind, draft.vehicle) });
          }}>
          {kindChoices(ITEM_KIND).map(([key, name]) => (
            <option key={key} value={key}>
              {name}
            </option>
          ))}
        </select>
      </label>
      {vehicleChoices(draft.kind) && (
        <label className={label} title={TIP.vehicle}>
          Środek transportu
          <select className={input} value={vehicleFor(draft.kind, draft.vehicle)} onChange={(event) => set({ vehicle: event.target.value as VehicleMode })}>
            {vehicleChoices(draft.kind)!.map(([key, name]) => (
              <option key={key} value={key}>
                {name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className={label} title={TIP.precision}>
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
        <label className={label} title={TIP.start}>
          Od{startRequired ? "" : " (opcjonalnie)"}
          <input type="time" required={startRequired} className={input} value={draft.start} onChange={(event) => set({ start: event.target.value })} />
        </label>
      )}
      {(needsStart || draft.precision === "by") && (
        <label className={label} title={TIP.end}>
          {draft.precision === "by" ? "Do (koniec, np. przyjazd)" : `Do${draft.precision === "range" ? "" : " (opcjonalnie)"}`}
          <input type="time" required={draft.precision === "range" || draft.precision === "by"} className={input} value={draft.end} onChange={(event) => set({ end: event.target.value })} />
        </label>
      )}
      {draft.precision === "by" && <p className="col-span-2 self-end text-xs text-zinc-500">Początek liczy się od czasu trwania (z trasy albo „Trwa”), tak żeby skończyć o tej godzinie.</p>}
      {draft.precision === "part_of_day" && (
        <label className={label} title={TIP.partOfDay}>
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
          <label className={label} title={TIP.offset}>
            Przesunięcie (h:mm)
            <input className={input} value={draft.offset} onChange={(event) => set({ offset: event.target.value })} placeholder="1:20" />
          </label>
          <label className={label} title={TIP.from}>
            Od czego
            <select className={input} value={draft.from} onChange={(event) => set({ from: event.target.value as Draft["from"] })}>
              <option value="previous">początku poprzedniego punktu</option>
              <option value="anchor">godziny zero dnia</option>
            </select>
          </label>
        </>
      )}
      <label className={label} title={TIP.duration}>
        Trwa (min)
        <input type="number" min={0} className={input} value={draft.durationMin} onChange={(event) => set({ durationMin: event.target.value })} />
      </label>
      <label className={label} title={TIP.durationMax}>
        Najdłużej (min)
        <input type="number" min={0} className={input} value={draft.durationMaxMin} onChange={(event) => set({ durationMaxMin: event.target.value })} />
      </label>
      <label className={label} title={TIP.stops}>
        Postoje, przerwy (min)
        <input type="number" min={0} className={input} value={draft.stopsMin} onChange={(event) => set({ stopsMin: event.target.value })} />
      </label>
      <label className={label} title={TIP.buffer}>
        Bufor po (min)
        <input type="number" min={0} className={input} value={draft.bufferAfterMin} onChange={(event) => set({ bufferAfterMin: event.target.value })} />
      </label>
      <label className={label} title={TIP.priority}>
        Priorytet
        <select className={input} value={draft.priority} onChange={(event) => set({ priority: event.target.value })}>
          <option value="">—</option>
          <option value="must">koniecznie</option>
          <option value="should">warto</option>
          <option value="optional">opcjonalnie</option>
        </select>
      </label>
      <label
        className={label}
        title="Gdy dzień się nie spina, lista „Co wyciąć, żeby dzień się spiął” pod planem dnia proponuje wyciąć punkty w tej kolejności: 1 = najpierw. Pierwsze idą punkty „opcjonalnie”. Nigdy nie proponuje punktów „koniecznie”, ze stałą godziną, przejazdów ani noclegów.">
        Kolejność cięcia
        <input type="number" min={0} className={input} value={draft.cutRank} onChange={(event) => set({ cutRank: event.target.value })} placeholder="1 = pierwsze" />
      </label>
      <label
        className="flex items-center gap-2 text-xs text-zinc-500"
        title="Godzina, na którą nie masz wpływu (lot, mecz, bilet, start wycieczki): przesuwanie i usuwanie innych punktów jej nie rusza, spóźnienie to czerwone ostrzeżenie, zapas dnia liczy się do niej, a punkt nie trafia do „Co wyciąć”. Samo „dokładnie” to tylko planowany start, który może się przesunąć.">
        <input type="checkbox" checked={draft.isFixed} onChange={(event) => set({ isFixed: event.target.checked })} />
        stała godzina
      </label>
      {kindPatch(item, draft.kind, draft.vehicle).kind !== "transport" && (
        <label className="col-span-2 flex items-center gap-2 text-xs text-zinc-500 sm:col-span-3" title="Mapa dnia skupia się wtedy na miejscach wyjazdu. Punkt przy locie jest zaznaczony sam; można to zmienić.">
          <input type="checkbox" checked={draft.transit} onChange={(event) => set({ transit: event.target.checked })} />
          dojazd lub powrót: na mapie chowa go przycisk „✈ Dojazd i powrót”
        </label>
      )}
      <div className="col-span-2 flex gap-2 sm:col-span-4">
        <button className="btn-primary btn-sm">Zapisz</button>
        <button type="button" onClick={onCancel} className="btn-secondary btn-sm">
          Anuluj
        </button>
      </div>
    </form>
  );
}
