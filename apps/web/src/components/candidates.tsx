"use client";

import { formatMoney, type LogisticsCandidates } from "@expeditionplan/core";
import { useState, useTransition } from "react";

import type { FormState } from "@/app/actions";
import { applyCandidates, chooseCandidate } from "@/app/candidates-actions";

/**
 * Etap 4 na stronie logistyki: podgląd szkicu kandydatów (zaznacz decyzje do dodania) i grupy
 * porównania z planu z tabelą i „Wybieram”. Ceny z AI to szacunki — sprawdza się je w ofercie.
 */

const KIND: Record<string, string> = {
  lodging: "nocleg",
  car_rental: "auto",
  transfer: "transfer",
  activity: "atrakcja",
  transit_pass: "karta komunikacji",
  package: "pakiet",
  esim: "eSIM",
  insurance: "ubezpieczenie",
  other: "inne",
};
const BASIS: Record<string, string> = { per_night: "za noc", per_day: "za dzień", per_group: "za grupę", per_person: "za osobę", per_unit: "za sztukę" };

const range = (min: number, max: number, currency: string) => (min === max ? formatMoney(min, currency) : `${formatMoney(min, currency)} – ${formatMoney(max, currency)}`);

export function CandidatesReview({ tripId, runId, info, checks }: { tripId: string; runId: string; info: LogisticsCandidates; checks: string[] }) {
  const [picked, setPicked] = useState<number[]>(info.groups.map((_, i) => i));
  const [result, setResult] = useState<FormState>({});
  const [pending, start] = useTransition();
  const toggle = (i: number) => setPicked((current) => (current.includes(i) ? current.filter((each) => each !== i) : [...current, i]));
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-blue-200 p-4 text-sm dark:border-blue-900">
      <p className="text-xs text-zinc-500">Szkic AI — kandydaci to rodzaje ofert z szacunkiem ceny, nie konkretne obiekty. Zaznacz decyzje, które chcesz porównywać w planie.</p>
      {info.advice.length > 0 && (
        <ul className="list-disc pl-5 text-zinc-600 dark:text-zinc-400">
          {info.advice.map((each, i) => (
            <li key={i}>{each}</li>
          ))}
        </ul>
      )}
      {checks.map((check, i) => (
        <p key={i} className="text-amber-700 dark:text-amber-400">
          ⚠ {check}
        </p>
      ))}
      {info.groups.map((group, i) => (
        <div key={i} className="flex flex-col gap-2">
          <label className="flex items-baseline gap-2 font-medium">
            <input type="checkbox" checked={picked.includes(i)} onChange={() => toggle(i)} />
            {group.title}
            <span className="text-xs font-normal text-zinc-500">
              · {KIND[group.kind]} · {group.area}
              {group.mustHave ? ` · ${group.mustHave}` : ""}
            </span>
          </label>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-zinc-500">
                <tr>
                  <th className="py-1 pr-3 font-normal">Opcja</th>
                  {group.columns.map((column) => (
                    <th key={column} className="py-1 pr-3 font-normal">
                      {column}
                    </th>
                  ))}
                  <th className="py-1 font-normal">Cena (szacunek)</th>
                </tr>
              </thead>
              <tbody>
                {group.candidates.map((candidate, j) => (
                  <tr key={j} className="border-t border-zinc-100 align-top dark:border-zinc-900">
                    <td className="py-1 pr-3">
                      {candidate.recommended ? "★ " : ""}
                      {candidate.label}
                      {candidate.cons.length > 0 && <span className="block text-zinc-500">− {candidate.cons.join("; ")}</span>}
                    </td>
                    {group.columns.map((column, k) => (
                      <td key={column} className="py-1 pr-3">
                        {candidate.values[k] ?? "—"}
                      </td>
                    ))}
                    <td className="py-1 whitespace-nowrap">
                      {range(candidate.priceMinMinor, candidate.priceMaxMinor, candidate.currency)} {BASIS[candidate.priceBasis]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <button
          disabled={pending || picked.length === 0}
          onClick={() => start(async () => setResult(await applyCandidates(tripId, runId, picked)))}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900">
          {pending ? "Dodaję…" : `Dodaj do porównania (${picked.length})`}
        </button>
        {result.error && <span className="text-red-600">{result.error}</span>}
        {result.ok && <span className="text-green-700 dark:text-green-400">{result.ok}</span>}
      </div>
    </div>
  );
}

export type ComparisonRow = {
  variantRef: string;
  label: string;
  recommended: boolean;
  values: string[];
  price: string | null;
  status: string;
  links: { label: string; url: string }[];
  pros: string[];
  cons: string[];
  notes: string[];
};
export type ComparisonGroup = { ref: string; title: string; conditionText?: string; chosenRef?: string; columns: string[]; rows: ComparisonRow[] };

/** Grupa porównania z planu: tabela, linki wyszukiwania, „Wybieram”. */
export function ComparisonTable({ tripId, group, canEdit }: { tripId: string; group: ComparisonGroup; canEdit: boolean }) {
  const [result, setResult] = useState<FormState>({});
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-2 text-sm">
      <div>
        <span className="font-medium">{group.title}</span>
        {group.conditionText && <span className="block text-xs text-zinc-500">{group.conditionText}</span>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-zinc-500">
            <tr>
              <th className="py-1 pr-3 font-normal">Opcja</th>
              {group.columns.map((column) => (
                <th key={column} className="py-1 pr-3 font-normal">
                  {column}
                </th>
              ))}
              <th className="py-1 pr-3 font-normal">Cena</th>
              <th className="py-1 font-normal" />
            </tr>
          </thead>
          <tbody>
            {group.rows.map((row) => {
              const chosen = group.chosenRef === row.variantRef;
              return (
                <tr key={row.variantRef} className={`border-t border-zinc-100 align-top dark:border-zinc-900 ${chosen ? "bg-green-50 dark:bg-green-950" : ""}`}>
                  <td className="py-1 pr-3">
                    {chosen ? "✓ " : row.recommended ? "★ " : ""}
                    <span className={chosen ? "font-medium" : ""}>{row.label}</span>
                    {row.pros.length > 0 && <span className="block text-green-700 dark:text-green-400">+ {row.pros.join("; ")}</span>}
                    {row.cons.length > 0 && <span className="block text-zinc-500">− {row.cons.join("; ")}</span>}
                    {row.notes.length > 0 && <span className="block text-zinc-500">{row.notes.join(" · ")}</span>}
                    {row.links.map((link) => (
                      <a key={link.url} href={link.url} target="_blank" rel="noreferrer" className="mr-2 underline">
                        {link.label}
                      </a>
                    ))}
                  </td>
                  {group.columns.map((column, k) => (
                    <td key={column} className="py-1 pr-3">
                      {row.values[k] ?? "—"}
                    </td>
                  ))}
                  <td className="py-1 pr-3 whitespace-nowrap">{row.price ?? "—"}</td>
                  <td className="py-1 text-right">
                    {canEdit && !chosen && (
                      <button disabled={pending} onClick={() => start(async () => setResult(await chooseCandidate(tripId, group.ref, row.variantRef)))} className="underline disabled:opacity-50">
                        Wybieram
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {result.error && <p className="text-xs text-red-600">{result.error}</p>}
      {result.ok && <p className="text-xs text-green-700 dark:text-green-400">{result.ok}</p>}
    </div>
  );
}
