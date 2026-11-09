import { formatMoney, formatMoneyRange, lineTravelers } from './budget.ts';
import type { TripDocument } from './schemas/trip-document.ts';

/**
 * Dopłata po zadatku: ile z pozycji budżetu zostało do zapłacenia i do kiedy (`balanceDue`), oraz
 * zadanie „Dopłata: …” z tym terminem (`DocTask.budgetLineRef`), które trafia do „Zadań”, „Gotowości”
 * i przypomnień na telefonie jak każde zadanie z datą. Zadanie zakłada i aktualizuje zapis pozycji;
 * pozycja zapłacona w całości zamyka je, a pozycja bez zadatku albo terminu je odkłada.
 */

type Doc = TripDocument;
type Line = Doc['budgetLines'][number];
type Task = Doc['tasks'][number];

export type LineBalance = {
  /** Reszta do zapłaty w walucie pozycji, oszczędnie … wygodnie. */
  lowMinor: number;
  highMinor: number;
  currency: string;
  depositMinor: number;
  /** Termin dopłaty, gdy podany. */
  due?: string;
};

/** Co zostało do zapłaty po zadatku; `null`, gdy nie ma zadatku albo pozycja jest zapłacona. */
export function lineBalance(doc: Doc, line: Line): LineBalance | null {
  if (line.status === 'paid' || !line.depositMinor) return null;
  const times = line.perPerson ? Math.max(lineTravelers(doc, line).length, 1) : 1;
  return {
    lowMinor: Math.max(line.lowMinor * times - line.depositMinor, 0),
    highMinor: Math.max(line.highMinor * times - line.depositMinor, 0),
    currency: line.currency,
    depositMinor: line.depositMinor,
    ...(line.balanceDue !== undefined ? { due: line.balanceDue } : {}),
  };
}

/** „do dopłaty 4254,58 zł do 15.01.2027”. */
export function balanceText(balance: LineBalance): string {
  const amount = formatMoneyRange(balance.lowMinor, balance.highMinor, balance.currency);
  if (balance.highMinor === 0) return 'reszta zapłacona zadatkiem';
  return balance.due === undefined ? `do dopłaty ${amount}` : `do dopłaty ${amount} do ${polishDate(balance.due)}`;
}

const polishDate = (date: string) => `${Number(date.slice(8))}.${date.slice(5, 7)}.${date.slice(0, 4)}`;

export const BALANCE_TASK_PREFIX = 'Dopłata: ';

/**
 * Zadanie dopłaty pozycji po zapisie: nowe, zmienione albo zamknięte; `null`, gdy nic się nie zmienia.
 * Pozycja usunięta (`line` brak) zostawia zadanie bez powiązania, a otwarte odkłada.
 */
export function balanceTask(doc: Doc, lineRef: string, line: Line | undefined, newRef: () => string): { task: Task; op: 'insert' | 'update' } | null {
  const current = doc.tasks.find((task) => task.budgetLineRef === lineRef);
  const balance = line === undefined ? null : lineBalance(doc, line);
  if (line === undefined || balance === null || balance.due === undefined || balance.highMinor === 0) {
    if (current === undefined) return null;
    if (line === undefined) {
      const { budgetLineRef: _line, ...rest } = current;
      return { task: { ...rest, status: current.status === 'open' ? 'dropped' : current.status }, op: 'update' };
    }
    if (current.status !== 'open') return null;
    return { task: { ...current, status: line.status === 'paid' ? 'done' : 'dropped' }, op: 'update' };
  }
  const fields = {
    title: `${BALANCE_TASK_PREFIX}${line.title}`,
    body: `Do dopłaty ${formatMoneyRange(balance.lowMinor, balance.highMinor, balance.currency)} (zadatek ${formatMoney(balance.depositMinor, balance.currency)} zapłacony). Po dopłacie ustaw pozycję budżetu na „zapłacone”.`,
    due: { kind: 'absolute' as const, date: balance.due },
    priority: 'high' as const,
  };
  if (current === undefined) {
    return {
      task: { ref: newRef(), kind: 'todo', status: 'open', assigneeRefs: [], ...fields, budgetLineRef: lineRef, ...(line.bookingRef !== undefined ? { bookingRef: line.bookingRef } : {}) },
      op: 'insert',
    };
  }
  const next: Task = { ...current, ...fields, status: current.status === 'dropped' ? 'open' : current.status };
  return JSON.stringify(next) === JSON.stringify(current) ? null : { task: next, op: 'update' };
}
