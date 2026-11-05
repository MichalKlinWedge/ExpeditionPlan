"use client";

import { defaultTake, formatWeight, type GearCarry, gearLoads, gearShare, type GearShare, isGear, type TripDocument } from "@expeditionplan/core";
import { useActionState, useState, useTransition } from "react";

import type { FormState } from "@/app/actions";
import { removeGearItem, saveGearItem, setGearCarrier } from "@/app/logistics-actions";

/**
 * Sprzęt: rzeczy osobiste (każdy pakuje swoje) i wspólne (kto bierze, żeby nie dublować) z podziałem
 * obciążenia. „Biorę” może powiedzieć każdy uczestnik za siebie i swoje dzieci, także widz; po „Edytuj”
 * organizator rozdziela rzeczy między wszystkich i poprawia listę. Spakowane odhacza się na telefonie.
 */

type Doc = TripDocument;
type Item = Doc["packing"][number];
type Filter = "all" | "open" | { person: string };

const input = "field min-w-0 px-2 py-1 text-sm";
const small = "text-xs underline disabled:opacity-50";
const SUGGESTED = ["ubrania", "sprzęt", "biwak", "kuchnia", "apteczka", "elektronika", "dokumenty"];
const number = (value: number) => value.toLocaleString("pl-PL", { maximumFractionDigits: 2 });
const amount = (item: Pick<Item, "unit">, value: number) => `${number(value)}${item.unit ? ` ${item.unit}` : ""}`;

function Status({ state }: { state: FormState }) {
  if (state.error) return <p className="text-xs text-red-600">{state.error}</p>;
  if (state.ok) return <p className="text-xs text-green-700 dark:text-green-400">{state.ok}</p>;
  return null;
}

function useAction() {
  const [state, setState] = useState<FormState>({});
  const [pending, start] = useTransition();
  const run = (action: () => Promise<FormState>, confirm?: string) => {
    if (confirm !== undefined && !window.confirm(confirm)) return;
    start(async () => setState(await action()));
  };
  return { state, pending, run };
}

function byCategory(items: Item[]): [string, Item[]][] {
  const groups = new Map<string, Item[]>();
  for (const item of items) groups.set(item.category, [...(groups.get(item.category) ?? []), item]);
  return [...groups.entries()];
}

export type GearViewProps = {
  tripId: string;
  doc: Doc;
  carries: GearCarry[];
  /** Pary „ref rzeczy|ref uczestnika” odhaczone na telefonie. */
  packed: string[];
  /** Ref → id wiersza. */
  ids: Record<string, string>;
  /** Uczestnicy, za których mówi to konto: ono samo (pierwsze) i jego dzieci. */
  mine: string[];
  /** Organizator albo edytor (także poza trybem edycji). */
  mayEdit: boolean;
  canEdit: boolean;
};

