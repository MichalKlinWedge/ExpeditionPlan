import { READINESS_GROUP, READINESS_ORDER, type ReadinessGroup, type ReadinessIssue } from "@expeditionplan/core";
import Link from "next/link";

/**
 * „Gotowość do wyjazdu” na stronie wyjazdu (do jego końca): braki planu z `tripReadiness` w grupach
 * (zwijanych, z linkiem do miejsca poprawki) i — dla organizatora — kto nie ma konta albo aplikacji.
 * Bliżej niż 30 dni do wyjazdu — rozwinięte.
 */

/** Ile pozycji grupy widać; reszta jako licznik. */
const SHOWN = 10;

export type ReadinessPeople = { withoutAccount: string[]; withoutPhone: string[] };

function hrefOf(tripId: string, group: ReadinessGroup, ref: string): string {
  const base = `/trips/${tripId}`;
  switch (group) {
    case "book":
    case "pay":
    case "lodging":
      return `${base}/logistics`;
    case "vault":
      return `${base}/documents`;
    case "task":
      return `${base}/tasks`;
    case "gear":
      return `${base}/gear`;
    case "map":
      return `${base}/item/${encodeURIComponent(ref)}`;
    case "decide":
      return `${base}/plan`;
  }
}

const shortDate = (date: string) => `${Number(date.slice(8))}.${date.slice(5, 7)}`;

export function TripReadiness({ tripId, issues, daysLeft, people }: { tripId: string; issues: ReadinessIssue[]; daysLeft: number; people: ReadinessPeople | null }) {
  const groups = READINESS_ORDER.map((group) => ({ group, items: issues.filter((each) => each.group === group) })).filter((each) => each.items.length > 0);
  const peopleCount = (people?.withoutAccount.length ?? 0) + (people?.withoutPhone.length ?? 0);
  const total = issues.length + peopleCount;
  const overdue = issues.filter((each) => each.overdue).length;
  const when = daysLeft > 1 ? `za ${daysLeft} dni` : daysLeft === 1 ? "jutro" : daysLeft === 0 ? "dziś" : "trwa";
  return (
    <details className="card p-4 text-sm" open={daysLeft <= 30} data-remember="gotowosc">
      <summary className="cursor-pointer font-semibold">
        Gotowość do wyjazdu <span className="font-normal text-zinc-500">· {when}</span>{" "}
        {total === 0 ? (
          <span className="font-normal text-emerald-700 dark:text-emerald-400">· ✓ bez zaległości</span>
        ) : (
          <span className="font-normal text-zinc-500">
            · do zrobienia: {total}
            {overdue > 0 && <span className="text-red-700 dark:text-red-400"> (po terminie: {overdue})</span>}
          </span>
        )}
      </summary>
      <div className="mt-3 flex flex-col gap-3">
        {groups.map(({ group, items }) => (
          <div key={group} className="flex flex-col gap-1">
            <h3 className="font-medium">
              {READINESS_GROUP[group]} <span className="font-normal text-zinc-500">({items.length})</span>
            </h3>
            <ul className="flex flex-col gap-0.5">
              {items.slice(0, SHOWN).map((issue) => (
                <li key={`${group}:${issue.ref}`} className="flex flex-wrap items-baseline gap-x-1.5">
                  <Link href={hrefOf(tripId, group, issue.ref)} className="underline-offset-2 hover:text-sea hover:underline">
                    {issue.title}
                  </Link>
                  {issue.date && (
                    <span className={issue.overdue ? "text-xs text-red-700 dark:text-red-400" : "text-xs text-zinc-500"}>
                      {group === "lodging" ? `noc ${shortDate(issue.date)}` : issue.overdue ? `po terminie (${shortDate(issue.date)})` : `do ${shortDate(issue.date)}`}
                    </span>
                  )}
                </li>
              ))}
              {items.length > SHOWN && <li className="text-xs text-zinc-500">…i {items.length - SHOWN} więcej</li>}
            </ul>
          </div>
        ))}
        {people !== null && peopleCount > 0 && (
          <div className="flex flex-col gap-1">
            <h3 className="font-medium">Uczestnicy</h3>
            {people.withoutAccount.length > 0 && (
              <p>
                Bez konta: {people.withoutAccount.join(", ")} —{" "}
                <Link href={`/trips/${tripId}/people`} className="text-sea underline">
                  zaproś
                </Link>
              </p>
            )}
            {people.withoutPhone.length > 0 && <p>Nie otwierali wyjazdu w telefonie (plan offline): {people.withoutPhone.join(", ")}</p>}
          </div>
        )}
        {total === 0 && <p className="text-zinc-500">Rezerwacje, noclegi, decyzje i zadania przed wyjazdem są załatwione.</p>}
      </div>
    </details>
  );
}
