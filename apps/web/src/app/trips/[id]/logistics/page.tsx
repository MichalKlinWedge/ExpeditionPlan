import { BUDGET_CATEGORY, budgetSummary, formatMoney, type TripDocument, walletSummary } from "@expeditionplan/core";
import { stateFromPayload } from "@expeditionplan/sync";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { Loading, Shell } from "@/components/shell";
import { requireUser } from "@/lib/auth";

/**
 * Rezerwacje, budżet „zapłacone / do wydania” i zadania (MVP-3, na razie do odczytu). Dane tą samą
 * drogą co plan: `pull_changes` → dokument; portfel z wydatków zapisanych na telefonie.
 */
export default function LogisticsPage(props: PageProps<"/trips/[id]/logistics">) {
  return (
    <Shell>
      <Suspense fallback={<Loading />}>
        <Logistics params={props.params} />
      </Suspense>
    </Shell>
  );
}

type Doc = TripDocument;
type Booking = Doc["bookings"][number];
type Task = Doc["tasks"][number];

const BOOKING_KIND: Record<string, string> = {
  flight: "lot",
  train: "pociąg",
  bus: "autobus",
  ferry: "prom",
  lodging: "nocleg",
  car_rental: "wynajem auta",
  transfer: "transfer",
  driver_hire: "kierowca",
  activity: "atrakcja",
  package: "pakiet",
  ticket: "bilet",
  transit_pass: "karta komunikacji",
  insurance: "ubezpieczenie",
  esim: "eSIM",
  luggage: "bagaż",
  other: "inne",
};

const BOOKING_STATUS: Record<string, { label: string; tone: string }> = {
  idea: { label: "pomysł", tone: "text-zinc-500" },
  candidate: { label: "kandydat", tone: "text-zinc-500" },
  to_book: { label: "do rezerwacji", tone: "text-amber-700 dark:text-amber-400" },
  booked: { label: "zarezerwowane", tone: "text-blue-700 dark:text-blue-400" },
  paid: { label: "zapłacone", tone: "text-green-700 dark:text-green-400" },
  cancelled: { label: "anulowane", tone: "text-zinc-400 line-through" },
  unknown: { label: "nie wiadomo, czy kupione", tone: "text-amber-700 dark:text-amber-400" },
  not_required: { label: "bez rezerwacji", tone: "text-zinc-500" },
};

const LINE_STATUS: Record<string, string> = { estimate: "szacunek", committed: "zobowiązanie", paid: "zapłacone" };
const TASK_KIND: Record<string, string> = { todo: "do zrobienia", question: "pytanie", decision: "decyzja" };

const shortDate = (date: string) =>
  new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));

function when(booking: Booking): string {
  const part = (time: Booking["start"]) => (time ? `${shortDate(time.date)}${time.time ? ` ${time.precision === "approx" ? "ok. " : ""}${time.time}` : ""}` : "");
  const start = part(booking.start);
  const end = part(booking.end);
  return start && end ? `${start} → ${end}` : start || end;
}

function price(booking: Booking): string | null {
  if (booking.paid) return `zapłacono ${formatMoney(booking.paid.amountMinor, booking.paid.currency)}`;
  const p = booking.price;
  if (!p) return null;
  const low = formatMoney(p.minMinor, p.currency);
  if (p.from) return `od ${low}`;
  return `${p.approx ? "ok. " : ""}${p.minMinor === p.maxMinor ? low : `${low} – ${formatMoney(p.maxMinor, p.currency)}`}`;
}

function due(task: Task, doc: Doc): string | null {
  const d = task.due;
  if (!d) return null;
  switch (d.kind) {
    case "absolute":
      return `do ${shortDate(d.date)}${d.time ? ` ${d.time}` : ""}`;
    case "before_trip":
      return d.days === 0 ? "przed wyjazdem" : `${d.days} dni przed wyjazdem`;
    case "before_item": {
      const item = doc.items.find((each) => each.ref === d.itemRef)?.title ?? "punktem";
      return d.days === 0 ? `przed: ${item}` : `${d.days} dni przed: ${item}`;
    }
    case "before_booking":
      return `przed: ${doc.bookings.find((each) => each.ref === d.bookingRef)?.title ?? "rezerwacją"}`;
    case "on_trip": {
      const day = d.dayRef ? doc.days.find((each) => each.ref === d.dayRef) : undefined;
      return `w trakcie wyjazdu${day ? `, ${shortDate(day.date)}` : ""}${d.time ? ` ${d.time}` : ""}`;
    }
  }
}

const card = "flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800";
const heading = "text-lg font-semibold";

