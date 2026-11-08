"use client";

import { moneyToInput, parseMoney, type TripDocument, VENUE_POINT_LIMIT, venuePoints, type VenuePrice, venuePriceLabel, venueRatingLabel } from "@expeditionplan/core";
import { type ReactNode, useState, useTransition } from "react";

import type { FormState } from "@/app/actions";
import { dropVenueRating, saveVenuePoint, saveVenuePrice } from "@/app/venue-actions";
import { IconAction } from "@/components/icon-action";

/**
 * Ocena, punkty opisu i przykładowe ceny knajpy. W trybie edycji każdy punkt i każdą cenę można zmienić albo usunąć,
 * a nowe dopisać ręcznie, obok dopisywania z wklejonego tekstu (`VenueEditor`).
 */

type Place = TripDocument["places"][number];

const input = "field min-w-0 px-2 py-1 text-sm";

export function VenueEntries({ tripId, place, editing }: { tripId: string; place: Place; editing: boolean }) {
  const { venue } = place;
  const points = venuePoints(venue);
  const prices = venue?.prices ?? [];
  const [state, setState] = useState<FormState>({});
  const [pending, start] = useTransition();
  /** Wiersz w edycji: `point:<treść>`, `price:<nazwa>`, nowy `point` albo `price`. */
  const [open, setOpen] = useState<string | null>(null);

  const run = (action: () => Promise<FormState>) =>
    start(async () => {
      const result = await action();
      setState(result);
      if (result.ok) setOpen(null);
    });
  const remove = (what: string, action: () => Promise<FormState>) => {
    if (window.confirm(`Usunąć ${what}?`)) run(action);
  };
  const line = (children: ReactNode, onEdit: (() => void) | null, onRemove: () => void) => (
    <span className="flex flex-wrap items-baseline gap-x-2">
      <span>{children}</span>
      {editing && (
        <span className="text-xs text-zinc-500">
          {onEdit && (
            <IconAction kind="change" disabled={pending} onClick={onEdit} />
          )}
          <IconAction kind="remove" disabled={pending} onClick={onRemove} />
        </span>
      )}
    </span>
  );

  return (
    <>
      {venue?.rating && (
        <p>
          {line(
            <>
              <span aria-hidden="true">★ </span>
              <strong>{venueRatingLabel(venue.rating)}</strong>
            </>,
            null,
            () => remove("ocenę", () => dropVenueRating(tripId, place.ref)),
          )}
        </p>
      )}
      {(points.length > 0 || editing) && (
        <div className="flex flex-col gap-1">
          <h3 className="font-semibold">Opis</h3>
          {points.length > 0 && (
            <ul className="flex list-disc flex-col gap-1 pl-5">
              {points.map((point) => (
                <li key={point}>
                  {open === `point:${point}` ? (
                    <PointForm initial={point} pending={pending} onCancel={() => setOpen(null)} onSave={(text) => run(() => saveVenuePoint(tripId, place.ref, point, text))} />
                  ) : (
                    line(point, () => setOpen(`point:${point}`), () => remove("ten punkt", () => saveVenuePoint(tripId, place.ref, point, null)))
                  )}
                </li>
              ))}
            </ul>
          )}
          {editing &&
            (open === "point" ? (
              <PointForm initial="" pending={pending} onCancel={() => setOpen(null)} onSave={(text) => run(() => saveVenuePoint(tripId, place.ref, null, text))} />
            ) : (
              <button type="button" disabled={pending} onClick={() => setOpen("point")} className="btn-mini self-start">
                dodaj punkt
              </button>
            ))}
        </div>
      )}
      {(prices.length > 0 || editing) && (
        <div className="flex flex-col gap-1">
          <h3 className="font-semibold">Przykładowe ceny</h3>
          {prices.length > 0 && (
            <ul className="flex list-disc flex-col gap-1 pl-5">
              {prices.map((price) => (
                <li key={price.name}>
                  {open === `price:${price.name}` ? (
                    <PriceForm initial={price} pending={pending} onCancel={() => setOpen(null)} onSave={(next) => run(() => saveVenuePrice(tripId, place.ref, price.name, next))} />
                  ) : (
                    line(venuePriceLabel(price), () => setOpen(`price:${price.name}`), () => remove("tę cenę", () => saveVenuePrice(tripId, place.ref, price.name, null)))
                  )}
                </li>
              ))}
            </ul>
          )}
          {editing &&
            (open === "price" ? (
              <PriceForm initial={null} pending={pending} onCancel={() => setOpen(null)} onSave={(next) => run(() => saveVenuePrice(tripId, place.ref, null, next))} />
            ) : (
              <button type="button" disabled={pending} onClick={() => setOpen("price")} className="btn-mini self-start">
                dodaj cenę
              </button>
            ))}
        </div>
      )}
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
    </>
  );
}

function PointForm({ initial, pending, onCancel, onSave }: { initial: string; pending: boolean; onCancel: () => void; onSave: (text: string) => void }) {
  const [text, setText] = useState(initial);
  return (
    <form
      className="flex flex-col gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(text);
      }}>
      <textarea value={text} onChange={(event) => setText(event.target.value)} rows={2} maxLength={VENUE_POINT_LIMIT} disabled={pending} autoFocus aria-label="Treść punktu" className="field p-2 text-sm" />
      <div className="flex items-center gap-2">
        <button disabled={pending || text.trim() === ""} className="btn-primary btn-sm">
          Zapisz
        </button>
        <button type="button" disabled={pending} onClick={onCancel} className="btn-mini">
          anuluj
        </button>
      </div>
    </form>
  );
}

function PriceForm({ initial, pending, onCancel, onSave }: { initial: VenuePrice | null; pending: boolean; onCancel: () => void; onSave: (price: VenuePrice) => void }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [low, setLow] = useState(initial ? moneyToInput(initial.minMinor) : "");
  const [high, setHigh] = useState(initial && initial.maxMinor !== initial.minMinor ? moneyToInput(initial.maxMinor) : "");
  const [currency, setCurrency] = useState(initial?.currency ?? "PLN");
  const minMinor = parseMoney(low);
  const maxMinor = high.trim() === "" ? minMinor : parseMoney(high);
  const code = currency.trim().toUpperCase();
  const valid = name.trim() !== "" && minMinor !== null && maxMinor !== null && minMinor <= maxMinor && /^[A-Z]{3}$/.test(code);
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) onSave({ name: name.trim(), currency: code, minMinor: minMinor!, maxMinor: maxMinor! });
      }}>
      <label className="flex min-w-32 flex-1 flex-col gap-1 text-xs text-zinc-500">
        Pozycja
        <input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} disabled={pending} autoFocus className={input} />
      </label>
      <label className="flex w-20 flex-col gap-1 text-xs text-zinc-500">
        Cena
        <input value={low} onChange={(event) => setLow(event.target.value)} inputMode="decimal" disabled={pending} className={input} />
      </label>
      <label className="flex w-20 flex-col gap-1 text-xs text-zinc-500">
        Do (opcj.)
        <input value={high} onChange={(event) => setHigh(event.target.value)} inputMode="decimal" disabled={pending} className={input} />
      </label>
      <label className="flex w-16 flex-col gap-1 text-xs text-zinc-500">
        Waluta
        <input value={currency} onChange={(event) => setCurrency(event.target.value)} maxLength={3} disabled={pending} className={input} />
      </label>
      <button disabled={pending || !valid} className="btn-primary btn-sm">
        Zapisz
      </button>
      <button type="button" disabled={pending} onClick={onCancel} className="btn-mini">
        anuluj
      </button>
    </form>
  );
}
