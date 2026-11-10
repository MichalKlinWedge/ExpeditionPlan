"use client";

import { type FormEvent, useState, useTransition } from "react";

import type { FormState } from "@/app/actions";
import { addPlace } from "@/app/place-actions";

/** „+ Nowe miejsce” na stronie „Miejsca”: miejsce bez punktu planu, z nazwą i opcjonalnie współrzędnymi lub linkiem z mapy. */
export function NewPlace({ tripId }: { tripId: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [coords, setCoords] = useState("");
  const [state, setState] = useState<FormState>({});
  const [pending, start] = useTransition();
  const close = () => {
    setOpen(false);
    setName("");
    setCoords("");
    setState({});
  };
  const save = (event: FormEvent) => {
    event.preventDefault();
    // Udany zapis przechodzi na stronę z nowym miejscem wybranym (przekierowanie w akcji).
    start(async () => setState(await addPlace(tripId, { name, coords })));
  };
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn-secondary btn-sm self-start">
        + Nowe miejsce
      </button>
    );
  }
  return (
    <form onSubmit={save} className="card flex flex-col gap-2 p-4 text-sm">
      <h2 className="card-title">Nowe miejsce</h2>
      <p className="text-xs text-zinc-500">Miejsce bez punktu w planie, np. na później albo do zapamiętania. Do planu dodasz je potem jak każde inne miejsce.</p>
      <div className="flex flex-wrap gap-2">
        <input value={name} onChange={(event) => setName(event.target.value)} disabled={pending} required placeholder="Nazwa miejsca" aria-label="Nazwa nowego miejsca" className="field min-w-48 flex-1 px-2 py-1" />
        <input value={coords} onChange={(event) => setCoords(event.target.value)} disabled={pending} placeholder="Współrzędne albo link z mapy (opcjonalnie)" aria-label="Współrzędne nowego miejsca" className="field min-w-56 flex-1 px-2 py-1" />
      </div>
      <div className="flex flex-wrap gap-2">
        <button disabled={pending || name.trim() === ""} className="btn-primary btn-sm">
          {pending ? "Zapisuję…" : "Dodaj miejsce"}
        </button>
        <button type="button" onClick={close} disabled={pending} className="btn-secondary btn-sm">
          Anuluj
        </button>
      </div>
      {state.error && <p className="msg-error text-xs">{state.error}</p>}
    </form>
  );
}