async function Logistics({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireUser(`/trips/${id}/logistics`);
  const { data, error } = await supabase.rpc("pull_changes", { p_trip: id, p_since: 0 });
  if (error) return <p className="text-sm text-red-600">{error.message}</p>;
  if (data === null) notFound();
  const payload = data as Parameters<typeof stateFromPayload>[0];
  let doc: Doc;
  try {
    doc = stateFromPayload(payload).doc;
  } catch (e) {
    return <p className="text-sm text-red-600">Plan w bazie nie przechodzi walidacji: {e instanceof Error ? e.message : String(e)}</p>;
  }
  const expenses = (payload.tables.expenses ?? []).filter((row) => row.deleted_at === null);
  const budget = budgetSummary(doc);
  const wallet = walletSummary(
    doc,
    expenses.map((row) => ({ amountMinor: Number(row.amount_minor), currency: row.currency as string, category: row.category as string })),
  );
  const money = (minor: number) => formatMoney(minor, budget.currency);
  const range = (low: number, high: number) => (low === high ? money(low) : `${money(low)} – ${money(high)}`);
  const bookings = doc.bookings.filter((booking) => booking.status !== "candidate" && booking.status !== "idea");
  const candidates = doc.bookings.length - bookings.length;
  const open = doc.tasks.filter((task) => task.status === "open");
  const closed = doc.tasks.length - open.length;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <div className="flex flex-col gap-1">
        <Link href={`/trips/${id}`} className="text-sm text-zinc-500 underline">
          ← {doc.trip.title}
        </Link>
        <h1 className="text-2xl font-semibold">Rezerwacje, budżet i zadania</h1>
        <p className="text-xs text-zinc-500">Na razie do odczytu — edycja przyjdzie w kolejnym kroku MVP-3.</p>
      </div>

      <section className={card}>
        <h2 className={heading}>Budżet</h2>
        {doc.budgetLines.length === 0 ? (
          <p className="text-sm text-zinc-500">Plan nie ma pozycji budżetu.</p>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
              <Stat label="Zapłacone" value={money(budget.paidMinor)} />
              <Stat label="Do wydania" value={range(budget.toSpendLowMinor, budget.toSpendHighMinor)} />
              <Stat label="Razem" value={range(budget.totalLowMinor, budget.totalHighMinor)} />
              {budget.perPersonLowMinor !== null && <Stat label="Na osobę" value={range(budget.perPersonLowMinor, budget.perPersonHighMinor!)} />}
            </dl>
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-zinc-500">
                <tr>
                  <th className="py-1 font-normal">Pozycja</th>
                  <th className="py-1 font-normal">Kategoria</th>
                  <th className="py-1 font-normal">Status</th>
                  <th className="py-1 text-right font-normal">Kwota</th>
                </tr>
              </thead>
              <tbody>
                {doc.budgetLines.map((line) => (
                  <tr key={line.ref} className="border-t border-zinc-100 dark:border-zinc-900">
                    <td className="py-1">
                      {line.title}
                      {line.perPerson ? <span className="text-zinc-500"> · na osobę</span> : null}
                    </td>
                    <td className="py-1 text-zinc-500">{BUDGET_CATEGORY[line.category] ?? line.category}</td>
                    <td className="py-1 text-zinc-500">{LINE_STATUS[line.status]}</td>
                    <td className="py-1 text-right font-mono">
                      {line.lowMinor === line.highMinor
                        ? formatMoney(line.lowMinor, line.currency)
                        : `${formatMoney(line.lowMinor, line.currency)} – ${formatMoney(line.highMinor, line.currency)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {Object.keys(budget.unconverted).length > 0 && (
              <p className="text-xs text-amber-700">
                Bez kursu w planie (poza sumą):{" "}
                {Object.entries(budget.unconverted)
                  .map(([currency, minor]) => formatMoney(minor, currency))
                  .join(", ")}
              </p>
            )}
          </>
        )}
        <p className="text-sm">
          Portfel — wydane na miejscu: <span className="font-medium">{money(wallet.spentMinor)}</span>
          <span className="text-zinc-500"> ({wallet.count} wydatków z telefonu)</span>
        </p>
      </section>

      <section className={card}>
        <h2 className={heading}>Rezerwacje ({bookings.length})</h2>
        {candidates > 0 && <p className="text-xs text-zinc-500">Kandydaci i pomysły ({candidates}) są w wariantach planu — tu tylko wybrane rezerwacje.</p>}
        <ul className="flex flex-col gap-3">
          {bookings.map((booking) => {
            const status = BOOKING_STATUS[booking.status]!;
            const cost = price(booking);
            const cancelSoon = booking.freeCancellationUntil !== undefined && booking.freeCancellationUntil >= today;
            return (
              <li key={booking.ref} className="flex flex-col gap-0.5 text-sm">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium">{booking.title}</span>
                  <span className="text-xs text-zinc-500">{BOOKING_KIND[booking.kind]}</span>
                  <span className={`text-xs ${status.tone}`}>{status.label}</span>
                </div>
                <p className="text-zinc-600 dark:text-zinc-400">
                  {[when(booking), booking.provider, cost, booking.confirmationCode ? `kod ${booking.confirmationCode}` : null].filter(Boolean).join(" · ")}
                </p>
                {(booking.refundable === false || cancelSoon || booking.payWhen === "on_site" || booking.includes.length > 0) && (
                  <p className="text-xs text-zinc-500">
                    {[
                      booking.refundable === false ? "bezzwrotna" : null,
                      cancelSoon ? `darmowe odwołanie do ${shortDate(booking.freeCancellationUntil!)}` : null,
                      booking.payWhen === "on_site" ? "płatność na miejscu" : null,
                      booking.includes.length > 0 ? `w cenie: ${booking.includes.join(", ")}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className={card}>
        <h2 className={heading}>
          Zadania — otwarte {open.length}
          {closed > 0 ? <span className="text-sm font-normal text-zinc-500"> (zamknięte: {closed})</span> : null}
        </h2>
        <ul className="flex flex-col gap-2 text-sm">
          {open.map((task) => (
            <li key={task.ref} className="flex flex-col">
              <span>
                {task.priority === "high" ? <span className="text-red-600">! </span> : null}
                {task.title}
                <span className="text-xs text-zinc-500">
                  {" "}
                  · {TASK_KIND[task.kind]}
                  {due(task, doc) ? ` · ${due(task, doc)}` : ""}
                  {task.assigneeRefs.length > 0
                    ? ` · ${task.assigneeRefs.map((ref) => doc.travelers.find((each) => each.ref === ref)?.name ?? "?").join(", ")}`
                    : ""}
                </span>
              </span>
              {task.body && <span className="text-xs whitespace-pre-line text-zinc-500">{task.body}</span>}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
