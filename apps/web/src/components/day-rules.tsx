"use client";

import {
  addConstraint,
  addDayNote,
  addDayVariantGroup,
  addVariant,
  chainRules,
  type Constraint,
  type ConstraintFields,
  dayConstraints,
  dayNotes,
  dayVariantGroups,
  groupVariants,
  itemVariants,
  removeConstraint,
  removeNote,
  removeVariant,
  removeVariantGroup,
  type RulesEdit,
  type ScheduleWarning,
  setDayEnd,
  setDayStart,
  setDayScenarios,
  setItemVariants,
  type TripDocument,
  type Note,
  type NoteFields,
  updateConstraint,
  updateNote,
  updateVariant,
  updateVariantGroup,
  type Variant,
  type VariantGroup,
} from "@expeditionplan/core";
import { uuidv7 } from "@expeditionplan/sync";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { BallotIcon } from "@/components/icons";
import { DialogTitle } from "@/components/dialog-title";
import { IconAction } from "@/components/icon-action";

/**
 * Warianty, ograniczenia i notatki dnia w edytorze planu (MVP-3). Zmiany idą przez `plan-rules`
 * w packages/core — widok planu przelicza dzień od razu i zapisuje w tle (`onRules`).
 * Bez `onRules` (widz) — tylko odczyt.
 */

type Doc = TripDocument;
/** Zmiana wariantów albo ograniczeń; funkcja może rzucić błąd z polskim komunikatem (np. „co najmniej dwa warianty”). */
export type OnRules = (build: (doc: Doc) => RulesEdit | null) => void;

const CONDITION: Record<VariantGroup["conditionKind"], string> = {
  choice: "wybór",
  weather: "pogoda",
  closure: "zamknięte",
  schedule_slip: "opóźnienie",
  availability: "dostępność miejsc",
  wellbeing: "samopoczucie",
};

// `min-w-0`: lista wyboru ma szerokość najdłuższej opcji i bez tego rozpycha kartę na telefonie.
const input = "field min-w-0 px-2 py-1 text-sm";

/** Termin decyzji: „15:00” (godzina dnia) albo „2026-12-28 20:00” (inna chwila, np. wieczór przed). */
const deadline = (decideBy: NonNullable<VariantGroup["decideBy"]>) => ("time" in decideBy ? decideBy.time : decideBy.local.replace("T", " "));
const label = "flex min-w-0 flex-col gap-1 text-xs text-zinc-500";

// --- Warianty --------------------------------------------------------------------------------

type VariantsProps = {
  doc: Doc;
  dayRef: string;
  /** Warianty pokazane teraz (wybór w widoku, potem `chosenRef`, rekomendowany, pierwszy). */
  active: Set<string>;
  onChoose: (groupRef: string, variantRef: string) => void;
  onRules: OnRules | null;
  /** Warianty wybrane w terenie na telefonie (groupRef → variantRef). */
  field?: Record<string, string>;
  /** Strona „Głosowanie” (członkowie wyjazdu); przy wyborach z otwartym głosowaniem jest do niej przycisk. */
  votesHref?: string;
};

export function DayVariants({ doc, dayRef, active, onChoose, onRules, field, votesHref }: VariantsProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const groups = dayVariantGroups(doc, dayRef);
  return (
    <>
      {groups.map((group) => {
        const variants = groupVariants(doc, group.ref);
        const chosen = variants.find((variant) => variant.ref === group.chosenRef);
        const facts = [
          CONDITION[group.conditionKind] + (group.conditionText ? `: ${group.conditionText}` : ""),
          group.decideBy ? `decyzja do ${deadline(group.decideBy)}` : null,
          chosen ? `wybrano: ${chosen.label}` : "bez decyzji",
          field?.[group.ref] ? `w terenie: ${variants.find((variant) => variant.ref === field[group.ref])?.label ?? "?"}` : null,
        ].filter((each) => each !== null);
        return (
          <div key={group.ref} className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-zinc-500">{group.title}:</span>
              <VariantChoice group={group} variants={variants} active={active} onChoose={onChoose} />
              {onRules && (
                <IconAction kind={editing === group.ref ? "close" : "edit"} tip={editing === group.ref ? "zamknij edycję" : undefined} onClick={() => setEditing(editing === group.ref ? null : group.ref)} />
              )}
              {votesHref && group.votingOpen === true && variants.length > 1 && (
                <Link href={`${votesHref}#glos-${group.ref}`} className="btn-mini btn-icon" title="głosowanie" aria-label="głosowanie">
                  <BallotIcon className="size-3.5" />
                </Link>
              )}
            </div>
            <p className="text-xs text-zinc-500">
              {facts.join(" · ")}
              {group.rationale ? ` — ${group.rationale}` : ""}
            </p>
            {onRules && editing === group.ref && <GroupEditor doc={doc} group={group} onRules={onRules} onDone={() => setEditing(null)} />}
          </div>
        );
      })}
      {onRules &&
        (adding ? (
          <NewGroup
            onCancel={() => setAdding(false)}
            onAdd={(fields, labels) => {
              onRules((current) => addDayVariantGroup(current, dayRef, uuidv7, fields, labels));
              setAdding(false);
            }}
          />
        ) : (
          <button onClick={() => setAdding(true)} className="btn-mini self-start">
            + wariant dnia (plan B)
          </button>
        ))}
    </>
  );
}

