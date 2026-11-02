import { budgetSummary, formatMoney, LogisticsCandidates, type TripDocument, walletSummary } from "@expeditionplan/core";
import { stateFromPayload } from "@expeditionplan/sync";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { draftCandidates } from "@/app/candidates-actions";
import { CandidatesReview, type ComparisonGroup, ComparisonTable } from "@/components/candidates";
import { BookingEditor, BudgetLines, TaskList } from "@/components/logistics-editors";
import { PlanActionButton } from "@/components/plan-action-button";
import { Loading, Shell } from "@/components/shell";
import { requireUser } from "@/lib/auth";

/**
 * Rezerwacje, budżet „zapłacone / do wydania” i zadania (MVP-3). Dane tą samą drogą co plan:
 * `pull_changes` → dokument; portfel z wydatków zapisanych na telefonie. Organizator i edytor
 * zmieniają budżet, zadania i stan rezerwacji (`logistics-actions.ts`), widz tylko czyta.
 */
// „Kandydaci z AI” (akcja serwera na tej stronie) trwa zwykle 15–60 s.
export const maxDuration = 120;

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

const card = "flex flex-col gap-3 card p-4";
const heading = "text-lg font-semibold";

async function Logistics({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireUser(`/trips/${id}/logistics`);
  const [{ data, error }, membership, draftRow] = await Promise.all([
    supabase.rpc("pull_changes", { p_trip: id, p_since: 0 }),
    supabase.from("my_trips").select("role").eq("id", id).maybeSingle(),
    supabase
      .from("ai_runs")
      .select("id, output, status")
      .eq("trip_id", id)
      .eq("stage", "logistics")
      .in("status", ["ok", "accepted"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const canEdit = membership.data?.role === "owner" || membership.data?.role === "editor";
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
  // Termin i osoby zadania po ludzku — liczone tu, bo potrzebują całego dokumentu.
  const describe = Object.fromEntries(
    doc.tasks.map((task) => [
      task.ref,
      [due(task, doc), task.assigneeRefs.length > 0 ? task.assigneeRefs.map((ref) => doc.travelers.find((each) => each.ref === ref)?.name ?? "?").join(", ") : null]
        .filter(Boolean)
        .join(" · "),
    ]),
  );
  // Etap 4: szkic kandydatów z AI i grupy porównania z planu (kandydaci rezerwacji).
  const draftOutput = draftRow.data?.output as { info?: unknown; checks?: string[] } | null | undefined;
  const candidatesDraft = LogisticsCandidates.safeParse(draftOutput?.info);
  const comparisons: ComparisonGroup[] = doc.variantGroups
    .filter((group) => group.scope === "booking")
    .map((group) => ({
      ref: group.ref,
      title: group.title,
      ...(group.conditionText ? { conditionText: group.conditionText } : {}),
      ...(group.chosenRef ? { chosenRef: group.chosenRef } : {}),
      columns: group.comparison?.columns ?? [],
      rows: doc.variants
        .filter((variant) => variant.groupRef === group.ref)
        .map((variant) => {
          const booking = doc.bookings.find((each) => each.variantRef === variant.ref);
          const basis = booking?.price ? { per_night: " za noc", per_day: " za dzień", per_group: "", per_person: " za osobę", per_unit: "" }[booking.price.basis] : "";
          return {
            variantRef: variant.ref,
            label: variant.label,
            recommended: variant.recommended === true,
            values: group.comparison?.rows.find((row) => row.variantRef === variant.ref)?.values ?? [],
            price: booking ? (price(booking) === null ? null : `${price(booking)}${basis}`) : null,
            status: booking?.status ?? "candidate",
            links: booking?.links ?? [],
            pros: variant.pros,
            cons: variant.cons,
            notes: booking?.notes ?? [],
          };
        }),
    }));
  const statuses = Object.fromEntries(Object.entries(BOOKING_STATUS).map(([key, value]) => [key, value.label]));
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <div className="flex flex-col gap-1">
        <Link href={`/trips/${id}`} className="text-sm text-zinc-500 underline">
          ← {doc.trip.title}
        </Link>
        <h1 className="text-2xl font-semibold">Rezerwacje, budżet i zadania</h1>
      </div>

      <section className={card}>
        <h2 className={heading}>Budżet</h2>
        {doc.budgetLines.length === 0 ? (
          <>
            <p className="text-sm text-zinc-500">Plan nie ma pozycji budżetu.</p>
            <BudgetLines tripId={id} lines={[]} currency={doc.trip.baseCurrency} canEdit={canEdit} />
          </>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
              <Stat label="Zapłacone" value={money(budget.paidMinor)} />
              <Stat label="Do wydania" value={range(budget.toSpendLowMinor, budget.toSpendHighMinor)} />
              <Stat label="Razem" value={range(budget.totalLowMinor, budget.totalHighMinor)} />
              {budget.perPersonLowMinor !== null && <Stat label="Na osobę" value={range(budget.perPersonLowMinor, budget.perPersonHighMinor!)} />}
            </dl>
            <BudgetLines tripId={id} lines={doc.budgetLines} currency={budget.currency} canEdit={canEdit} />
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
        <h2 className={heading}>Do porównania ({comparisons.length})</h2>
        <p className="text-xs text-zinc-500">Kandydaci na noclegi, auto, transfery — bez rezerwacji: linki prowadzą do wyszukiwarek, „Wybieram” oznacza opcję „do rezerwacji”.</p>
        {canEdit && (
          <PlanActionButton
            run={draftCandidates.bind(null, id)}
            label={candidatesDraft.success ? "Nowi kandydaci z AI" : "Kandydaci z AI"}
            note="Noclegi per baza, auto, transfery — szacunki cen do sprawdzenia (Gemini, ok. 30 s)"
          />
        )}
        {/* Po „Dodaj do porównania” szkic znika z odświeżonej strony — potwierdzenie zostaje tutaj. */}
        {canEdit && draftRow.data?.status === "accepted" && <p className="text-sm text-green-700 dark:text-green-400">Ostatni szkic AI dodany do porównania — grupy są niżej.</p>}
        {canEdit && candidatesDraft.success && draftRow.data?.status === "ok" && (
          <CandidatesReview tripId={id} runId={draftRow.data.id} info={candidatesDraft.data} checks={draftOutput?.checks ?? []} />
        )}
        {comparisons.map((group) => (
          <ComparisonTable key={group.ref} tripId={id} group={group} canEdit={canEdit} />
        ))}
      </section>

      <section className={card}>
        <h2 className={heading}>Rezerwacje ({bookings.length})</h2>
        {candidates > 0 && <p className="text-xs text-zinc-500">Kandydaci i pomysły ({candidates}) są wyżej, w „Do porównania” — tu tylko wybrane rezerwacje.</p>}
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
                  {canEdit && <BookingEditor tripId={id} booking={booking} statuses={statuses} />}
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
        <TaskList tripId={id} tasks={doc.tasks} describe={describe} canEdit={canEdit} />
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
