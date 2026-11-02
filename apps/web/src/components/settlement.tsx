import { formatMoney, settle, toBase, type TripDocument } from "@expeditionplan/core";

/**
 * Rozliczenie „kto komu ile” na webie (tylko odczyt — przelewy „Oddane” zaznacza się w telefonie,
 * w trasie). Te same zasady co w telefonie (`settle`): podziały wydatków, dzieci do opiekuna,
 * osobno i rodzinami, wykonane przelewy pomniejszają salda.
 */

type Row = Record<string, unknown> & { id: string; deleted_at: string | null };

export function Settlement({ doc, tables }: { doc: TripDocument; tables: Record<string, Row[] | undefined> }) {
  const alive = (table: string) => (tables[table] ?? []).filter((row) => row.deleted_at === null);
  const travelers = alive("travelers").map((row) => ({ id: row.id, name: String(row.name), household: (row.household as string | null) ?? null, guardianId: (row.guardian_id as string | null) ?? null }));
  const expenses = alive("expenses").map((row) => ({ id: row.id, payerId: (row.payer_traveler_id as string | null) ?? null, amountMinor: Number(row.amount_minor), currency: String(row.currency) }));
  if (travelers.length < 2 || expenses.length === 0) return null;
  const input = {
    travelers,
    expenses,
    splits: alive("expense_splits").map((row) => ({ expenseId: String(row.expense_id), travelerId: String(row.traveler_id), weight: (row.weight as number | null) ?? 1 })),
    payments: alive("settlements").map((row) => ({ fromId: String(row.from_traveler_id), toId: String(row.to_traveler_id), amountMinor: Number(row.amount_minor), currency: String(row.currency) })),
    toBase: (amount: number, currency: string) => toBase(doc, amount, currency),
  };
  const money = (minor: number) => formatMoney(minor, doc.trip.baseCurrency);
  const views = [{ label: "Osobno", result: settle(input) }, ...(travelers.some((each) => each.household) ? [{ label: "Rodzinami", result: settle({ ...input, households: true }) }] : [])];
  const skipped = views[0]!.result.skipped;

  return (
    <div className="flex flex-col gap-3 text-sm">
      <h3 className="font-semibold">Rozliczenie — kto komu ile</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        {views.map(({ label, result }) => (
          <div key={label} className="flex flex-col gap-1.5 rounded-xl bg-zinc-50 p-3 dark:bg-zinc-800/50">
            <p className="text-xs font-semibold text-zinc-500 uppercase">{label}</p>
            {result.parties.map((party) => (
              <p key={party.key} className="flex justify-between gap-2">
                <span>
                  {party.name} <span className="text-xs text-zinc-500">· zapłacił(a) {money(party.paidMinor)} · udział {money(party.shareMinor)}</span>
                </span>
                <span className={`font-semibold tabular-nums ${party.balanceMinor >= 0 ? "text-sea dark:text-teal-300" : "text-signal"}`}>
                  {party.balanceMinor >= 0 ? "+" : ""}
                  {money(party.balanceMinor)}
                </span>
              </p>
            ))}
            {result.transfers.length === 0 ? (
              <p className="font-semibold text-sea dark:text-teal-300">Wszystko wyrównane.</p>
            ) : (
              result.transfers.map((transfer) => (
                <p key={`${transfer.from.key}>${transfer.to.key}`} className="font-semibold">
                  {transfer.from.name} → {transfer.to.name}: {money(transfer.amountMinor)}
                </p>
              ))
            )}
          </div>
        ))}
      </div>
      {skipped.length > 0 && (
        <p className="text-xs text-zinc-500">
          Poza rozliczeniem: {skipped.filter((each) => each.reason === "no_payer").length} bez płacącego, {skipped.filter((each) => each.reason === "no_rate").length} bez kursu waluty — uzupełnij w telefonie.
        </p>
      )}
      <p className="text-xs text-zinc-500">Podział wydatku („na kogo”) i „Oddane” przy przelewie — w telefonie, w portfelu wyjazdu.</p>
    </div>
  );
}
