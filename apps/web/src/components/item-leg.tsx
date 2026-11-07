"use client";

import { isFootRouteItem, isTransit, isTransitItem, type PlanEdit, type PlanItem as Item, setLegRoute, type TripDocument } from "@expeditionplan/core";
import { uuidv7 } from "@expeditionplan/sync";
import Link from "next/link";
import { useId, useState, useTransition } from "react";

import { type FormState, routeItem } from "@/app/actions";
import { PinIcon } from "@/components/icons";

/**
 * Przejazd w edycji: skąd, dokąd i własny link do trasy. Zmiana miejsc od razu przelicza trasę
 * (OpenRouteService) i link do Map Google. Trasy piesze mają czas z mapy albo GPX i własny formularz
 * na karcie punktu, więc ich czasu tu nie nadpisujemy. Komunikacji publicznej mapa nie liczy: linie, czas
 * i odjazdy dodaje się z wklejonego połączenia w sekcji „Przejazd komunikacją” niżej.
 */
export function ItemLegEditor({ tripId, doc, item, onEdit, disabled = false }: { tripId: string; doc: TripDocument; item: Item; onEdit: (edit: PlanEdit, done: () => void) => void; disabled?: boolean }) {
  const name = (ref: string | undefined) => doc.places.find((each) => each.ref === ref)?.name ?? "";
  const [from, setFrom] = useState(name(item.leg?.fromPlaceRef));
  const [to, setTo] = useState(name(item.leg?.toPlaceRef ?? item.placeRef));
  const [url, setUrl] = useState(item.leg?.routeUrl ?? "");
  const [both, setBoth] = useState(item.leg?.roundTrip === true);
  const [transit, setTransit] = useState(isTransit(doc, item));
  const [state, setState] = useState<FormState>({});
  const [routing, startRouting] = useTransition();
  const listId = useId();
  const foot = isFootRouteItem(item);
  const publicTransport = isTransitItem(item);
  const routable = !foot && !publicTransport;
  const busy = disabled || routing;

  const recalculate = () => startRouting(async () => setState(await routeItem(tripId, item.ref)));
  const save = () => {
    const link = url.trim();
    if (link !== "" && !/^https?:\/\/\S+$/i.test(link)) return setState({ error: "Link musi zaczynać się od https://." });
    const edit = setLegRoute(doc, item.ref, { fromId: uuidv7(), toId: uuidv7() }, { from, to, routeUrl: link, roundTrip: both, transit });
    if (edit === null) return setState({ ok: "Bez zmian." });
    setState({});
    onEdit(edit, () => {
      // Nowy link Google może mieć punkty pośrednie — trasa liczy się od nowa.
      if ((edit.placesChanged || link !== (item.leg?.routeUrl ?? "")) && routable) recalculate();
      else setState({ ok: "Zapisano." });
    });
  };

  const field = "field w-full min-w-0 px-2 py-1 text-sm";
  // Przycisk z pinezką do miejsca na stronie Miejsc — gdy wpisana nazwa to miejsce z tego wyjazdu.
  const placeOf = (typed: string) => doc.places.find((each) => each.name.trim().toLowerCase() === typed.trim().toLowerCase());
  const pin = (typed: string) => {
    const place = typed.trim() === "" ? undefined : placeOf(typed);
    return place === undefined ? null : (
      <Link href={`/trips/${tripId}/places?miejsce=${encodeURIComponent(place.ref)}`} title={`„${place.name}” w Miejscach`} aria-label={`Pokaż „${place.name}” w Miejscach`} className="btn-mini my-0 shrink-0 justify-center self-stretch px-2">
        <PinIcon className="size-5" />
      </Link>
    );
  };
  return (
    <div className="mt-2 flex flex-col gap-2 rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-zinc-500">
          Skąd
          <span className="flex items-stretch gap-1">
            <input value={from} onChange={(event) => setFrom(event.target.value)} list={listId} placeholder="Nazwa miejsca" disabled={busy} className={field} />
            {pin(from)}
          </span>
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-500">
          Dokąd
          <span className="flex items-stretch gap-1">
            <input value={to} onChange={(event) => setTo(event.target.value)} list={listId} placeholder="Nazwa miejsca" disabled={busy} className={field} />
            {pin(to)}
          </span>
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
      <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400" title="Czas drogi liczy się dwa razy. Czas wpisany ręcznie w „Trwa” jest już całością.">
        <input type="checkbox" checked={both} onChange={(event) => setBoth(event.target.checked)} disabled={busy} />
        Tam i z powrotem: bez osobnego punktu na powrót, czas drogi liczy się dwa razy
      </label>
      <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400" title="Mapa dnia skupia się wtedy na miejscu. Lot i przejazd od 250 km są zaznaczone same; można to zmienić.">
        <input type="checkbox" checked={transit} onChange={(event) => setTransit(event.target.checked)} disabled={busy} />
        Dojazd lub powrót: na mapie chowa go przycisk „✈ Dojazd i powrót”
      </label>
      {item.leg === undefined && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          Ten przejazd nie ma jeszcze „skąd” i „dokąd”.{item.placeRef !== undefined ? " W „Dokąd” jest dotychczasowe miejsce punktu: jeśli to start, przenieś je do „Skąd”." : ""} Zapis utworzy trasę i link do Map Google, domyślnie autem.
        </p>
      )}
      {publicTransport ? (
        <p className="text-xs text-zinc-500">
          Komunikacji nie przeliczamy z mapy. Linie, przesiadki, czas i odjazdy dodasz niżej w{" "}
          <a href="#przejazd-komunikacja" className="btn-mini">
            Przejazd komunikacją
          </a>
          : wklej tam połączenie z Map Google, Jakdojade albo ze strony przewoźnika.
        </p>
      ) : (
        <p className="text-xs text-zinc-500">Długość, czas i linię na mapie liczymy ze „skąd” i „dokąd”. Link do Map Google z punktami pośrednimi (przeciągnięta trasa, przystanki) prowadzi trasę przez nie po „Przelicz trasę”.</p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={save} disabled={busy} className="btn-primary btn-sm">
          {routing ? "Przeliczam…" : "Zapisz przejazd"}
        </button>
        {routable && (
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