/**
 * Wybór wariantu jak na telefonie: widać tylko wybrany wariant, a „Zmień” otwiera okno z wariantami
 * grupy (★ = polecany, krótki opis, plusy i minusy); kliknięcie wariantu wybiera go i zamyka okno.
 */
function VariantChoice({ group, variants, active, onChoose }: { group: VariantGroup; variants: Variant[]; active: Set<string>; onChoose: (groupRef: string, variantRef: string) => void }) {
  const [open, setOpen] = useState(false);
  const chosen = variants.find((variant) => active.has(variant.ref));
  const name = (variant: Variant) => `${variant.label}${variant.recommended ? " ★" : ""}`;
  return (
    <>
      <span title={chosen?.summary} className="rounded-full border-2 border-sea bg-sea-light px-3 py-1 font-semibold text-sea dark:bg-sea/20 dark:text-teal-300">
        {chosen === undefined ? "nie wybrano" : name(chosen)}
      </span>
      {variants.length > 1 && (
        <IconAction kind="change" onClick={() => setOpen(true)} />
      )}
      {open && (
        <VariantDialog
          title={group.title}
          onClose={() => setOpen(false)}
          options={variants.map((variant) => ({ variant, name: name(variant), on: active.has(variant.ref) }))}
          onPick={(variantRef) => {
            setOpen(false);
            if (!active.has(variantRef)) onChoose(group.ref, variantRef);
          }}
        />
      )}
    </>
  );
}

function VariantDialog({ title, options, onPick, onClose }: { title: string; options: { variant: Variant; name: string; on: boolean }[]; onPick: (variantRef: string) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      onClick={(event) => {
        // Kliknięcie w tło (poza oknem) zamyka, jak na telefonie.
        if (event.target === dialog.current) dialog.current?.close();
      }}
      className="card dialog flex flex-col gap-2">
      <DialogTitle onClose={() => dialog.current?.close()}>
        <h2>{title}</h2>
      </DialogTitle>
      <ul className="flex flex-col">
        {options.map(({ variant, name, on }) => (
          <li key={variant.ref} className="border-b border-zinc-200 last:border-b-0 dark:border-zinc-800">
            <button type="button" onClick={() => onPick(variant.ref)} aria-pressed={on} className={`flex w-full flex-col gap-0.5 rounded px-2 py-2.5 text-left hover:bg-sea-light dark:hover:bg-sea/20 ${on ? "font-semibold text-sea dark:text-teal-300" : ""}`}>
              <span>
                {on ? "✓ " : ""}
                {name}
              </span>
              {variant.summary && <span className="font-normal text-zinc-600 dark:text-zinc-400">{variant.summary}</span>}
              {variant.pros.length > 0 && <span className="font-normal text-zinc-500">+ {variant.pros.join(" · ")}</span>}
              {variant.cons.length > 0 && <span className="font-normal text-zinc-500">− {variant.cons.join(" · ")}</span>}
            </button>
          </li>
        ))}
      </ul>
    </dialog>
  );
}