export function GearView({ tripId, doc, carries, packed, ids, mine, mayEdit, canEdit }: GearViewProps) {
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<string | null>(null);
  const gear = doc.packing.filter(isGear);
  const shared = gear.filter((item) => item.scope === "shared");
  const loads = gearLoads(doc, carries);
  const open = shared.filter((item) => gearShare(item, carries).left > 0);
  const over = shared.filter((item) => gearShare(item, carries).status === "over");
  const person = typeof filter === "object" ? loads.find((load) => load.travelerRef === filter.person) : undefined;
  const shownShared = filter === "open" ? open : person !== undefined ? person.shared.map((line) => line.item) : shared;
  const shownPersonal = filter === "open" ? [] : person !== undefined ? person.personal : gear.filter((item) => item.scope === "personal");
  const packedSet = new Set(packed);
  const categories = [...new Set([...gear.map((item) => item.category), ...SUGGESTED])];

  const allowed = canEdit ? doc.travelers.map((each) => each.ref) : mine;
  const tentative = new Set(doc.travelers.filter((each) => each.tentative).map((each) => each.ref));
  const nameOf = (ref: string) => doc.travelers.find((each) => each.ref === ref)?.name ?? "?";
  const isFilter = (other: Filter) => (typeof other === "object" ? typeof filter === "object" && filter.person === other.person : filter === other);
  const chip = (active: boolean) => `rounded-full border px-2.5 py-0.5 text-xs ${active ? "border-sea bg-sea/10 font-medium" : "border-zinc-300 dark:border-zinc-700"}`;

  const anyWeight = loads.some((load) => load.weightG > 0);
  const measure = (load: (typeof loads)[number]) => (anyWeight ? load.weightG : load.shared.length);
  const top = Math.max(1, ...loads.map(measure));

  return (
    <>
      {doc.travelers.length > 0 && gear.length > 0 && (
        <section className="flex flex-col gap-2 card p-4 text-sm">
          <h2 className="font-semibold">Kto ile niesie</h2>
          <ul className="flex flex-col gap-2">
            {loads.map((load) => {
              const own = [...load.personal, ...load.shared.map((line) => line.item)];
              const done = own.filter((item) => packedSet.has(`${item.ref}|${load.travelerRef}`)).length;
              return (
                <li key={load.travelerRef} className="flex flex-col gap-0.5">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <button type="button" onClick={() => setFilter({ person: load.travelerRef })} className="font-medium underline-offset-2 hover:underline">
                      {nameOf(load.travelerRef)}
                    </button>
                    {tentative.has(load.travelerRef) && <span className="rounded bg-amber-100 px-1.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">waha się</span>}
                    <span className="text-xs text-zinc-500">
                      {anyWeight && load.weightG > 0 && `${formatWeight(load.weightG)}${load.noWeight > 0 ? ` + ${load.noWeight} bez wagi` : ""} · `}wspólne: {load.shared.length} · osobiste: {load.personal.length} · spakowane: {done} z {own.length}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-800" aria-hidden="true">
                    <div className="h-full rounded-full bg-sea" style={{ width: `${(measure(load) / top) * 100}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
          {over.length > 0 && <p className="text-xs text-red-700 dark:text-red-400">Dublujecie: {over.map((item) => item.title).join(", ")}</p>}
        </section>
      )}

      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={() => setFilter("all")} className={chip(isFilter("all"))}>
          Wszystko ({gear.length})
        </button>
        <button type="button" onClick={() => setFilter("open")} className={chip(isFilter("open"))}>
          Do ustalenia ({open.length})
        </button>
        {doc.travelers.map((each) => (
          <button key={each.ref} type="button" onClick={() => setFilter({ person: each.ref })} className={chip(isFilter({ person: each.ref }))}>
            {each.name}
          </button>
        ))}
      </div>

      <section className="flex flex-col gap-3 card p-4 text-sm">
        <div>
          <h2 className="font-semibold">Wspólne</h2>
          <p className="text-xs text-zinc-500">Wystarczy jedno na grupę albo dzielicie się ilością: ustalcie, kto bierze.</p>
          {allowed.length === 0 && !mayEdit && <p className="text-xs text-zinc-500">Twoje konto nie jest połączone z żadnym uczestnikiem, więc nie możesz tu niczego wziąć. Poproś organizatora o zaproszenie imienne.</p>}
        </div>
        {shownShared.length === 0 && <p className="text-zinc-500">{filter === "open" ? "Każda wspólna rzecz ma już osobę." : person !== undefined ? "Ta osoba nie bierze nic wspólnego." : "Brak wspólnych rzeczy."}</p>}
        {byCategory(shownShared).map(([category, items]) => (
          <div key={category} className="flex flex-col gap-2">
            <h3 className="text-xs font-medium tracking-wide text-zinc-500 uppercase">{category}</h3>
            <ul className="flex flex-col gap-3">
              {items.map((item) =>
                editing === item.ref ? (
                  <li key={item.ref}>
                    <GearForm tripId={tripId} doc={doc} item={item} itemId={ids[item.ref]} categories={categories} onDone={() => setEditing(null)} />
                  </li>
                ) : (
                  <SharedRow key={item.ref} tripId={tripId} item={item} itemId={ids[item.ref] ?? ""} share={gearShare(item, carries)} ids={ids} allowed={allowed} me={mine[0]} tentative={tentative} nameOf={nameOf} canEdit={canEdit} onEdit={() => setEditing(item.ref)} />
                ),
              )}
            </ul>
          </div>
        ))}
      </section>

      {filter !== "open" && (
        <section className="flex flex-col gap-3 card p-4 text-sm">
          <div>
            <h2 className="font-semibold">Osobiste</h2>
            <p className="text-xs text-zinc-500">Każdy pakuje swoje.</p>
          </div>
          {shownPersonal.length === 0 && <p className="text-zinc-500">Brak rzeczy osobistych.</p>}
          {byCategory(shownPersonal).map(([category, items]) => (
            <div key={category} className="flex flex-col gap-1">
              <h3 className="text-xs font-medium tracking-wide text-zinc-500 uppercase">{category}</h3>
              <ul className="flex flex-col gap-1">
                {items.map((item) =>
                  editing === item.ref ? (
                    <li key={item.ref}>
                      <GearForm tripId={tripId} doc={doc} item={item} itemId={ids[item.ref]} categories={categories} onDone={() => setEditing(null)} />
                    </li>
                  ) : (
                    <li key={item.ref} className="flex flex-wrap items-baseline gap-x-2">
                      {person !== undefined && <span aria-label={packedSet.has(`${item.ref}|${person.travelerRef}`) ? "spakowane" : "do spakowania"}>{packedSet.has(`${item.ref}|${person.travelerRef}`) ? "☑" : "☐"}</span>}
                      <ItemText item={item} />
                      {item.assigneeRef !== undefined && <span className="text-xs text-zinc-500">· tylko {nameOf(item.assigneeRef)}</span>}
                      {canEdit && <ItemActions tripId={tripId} item={item} itemId={ids[item.ref] ?? ""} onEdit={() => setEditing(item.ref)} />}
                    </li>
                  ),
                )}
              </ul>
            </div>
          ))}
        </section>
      )}

      {canEdit &&
        (editing === "new" ? (
          <section className="card p-4">
            <GearForm tripId={tripId} doc={doc} categories={categories} onDone={() => setEditing(null)} />
          </section>
        ) : (
          <button type="button" onClick={() => setEditing("new")} className="self-start text-sm underline">
            + Dodaj rzecz
          </button>
        ))}
    </>
  );
}

function ItemText({ item }: { item: Item }) {
  return (
    <>
      <span className="font-medium">{item.title}</span>
      {item.quantity !== undefined && <span>× {amount(item, item.quantity)}</span>}
      {item.weightG !== undefined && (
        <span className="text-xs text-zinc-500">
          · {formatWeight(item.weightG)}
          {item.quantity !== undefined ? ` / ${item.unit ?? "szt."}` : ""}
        </span>
      )}
      {item.note && <span className="text-xs text-zinc-500">· {item.note}</span>}
    </>
  );
}

function ItemActions({ tripId, item, itemId, onEdit }: { tripId: string; item: Item; itemId: string; onEdit: () => void }) {
  const remove = useAction();
  return (
    <span className="text-zinc-500">
      <button type="button" onClick={onEdit} className={small}>
        edytuj
      </button>{" "}
      <button type="button" disabled={remove.pending} onClick={() => remove.run(() => removeGearItem(tripId, item.ref, itemId), `Usunąć „${item.title}” z listy?`)} className={small}>
        usuń
      </button>
      <Status state={remove.state} />
    </span>
  );
}

function ShareBadge({ item, share }: { item: Item; share: GearShare }) {
  const amber = "rounded bg-amber-100 px-1.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300";
  switch (share.status) {
    case "open":
      return <span className={amber}>do ustalenia</span>;
    case "partial":
      return <span className={amber}>brakuje {amount(item, share.left)}</span>;
    case "over":
      return <span className="rounded bg-red-100 px-1.5 text-xs font-medium text-red-800 dark:bg-red-950 dark:text-red-300">za dużo: {number(share.taken)} z {number(share.needed)}</span>;
    case "covered":
      return <span className="text-xs text-emerald-700 dark:text-emerald-400">✓</span>;
  }
}

type SharedRowProps = {
  tripId: string;
  item: Item;
  itemId: string;
  share: GearShare;
  ids: Record<string, string>;
  allowed: string[];
  me: string | undefined;
  tentative: Set<string>;
  nameOf: (ref: string) => string;
  canEdit: boolean;
  onEdit: () => void;
};

function SharedRow({ tripId, item, itemId, share, ids, allowed, me, tentative, nameOf, canEdit, onEdit }: SharedRowProps) {
  const action = useAction();
  const set = (traveler: string, quantity: number) => action.run(() => setGearCarrier(tripId, itemId, ids[traveler] ?? "", quantity));
  const take = defaultTake(share);
  const carrying = new Set(share.carriers.map((carrier) => carrier.travelerRef));
  const others = allowed.filter((ref) => !carrying.has(ref) && ref !== me);
  const split = (item.quantity ?? 1) !== 1;

  return (
    <li className="flex flex-col gap-1">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <ItemText item={item} />
        <ShareBadge item={item} share={share} />
        {canEdit && <ItemActions tripId={tripId} item={item} itemId={itemId} onEdit={onEdit} />}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {share.carriers.map((carrier) => {
          const mayChange = allowed.includes(carrier.travelerRef);
          return (
            <span key={carrier.travelerRef} className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800">
              {nameOf(carrier.travelerRef)}
              {tentative.has(carrier.travelerRef) && <span className="text-amber-700 dark:text-amber-400">(waha się)</span>}
              {split &&
                (mayChange ? (
                  <input
                    key={carrier.quantity}
                    defaultValue={number(carrier.quantity)}
                    inputMode="decimal"
                    aria-label={`Ile bierze ${nameOf(carrier.travelerRef)}`}
                    className="w-12 rounded border border-zinc-300 bg-transparent px-1 text-center dark:border-zinc-600"
                    onBlur={(event) => {
                      const next = Number(event.target.value.replace(",", "."));
                      if (Number.isFinite(next) && next > 0 && next !== carrier.quantity) set(carrier.travelerRef, next);
                    }}
                  />
                ) : (
                  <span>× {number(carrier.quantity)}</span>
                ))}
              {split && item.unit && <span>{item.unit}</span>}
              {mayChange && (
                <button type="button" disabled={action.pending} onClick={() => set(carrier.travelerRef, 0)} title="Nie bierze" aria-label={`${nameOf(carrier.travelerRef)} nie bierze`} className="text-zinc-500 hover:text-red-600 disabled:opacity-50">
                  ×
                </button>
              )}
            </span>
          );
        })}
        {me !== undefined &&
          !carrying.has(me) &&
          // Komplet: bez wyraźnego przycisku, żeby nie zachęcać do dublowania.
          (share.left > 0 ? (
            <button type="button" disabled={action.pending} onClick={() => set(me, take)} className="btn-primary btn-sm">
              Biorę
            </button>
          ) : (
            <button type="button" disabled={action.pending} onClick={() => set(me, take)} className={small}>
              też biorę
            </button>
          ))}
        {others.length > 0 && (
          <select
            value=""
            disabled={action.pending}
            aria-label={`Kto bierze: ${item.title}`}
            onChange={(event) => {
              if (event.target.value !== "") set(event.target.value, take);
            }}
            className={input}>
            <option value="">{canEdit ? "Przypisz osobę…" : "Bierze moje dziecko…"}</option>
            {others.map((ref) => (
              <option key={ref} value={ref}>
                {nameOf(ref)}
              </option>
            ))}
          </select>
        )}
      </div>
      <Status state={action.state.error ? action.state : {}} />
    </li>
  );
}

function GearForm({ tripId, doc, item, itemId, categories, onDone }: { tripId: string; doc: Doc; item?: Item; itemId?: string; categories: string[]; onDone: () => void }) {
  const [scope, setScope] = useState<Item["scope"]>(item?.scope ?? "shared");
  const [state, action, pending] = useActionState(async (prev: FormState, form: FormData) => {
    const result = await saveGearItem(tripId, item?.ref ?? null, itemId ?? null, prev, form);
    if (result.ok) onDone();
    return result;
  }, {});
  return (
    <form action={action} className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <input name="title" required defaultValue={item?.title} placeholder="np. namiot, palnik, apteczka" className={`${input} min-w-48 flex-1`} aria-label="Rzecz" />
        <input name="category" required list="gear-categories" defaultValue={item?.category} placeholder="kategoria" className={`${input} w-36`} aria-label="Kategoria" />
        <datalist id="gear-categories">
          {categories.map((each) => (
            <option key={each} value={each} />
          ))}
        </datalist>
        <select name="scope" value={scope} onChange={(event) => setScope(event.target.value as Item["scope"])} className={input} aria-label="Czyja">
          <option value="shared">wspólna</option>
          <option value="personal">osobista</option>
        </select>
        {scope === "personal" && (
          <select name="assignee" defaultValue={item?.scope === "personal" ? (item.assigneeRef ?? "") : ""} className={input} aria-label="Dla kogo">
            <option value="">każdy</option>
            {doc.travelers.map((each) => (
              <option key={each.ref} value={each.ref}>
                tylko {each.name}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <input name="quantity" inputMode="decimal" defaultValue={item?.quantity?.toLocaleString("pl-PL")} placeholder="ile" className={`${input} w-16`} aria-label="Ilość" />
        <input name="unit" defaultValue={item?.unit} placeholder="szt., l" className={`${input} w-20`} aria-label="Jednostka" />
        <input name="weight" inputMode="decimal" defaultValue={item?.weightG === undefined ? undefined : (item.weightG / 1000).toLocaleString("pl-PL")} placeholder="kg za sztukę" className={`${input} w-28`} aria-label="Waga jednej sztuki w kilogramach" />
        <input name="note" defaultValue={item?.note} placeholder="uwagi" className={`${input} min-w-40 flex-1`} aria-label="Uwagi" />
      </div>
      <div className="flex items-center gap-3">
        <button disabled={pending} className="btn-primary btn-sm">
          {pending ? "Zapisuję…" : item ? "Zapisz" : "Dodaj"}
        </button>
        <button type="button" onClick={onDone} className={small}>
          anuluj
        </button>
        <Status state={state} />
      </div>
    </form>
  );
}
