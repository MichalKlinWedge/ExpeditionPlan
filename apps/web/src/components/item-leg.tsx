"use client";

import { isFootRouteItem, type PlanEdit, type PlanItem as Item, setLegRoute, type TripDocument } from "@expeditionplan/core";
import { uuidv7 } from "@expeditionplan/sync";
import { useId, useState, useTransition } from "react";

import { type FormState, routeItem } from "@/app/actions";

/**
 * Przejazd w edycji: skąd, dokąd i własny link do trasy. Zmiana miejsc od razu przelicza trasę
 * (OpenRouteService) i link do Map Google. Trasy piesze mają czas z mapy albo GPX i własny formularz
 * na karcie punktu, więc ich czasu tu nie nadpisujemy.
 */
export function ItemLegEditor({ tripId, doc, item, onEdit, disabled = false }: { tripId: string; doc: TripDocument; item: Item; onEdit: (edit: PlanEdit, done: () => void) => void; disabled?: boolean }) {
  const name = (ref: string | undefined) => doc.places.find((each) => each.ref === ref)?.name ?? "";
  const [from, setFrom] = useState(name(item.leg?.fromPlaceRef));
  const [to, setTo] = useState(name(item.leg?.toPlaceRef ?? item.placeRef));
  const [url, setUrl] = useState(item.leg?.routeUrl ?? "");
  const [state, setState] = useState<FormState>({});
  const [routing, startRouting] = useTransition();
  const listId = useId();
  const foot = isFootRouteItem(item);
  const busy = disabled || routing;

  const recalculate = () => startRouting(async () => setState(await routeItem(tripId, item.ref)));
  const save = () => {
    const link = url.trim();
    if (link !== "" && !/^https?:\/\/\S+$/i.test(link)) return setState({ error: "Link musi zaczynać się od https://." });
    const edit = setLegRoute(doc, item.ref, { fromId: uuidv7(), toId: uuidv7() }, { from, to, routeUrl: link });
    if (edit === null) return setState({ ok: "Bez zmian." });
    setState({});
    onEdit(edit, () => {
      if (edit.placesChanged && !foot) recalculate();
      else setState({ ok: "Zapisano." });
    });
  };

  const field = "field w-full px-2 py-1 text-sm";
  return (
    <div className="mt-2 flex flex-col gap-2 rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-zinc-500">
          Skąd
          <input value={from} onChange={(event) => setFrom(event.target.value)} list={listId} placeholder="Nazwa miejsca" disabled={busy} className={field} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-500">
          Dokąd
          <input value={to} onChange={(event) => setTo(event.target.value)} list={listId} placeholder="Nazwa miejsca" disabled={busy} className={field} />
        </label>
        <datalist id={listId}>
          {doc.places.map((each) => (
            <option key={each.ref} value={each.name} />
          ))}
        </datalist>
      </div>
      {!foot && (
        <label className="flex flex-col gap-1 text-xs text-zinc-500">
          Własny link do trasy (opcjonalnie, zastępuje link liczony ze „skąd” i „dokąd”)
          <input value={url} onChange={(event) => setUrl(event.target.value)} inputMode="url" placeholder="https://maps.app.goo.gl/…" disabled={busy} className={field} />
        </label>
      )}
      {item.leg === undefined && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          Ten przejazd nie ma jeszcze „skąd” i „dokąd”.{item.placeRef !== undefined ? " W „Dokąd” jest dotychczasowe miejsce punktu: jeśli to start, przenieś je do „Skąd”." : ""} Zapis utworzy trasę i link do Map Google, domyślnie autem.
        </p>
      )}
      <p className="text-xs text-zinc-500">Własny link tylko otwiera trasę: długość i czas przejazdu nadal liczymy ze „skąd” i „dokąd”.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={save} disabled={busy} className="btn-primary btn-sm">
          {routing ? "Przeliczam…" : "Zapisz przejazd"}
        </button>
        {!foot && (
          <button type="button" onClick={recalculate} disabled={busy} title="Długość i czas z OpenRouteService; czas wpisany ręcznie zostanie zastąpiony" className="btn-secondary btn-sm">
            Przelicz trasę
          </button>
        )}
      </div>
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
      {state.ok && <p className="text-xs text-emerald-700 dark:text-emerald-400">{state.ok}</p>}
    </div>
  );
}