function NewGroup({ onAdd, onCancel }: { onAdd: (fields: Pick<VariantGroup, "title" | "conditionKind">, labels: [string, string]) => void; onCancel: () => void }) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<VariantGroup["conditionKind"]>("weather");
  const [first, setFirst] = useState("A · obecny plan");
  const [second, setSecond] = useState("B");
  return (
    <form
      className="flex flex-col gap-2 panel p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (title.trim() === "" || first.trim() === "" || second.trim() === "") return;
        onAdd({ title: title.trim(), conditionKind: kind }, [first, second]);
      }}>
      <p className="text-xs text-zinc-500">Punkty dnia zostają w obu wariantach. Potem przy punkcie wybierz „tylko A” albo „tylko B”, a nowe punkty planu B dodaj i przypisz do B.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className={label}>
          Czego dotyczy wybór
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="np. Pogoda w dniu 3" className={input} required />
        </label>
        <label className={label}>
          Warunek
          <select value={kind} onChange={(event) => setKind(event.target.value as VariantGroup["conditionKind"])} className={input}>
            {Object.entries(CONDITION).map(([key, name]) => (
              <option key={key} value={key}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Wariant A
          <input value={first} onChange={(event) => setFirst(event.target.value)} className={input} required />
        </label>
        <label className={label}>
          Wariant B
          <input value={second} onChange={(event) => setSecond(event.target.value)} className={input} required />
        </label>
      </div>
      <div className="flex gap-2">
        <button className="btn-secondary btn-sm">Dodaj warianty</button>
        <button type="button" onClick={onCancel} className="btn-secondary btn-sm">
          Anuluj
        </button>
      </div>
    </form>
  );
}

function GroupEditor({ doc, group, onRules, onDone }: { doc: Doc; group: VariantGroup; onRules: OnRules; onDone: () => void }) {
  const variants = groupVariants(doc, group.ref);
  const [title, setTitle] = useState(group.title);
  const [kind, setKind] = useState(group.conditionKind);
  const [condition, setCondition] = useState(group.conditionText ?? "");
  const [decideBy, setDecideBy] = useState(group.decideBy && "time" in group.decideBy ? group.decideBy.time : "");
  const [rationale, setRationale] = useState(group.rationale ?? "");
  const [chosen, setChosen] = useState(group.chosenRef ?? "");
  const [labels, setLabels] = useState<Record<string, string>>(Object.fromEntries(variants.map((variant) => [variant.ref, variant.label])));
  const [recommended, setRecommended] = useState(variants.find((variant) => variant.recommended)?.ref ?? "");
  const [extra, setExtra] = useState("");
  const [keep, setKeep] = useState(group.chosenRef ?? variants.find((variant) => variant.recommended)?.ref ?? variants[0]?.ref ?? "");
  const dated = group.decideBy !== undefined && !("time" in group.decideBy);

  return (
    <form
      className="flex flex-col gap-3 panel p-3"
      onSubmit={(event) => {
        event.preventDefault();
        onRules((current) =>
          chainRules(current, [
            (next) =>
              updateVariantGroup(next, group.ref, {
                title: title.trim() || group.title,
                conditionKind: kind,
                conditionText: condition.trim(),
                rationale: rationale.trim(),
                chosenRef: chosen || undefined,
                // Termin z datą (inny dzień) zostaje, dopóki nie wpisze się godziny tego dnia.
                ...(dated && decideBy === "" ? {} : { decideBy: decideBy ? { time: decideBy } : undefined }),
              }),
            ...variants.map((variant) => (next: Doc) => {
              const text = labels[variant.ref]?.trim();
              const changedLabel = text && text !== variant.label;
              const changedRecommended = (recommended === variant.ref) !== (variant.recommended ?? false);
              if (!changedLabel && !changedRecommended) return null;
              return updateVariant(next, variant.ref, { ...(changedLabel ? { label: text } : {}), ...(changedRecommended ? { recommended: recommended === variant.ref } : {}) });
            }),
            (next) => (extra.trim() === "" ? null : addVariant(next, group.ref, uuidv7, extra)),
          ]),
        );
        onDone();
      }}>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className={label}>
          Czego dotyczy wybór
          <input value={title} onChange={(event) => setTitle(event.target.value)} className={input} />
        </label>
        <label className={label}>
          Warunek
          <select value={kind} onChange={(event) => setKind(event.target.value as VariantGroup["conditionKind"])} className={input}>
            {Object.entries(CONDITION).map(([key, name]) => (
              <option key={key} value={key}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Kiedy który wariant (opis warunku)
          <input value={condition} onChange={(event) => setCondition(event.target.value)} placeholder="np. jeśli od rana pada" className={input} />
        </label>
        <label className={label}>
          Decyzja najpóźniej o (godzina tego dnia)
          <input type="time" value={decideBy} onChange={(event) => setDecideBy(event.target.value)} className={input} />
          {dated && decideBy === "" && group.decideBy && <span>teraz: {deadline(group.decideBy)}</span>}
        </label>
        <label className={`${label} sm:col-span-2`}>
          Uzasadnienie
          <input value={rationale} onChange={(event) => setRationale(event.target.value)} placeholder="np. A, bo dzieci chcą sandboardu" className={input} />
        </label>
      </div>

      <table className="text-sm">
        <thead className="text-left text-xs text-zinc-500">
          <tr>
            <th className="font-normal">Wariant</th>
            <th className="px-2 font-normal" title="Rekomendowany — liczy się, dopóki nie ma decyzji">
              ★
            </th>
            <th className="px-2 font-normal">wybrany</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {variants.map((variant) => (
            <tr key={variant.ref}>
              <td className="py-0.5">
                <input value={labels[variant.ref] ?? ""} onChange={(event) => setLabels({ ...labels, [variant.ref]: event.target.value })} className={`${input} w-full`} aria-label="Etykieta wariantu" />
              </td>
              <td className="px-2 text-center">
                <input type="radio" name={`rec-${group.ref}`} checked={recommended === variant.ref} onChange={() => setRecommended(variant.ref)} aria-label="Rekomendowany" />
              </td>
              <td className="px-2 text-center">
                <input type="radio" name={`chosen-${group.ref}`} checked={chosen === variant.ref} onChange={() => setChosen(variant.ref)} aria-label="Wybrany" />
              </td>
              <td>
                {variants.length > 2 && (
                  <IconAction kind="remove"
                    onClick={() => window.confirm(`Usunąć wariant „${variant.label}”? Punkty tylko z tego wariantu wrócą do puli.`) && onRules((current) => removeVariant(current, variant.ref))} />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500">
        <label className="flex items-center gap-1">
          <input type="radio" name={`rec-${group.ref}`} checked={recommended === ""} onChange={() => setRecommended("")} /> bez rekomendacji
        </label>
        <label className="flex items-center gap-1">
          <input type="radio" name={`chosen-${group.ref}`} checked={chosen === ""} onChange={() => setChosen("")} /> decyzja jeszcze nie zapadła
        </label>
      </div>
      <label className={label}>
        Nowy wariant
        <input value={extra} onChange={(event) => setExtra(event.target.value)} placeholder="np. C · leniwy dzień" className={input} />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-primary btn-sm">Zapisz</button>
        <button type="button" onClick={onDone} className="btn-secondary btn-sm">
          Anuluj
        </button>
        <span className="ml-auto flex items-center gap-1 text-xs text-zinc-500">
          Koniec wyboru, zostaje:
          <select value={keep} onChange={(event) => setKeep(event.target.value)} className={`${input} max-w-48`} aria-label="Wariant, który zostaje">
            {variants.map((variant) => (
              <option key={variant.ref} value={variant.ref}>
                {variant.label}
              </option>
            ))}
          </select>
          <IconAction
            kind="remove"
            tip="Usuń grupę (zostaje wybrany wariant)"
            onClick={() => {
              const kept = variants.find((variant) => variant.ref === keep);
              if (kept && window.confirm(`Usunąć wybór „${group.title}”? W planie zostaje „${kept.label}”, punkty innych wariantów wrócą do puli.`)) {
                onRules((current) => removeVariantGroup(current, group.ref, keep));
                onDone();
              }
            }}
          />
        </span>
      </div>
    </form>
  );
}

/** Przy punkcie dnia z wariantami: w których wariantach jest (osobno dla każdej grupy, kilka naraz). */
export function ItemVariants({ doc, dayRef, itemRef, onRules }: { doc: Doc; dayRef: string; itemRef: string; onRules: OnRules }) {
  return dayVariantGroups(doc, dayRef).map((group) => <ItemVariantPicker key={group.ref} doc={doc} group={group} itemRef={itemRef} onRules={onRules} />);
}

function ItemVariantPicker({ doc, group, itemRef, onRules }: { doc: Doc; group: VariantGroup; itemRef: string; onRules: OnRules }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  const variants = groupVariants(doc, group.ref);
  const current = itemVariants(doc, itemRef, group.ref);
  const has = (ref: string) => current === null || current.includes(ref);
  const summary = current === null ? "wszystkie warianty" : `tylko: ${variants.filter((variant) => current.includes(variant.ref)).map((variant) => variant.label).join(", ")}`;
  const toggle = (ref: string, on: boolean) => {
    const next = variants.filter((variant) => (variant.ref === ref ? on : has(variant.ref))).map((variant) => variant.ref);
    if (next.length > 0) onRules((latest) => setItemVariants(latest, itemRef, group.ref, next));
  };
  return (
    <span ref={box} className="relative ml-2 inline-block">
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        title={`${group.title}: ${summary}`}
        aria-label={`W których wariantach: ${group.title}`}
        aria-expanded={open}
        className="max-w-48 truncate rounded border border-zinc-300 bg-transparent px-1 text-left text-xs text-zinc-500 dark:border-zinc-700">
        {summary} ▾
      </button>
      {open && (
        <span className="absolute left-0 top-full z-20 mt-1 flex w-max max-w-80 flex-col gap-1 rounded border border-zinc-300 bg-white p-2 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          <span className="text-zinc-500">{group.title}</span>
          {variants.map((variant) => (
            <label key={variant.ref} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={has(variant.ref)}
                disabled={has(variant.ref) && variants.filter((each) => has(each.ref)).length === 1}
                onChange={(event) => toggle(variant.ref, event.target.checked)}
              />
              {variant.label}
            </label>
          ))}
          {current !== null && (
            <button type="button" onClick={() => onRules((latest) => setItemVariants(latest, itemRef, group.ref, null))} className="btn-mini self-start">
              we wszystkich
            </button>
          )}
        </span>
      )}
    </span>
  );
}

// --- Początek dnia ----------------------------------------------------------------------------

/** Planowany początek dnia (wyjście z noclegu); zapis po wyjściu z pola, puste = od pierwszej godziny planu. */
export function DayStartField({ dayRef, value, onRules }: { dayRef: string; value: string | undefined; onRules: OnRules | null }) {
  if (onRules === null) return null;
  return (
    <label className="flex flex-wrap items-center gap-2 self-start text-xs text-zinc-500">
      Planowany początek dnia
      <input
        key={value ?? ""}
        type="time"
        defaultValue={value ?? ""}
        className={input}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        onBlur={(event) => {
          if (event.target.validity.badInput) event.target.value = value ?? "";
          else onRules((doc) => setDayStart(doc, dayRef, event.target.value || undefined));
        }}
      />
      <span>punkty bez stałej godziny nie ruszą wcześniej; stała godzina przed nim zaczyna dzień wcześniej; puste pole = od pierwszej godziny planu</span>
    </label>
  );
}

// --- Koniec dnia ------------------------------------------------------------------------------

/** Zapis po wyjściu z pola: niepełna godzina wraca do poprzedniej, a puste pole wyłącza ostrzeżenie. */
export function DayEndField({ dayRef, value, onRules }: { dayRef: string; value: string | undefined; onRules: OnRules | null }) {
  if (onRules === null) return null;
  return (
    <label className="flex flex-wrap items-center gap-2 self-start text-xs text-zinc-500">
      Planowany koniec dnia
      <input
        key={value ?? ""}
        type="time"
        defaultValue={value ?? ""}
        className={input}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        onBlur={(event) => {
          if (event.target.validity.badInput) event.target.value = value ?? "";
          else onRules((doc) => setDayEnd(doc, dayRef, event.target.value || undefined));
        }}
      />
      <span>puste pole = bez ostrzeżenia</span>
    </label>
  );
}

// --- Scenariusze dnia ------------------------------------------------------------------------

/** Wyłączone: dzień liczy się krótszym czasem, a plan nie pokazuje przełącznika scenariuszy. */
export function DayScenariosField({ dayRef, on, onRules }: { dayRef: string; on: boolean; onRules: OnRules | null }) {
  if (onRules === null) return null;
  return (
    <label className="flex flex-wrap items-center gap-2 self-start text-xs text-zinc-500">
      <input type="checkbox" checked={on} onChange={(event) => onRules((doc) => setDayScenarios(doc, dayRef, event.target.checked))} />
      Scenariusze optymistyczny / pesymistyczny
      {!on && <span>(wyłączone: liczą się krótsze czasy)</span>}
    </label>
  );
}

// --- Ograniczenia ----------------------------------------------------------------------------

const KIND: Record<Constraint["kind"], string> = {
  arrive_before: "dotrzeć przed",
  depart_before: "wyjechać najpóźniej o",
  latest_start: "zacząć najpóźniej o",
  finish_before_sunset: "skończyć przed zachodem słońca",
  no_driving_after_dark: "bez jazdy po zmroku",
  min_time_at: "co najmniej tyle czasu na miejscu",
  must_be_open: "musi być otwarte",
  office_open_at: "biuro otwarte o godzinie",
  other: "inne (opis)",
};
/** Czego wymaga rodzaj: punktu, godziny, minut. Silnik sprawdza wszystkie poza „otwarte”, „biuro” i „inne”. */
const NEEDS: Record<Constraint["kind"], { item?: true; time?: true; minutes?: true; trip?: true }> = {
  arrive_before: { item: true, time: true },
  depart_before: { item: true, time: true },
  latest_start: { item: true, time: true },
  finish_before_sunset: { trip: true },
  no_driving_after_dark: { trip: true },
  min_time_at: { item: true, minutes: true },
  must_be_open: { item: true },
  office_open_at: { item: true, time: true },
  other: { trip: true },
};

type ConstraintsProps = {
  doc: Doc;
  dayRef: string;
  /** Punkty dnia w kolejności z silnika — do wyboru, czego dotyczy ograniczenie. */
  items: { ref: string; title: string }[];
  warnings: ScheduleWarning[];
  onRules: OnRules | null;
};

export function DayConstraints({ doc, dayRef, items, warnings, onRules }: ConstraintsProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const titles = new Map(doc.items.map((item) => [item.ref, item.title]));
  const tripWide = doc.constraints.flatMap((constraint, index) =>
    constraint.dayRef === undefined && constraint.itemRef === undefined && constraint.bookingRef === undefined ? [{ constraint, index }] : [],
  );
  const list = [...tripWide, ...dayConstraints(doc, dayRef)];
  const broken = (index: number) => warnings.find((warning) => warning.kind === "constraint" && warning.constraintIndex === index);
  if (list.length === 0 && onRules === null) return null;
  const open = list.some(({ index }) => broken(index) !== undefined);

  return (
    <details className="text-sm" open={open || undefined}>
      <summary className="cursor-pointer text-zinc-500">
        Ograniczenia ({list.length}){open ? " — naruszone" : ""}
      </summary>
      <ul className="mt-2 flex flex-col gap-1.5">
        {list.map(({ constraint, index }) => {
          const ref = constraint.ref ?? `#${index}`;
          const violation = broken(index);
          const details = [
            constraint.itemRef ? `„${titles.get(constraint.itemRef) ?? constraint.itemRef}”` : null,
            constraint.time ?? null,
            constraint.minutes !== undefined ? `${constraint.minutes} min` : null,
          ].filter((each) => each !== null);
          return (
            <li key={ref} className="flex flex-col gap-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className={`rounded px-1.5 text-xs ${constraint.severity === "hard" ? "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200" : "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"}`}>
                  {constraint.severity === "hard" ? "twarde" : "miękkie"}
                </span>
                <span className="font-medium">{KIND[constraint.kind]}</span>
                {details.length > 0 && <span className="text-zinc-600 dark:text-zinc-400">{details.join(" · ")}</span>}
                {constraint.reason && <span className="text-zinc-500">— {constraint.reason}</span>}
                {constraint.dayRef === undefined && constraint.itemRef === undefined && <span className="text-xs text-zinc-500">(cały wyjazd)</span>}
                {violation && <span className={`text-xs ${violation.severity === "hard" ? "msg-error" : "text-amber-600"}`}>naruszone o {violation.minutes} min</span>}
                {onRules && constraint.ref && (
                  <span className="text-xs text-zinc-500">
                    <IconAction kind={editing === ref ? "close" : "change"} onClick={() => setEditing(editing === ref ? null : ref)} />
                    <IconAction kind="remove" onClick={() => window.confirm(`Usunąć ograniczenie „${KIND[constraint.kind]}”?`) && onRules((current) => removeConstraint(current, constraint.ref!))} />
                  </span>
                )}
              </div>
              {onRules && constraint.ref && editing === ref && (
                <ConstraintForm
                  dayRef={dayRef}
                  items={items}
                  initial={constraint}
                  submit="Zapisz"
                  onCancel={() => setEditing(null)}
                  onSave={(fields) => {
                    onRules((current) => updateConstraint(current, constraint.ref!, fields));
                    setEditing(null);
                  }}
                />
              )}
            </li>
          );
        })}
      </ul>
      {onRules && (
        <div className="mt-2">
          {editing === "new" ? (
            <ConstraintForm
              dayRef={dayRef}
              items={items}
              submit="Dodaj"
              onCancel={() => setEditing(null)}
              onSave={(fields) => {
                onRules((current) => addConstraint(current, uuidv7, fields));
                setEditing(null);
              }}
            />
          ) : (
            <button onClick={() => setEditing("new")} className="btn-mini">
              + ograniczenie
            </button>
          )}
        </div>
      )}
    </details>
  );
}

type FormProps = {
  dayRef: string;
  items: { ref: string; title: string }[];
  initial?: Constraint;
  submit: string;
  onSave: (fields: ConstraintFields) => void;
  onCancel: () => void;
};

function ConstraintForm({ dayRef, items, initial, submit, onSave, onCancel }: FormProps) {
  const [kind, setKind] = useState<Constraint["kind"]>(initial?.kind ?? "arrive_before");
  const [itemRef, setItemRef] = useState(initial?.itemRef ?? "");
  const [time, setTime] = useState(initial?.time ?? "");
  const [minutes, setMinutes] = useState(initial?.minutes?.toString() ?? "");
  const [severity, setSeverity] = useState<Constraint["severity"]>(initial?.severity ?? "hard");
  const [reason, setReason] = useState(initial?.reason ?? "");
  const [wholeTrip, setWholeTrip] = useState(initial !== undefined && initial.dayRef === undefined && initial.itemRef === undefined && initial.bookingRef === undefined);
  const [problem, setProblem] = useState<string | null>(null);
  const needs = NEEDS[kind];
  // Punkt spoza listy (np. w wariancie, który teraz nie jest pokazany) zostaje do wyboru.
  const options = itemRef && !items.some((item) => item.ref === itemRef) ? [...items, { ref: itemRef, title: "(punkt spoza widoku)" }] : items;

  return (
    <form
      className="flex flex-col gap-2 panel p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (needs.item && itemRef === "") return setProblem("Wybierz punkt, którego dotyczy ograniczenie.");
        if (needs.time && !/^\d{2}:\d{2}$/.test(time)) return setProblem("Podaj godzinę.");
        const count = minutes.trim() === "" ? undefined : Math.round(Number(minutes));
        if (needs.minutes && (count === undefined || !(count > 0))) return setProblem("Podaj liczbę minut.");
        const trip = needs.trip && wholeTrip && itemRef === "";
        onSave({
          kind,
          // Ograniczenie zostaje przy dniu także z punktem — tak jak w planach wzorcowych.
          ...(trip ? {} : { dayRef }),
          ...(itemRef && (needs.item || needs.trip) ? { itemRef } : {}),
          ...(initial?.bookingRef ? { bookingRef: initial.bookingRef } : {}),
          ...(needs.time && time ? { time, ...(initial?.tz ? { tz: initial.tz } : {}) } : {}),
          ...((needs.minutes || kind === "finish_before_sunset") && count !== undefined && !Number.isNaN(count) ? { minutes: count } : {}),
          severity,
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        });
      }}>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className={label}>
          Rodzaj
          <select value={kind} onChange={(event) => setKind(event.target.value as Constraint["kind"])} className={input}>
            {Object.entries(KIND).map(([key, name]) => (
              <option key={key} value={key}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Punkt
          <select value={itemRef} onChange={(event) => setItemRef(event.target.value)} className={input}>
            <option value="">{needs.item ? "— wybierz —" : kind === "finish_before_sunset" ? "— ostatni punkt dnia —" : "— cały dzień —"}</option>
            {options.map((item) => (
              <option key={item.ref} value={item.ref}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
        {needs.time && (
          <label className={label}>
            Godzina
            <input type="time" value={time} onChange={(event) => setTime(event.target.value)} className={input} />
          </label>
        )}
        {(needs.minutes || kind === "finish_before_sunset") && (
          <label className={label}>
            {kind === "finish_before_sunset" ? "Ile minut przed zachodem (opcjonalnie)" : "Minuty"}
            <input type="number" min={0} value={minutes} onChange={(event) => setMinutes(event.target.value)} className={input} />
          </label>
        )}
        <label className={label}>
          Waga
          <select value={severity} onChange={(event) => setSeverity(event.target.value as Constraint["severity"])} className={input}>
            <option value="hard">twarde — dzień się nie spina</option>
            <option value="soft">miękkie — ostrzeżenie</option>
          </select>
        </label>
        <label className={label}>
          Powód
          <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="np. bez latarek na szutrze" className={input} />
        </label>
      </div>
      {needs.trip && itemRef === "" && (
        <label className="flex items-center gap-2 text-xs text-zinc-500">
          <input type="checkbox" checked={wholeTrip} onChange={(event) => setWholeTrip(event.target.checked)} /> dotyczy całego wyjazdu (każdego dnia)
        </label>
      )}
      {(kind === "must_be_open" || kind === "office_open_at" || kind === "other") && (
        <p className="text-xs text-zinc-500">
          {kind === "must_be_open" ? "Silnik sprawdza godziny otwarcia przy punkcie z miejscem z OSM." : "Tego silnik nie sprawdza — zostaje jako przypomnienie w planie."}
        </p>
      )}
      {problem && <p className="text-xs msg-error">{problem}</p>}
      <div className="flex gap-2">
        <button className="btn-secondary btn-sm">{submit}</button>
        <button type="button" onClick={onCancel} className="btn-secondary btn-sm">
          Anuluj
        </button>
      </div>
    </form>
  );
}

// --- Notatki dnia ----------------------------------------------------------------------------

const NOTE_KIND: Partial<Record<Note["kind"], string>> = { info: "informacja", tip: "wskazówka", warning: "uwaga", safety: "bezpieczeństwo", practical: "praktyczne", rationale: "uzasadnienie", slack_audit: "ocena zapasu" };
/** Rodzaje do wyboru w formularzu (uzasadnienie i ocenę zapasu pisze AI albo import). */
const NOTE_KINDS: Note["kind"][] = ["info", "tip", "warning", "safety", "practical"];

/** Notatki dnia: odczyt, a w edycji — zmiana treści, usunięcie i nowa notatka. */
export function DayNotes({ doc, dayRef, onRules }: { doc: Doc; dayRef: string; onRules: OnRules | null }) {
  const [editing, setEditing] = useState<string | null>(null);
  const notes = dayNotes(doc, dayRef);
  if (notes.length === 0 && onRules === null) return null;
  return (
    <details className="text-sm" open={onRules !== null || undefined}>
      <summary className="cursor-pointer text-zinc-500">Notatki dnia ({notes.length})</summary>
      <ul className="mt-2 flex flex-col gap-2">
        {notes.map((note, index) => {
          const key = note.ref ?? `#${index}`;
          return (
            <li key={key} className="flex flex-col gap-1">
              {editing === key && note.ref ? (
                <NoteForm
                  initial={note}
                  submit="Zapisz"
                  onCancel={() => setEditing(null)}
                  onSave={(fields) => {
                    onRules?.((current) => updateNote(current, note.ref!, fields));
                    setEditing(null);
                  }}
                />
              ) : (
                <div className="whitespace-pre-line text-zinc-600 dark:text-zinc-400">
                  {note.kind !== "info" && NOTE_KIND[note.kind] ? <span className="mr-1 rounded bg-zinc-100 px-1 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{NOTE_KIND[note.kind]}</span> : null}
                  {note.title ? <span className="font-medium">{note.title}: </span> : null}
                  {note.body}
                  {onRules && note.ref && (
                    <span className="ml-1 text-xs text-zinc-500">
                      <IconAction kind="change" onClick={() => setEditing(key)} />
                      <IconAction kind="remove" onClick={() => window.confirm("Usunąć tę notatkę?") && onRules((current) => removeNote(current, note.ref!))} />
                    </span>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {onRules && (
        <div className="mt-2">
          {editing === "new" ? (
            <NoteForm
              submit="Dodaj"
              onCancel={() => setEditing(null)}
              onSave={(fields) => {
                onRules((current) => addDayNote(current, uuidv7, dayRef, fields));
                setEditing(null);
              }}
            />
          ) : (
            <button onClick={() => setEditing("new")} className="btn-mini">
              + notatka
            </button>
          )}
        </div>
      )}
    </details>
  );
}

function NoteForm({ initial, submit, onSave, onCancel }: { initial?: Note; submit: string; onSave: (fields: NoteFields) => void; onCancel: () => void }) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [kind, setKind] = useState<Note["kind"]>(initial?.kind ?? "info");
  const kinds = NOTE_KINDS.includes(kind) ? NOTE_KINDS : [...NOTE_KINDS, kind];
  return (
    <form
      className="flex flex-col gap-2 panel p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (body.trim() === "") return;
        onSave({ kind, body: body.trim(), ...(title.trim() ? { title: title.trim() } : {}) });
      }}>
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <label className={label}>
          Tytuł (opcjonalnie)
          <input value={title} onChange={(event) => setTitle(event.target.value)} className={input} />
        </label>
        <label className={label}>
          Rodzaj
          <select value={kind} onChange={(event) => setKind(event.target.value as Note["kind"])} className={input}>
            {kinds.map((each) => (
              <option key={each} value={each}>
                {NOTE_KIND[each] ?? each}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className={label}>
        Treść
        <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={3} required className={input} />
      </label>
      <div className="flex gap-3">
        <button className="btn-secondary btn-sm">{submit}</button>
        <button type="button" onClick={onCancel} className="btn-secondary btn-sm">
          Anuluj
        </button>
      </div>
    </form>
  );
}
