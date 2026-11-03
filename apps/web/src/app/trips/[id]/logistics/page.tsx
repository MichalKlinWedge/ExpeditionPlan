import { BUDGET_CATEGORY, budgetPace, budgetSuggestions, budgetSummary, flightLine, formatMoney, instantToZoned, LogisticsCandidates, type TripDocument, walletSummary } from "@expeditionplan/core";
import { refIndex, stateFromPayload } from "@expeditionplan/sync";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { draftCandidates } from "@/app/candidates-actions";
import { CandidatesReview, type ComparisonGroup, ComparisonTable } from "@/components/candidates";
import { BookingEditor, BookingItems, BudgetLines, BudgetSuggestions, type Choices, Contacts, FxEditor, NewBooking } from "@/components/logistics-editors";
import { Meals } from "@/components/meals";
import { Settlement } from "@/components/settlement";
import { EditToggle, editMode } from "@/components/edit-toggle";
import { PlanActionButton } from "@/components/plan-action-button";
import { Loading, Shell } from "@/components/shell";
import { requireUser } from "@/lib/auth";
import { BOOKING_KIND } from "@/lib/labels";
import { planChoices } from "@/lib/tasks";

/**
 * Rezerwacje, budżet „zapłacone / do wydania” i kontakty (MVP-3); zadania — osobna strona `/tasks`. Dane tą samą drogą co
 * plan: `pull_changes` → dokument; portfel z wydatków zapisanych na telefonie. Organizator
 * i edytor zmieniają wszystko (`logistics-actions.ts`), widz tylko czyta.
 */
// „Kandydaci z AI” (akcja serwera na tej stronie) trwa zwykle 15–60 s.
export const maxDuration = 120;

export default function LogisticsPage(props: PageProps<"/trips/[id]/logistics">) {
  return (
    <Shell>
      <Suspense fallback={<Loading />}>
        <Logistics params={props.params} searchParams={props.searchParams} />
      </Suspense>
    </Shell>
  );
}

type Doc = TripDocument;
type Booking = Doc["bookings"][number];

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

const PAY_WHEN: Record<string, string> = { prepaid: "płatne z góry", before_arrival: "płatne przed przyjazdem", on_site: "płatność na miejscu" };
const PAY_METHOD: Record<string, string> = { cash: "gotówka", card: "karta", credit_card_only: "tylko karta kredytowa", online: "online" };

/** Warunki rezerwacji, które liczą się w trasie: zwrot, odwołanie, płatność, skład, auto, nocleg. */
function facts(booking: Booking, cancelSoon: boolean): string[] {
  return [
    booking.refundable === false ? "bezzwrotna" : null,
    cancelSoon ? `darmowe odwołanie do ${shortDate(booking.freeCancellationUntil!)}` : null,
    booking.payWhen ? PAY_WHEN[booking.payWhen] : null,
    booking.paymentMethod ? PAY_METHOD[booking.paymentMethod] : null,
    booking.party ? `zgłoszeni: ${booking.party.adults} dor.${booking.party.children > 0 ? ` + ${booking.party.children} dz.` : ""}` : null,
    booking.checkInFrom || booking.checkOutUntil ? [booking.checkInFrom ? `zameldowanie od ${booking.checkInFrom}` : null, booking.checkOutUntil ? `wymeldowanie do ${booking.checkOutUntil}` : null].filter(Boolean).join(", ") : null,
    booking.car?.kmLimit ? `limit ${booking.car.kmLimit} km` : null,
    booking.car?.officeHours ? `biuro ${booking.car.officeHours}` : null,
    booking.lodging?.breakfast ? `śniadanie: ${booking.lodging.breakfast}` : null,
    booking.includes.length > 0 ? `w cenie: ${booking.includes.join(", ")}` : null,
  ].filter((each): each is string => each !== null && each !== "");
}

const card = "flex flex-col gap-3 card p-4";
const heading = "text-lg font-semibold";

async function Logistics({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const wantsEdit = await editMode(searchParams);
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
  const mayEdit = membership.data?.role === "owner" || membership.data?.role === "editor";
  // Domyślnie podgląd; formularze po „Edytuj” (`?edit=1`).
  const canEdit = mayEdit && wantsEdit;
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
  // Plan a wydatki dzień po dniu: punkt wydatku (id → ref) i „dziś” w strefie wyjazdu.
  const tripToday = instantToZoned(new Date().getTime(), doc.trip.primaryTz).date;
  const refOf = new Map(Object.entries(refIndex(payload.tables)).map(([ref, rowId]) => [rowId, ref]));
  const pace = budgetPace(
    doc,
    expenses.map((row) => ({
      amountMinor: Number(row.amount_minor),
      currency: row.currency as string,
      category: row.category as string,
      paidAt: row.paid_at as string,
      ...(row.item_id && refOf.has(row.item_id as string) ? { itemRef: refOf.get(row.item_id as string)! } : {}),
    })),
    tripToday,
  );
  // Zdjęcia paragonów (bucket `journal`) — krótkie podpisane adresy.
  const receiptPaths = expenses.flatMap((row) => (row.receipt_path ? [row.receipt_path as string] : []));
  const receipts = new Map<string, string>();
  if (receiptPaths.length > 0) {
    const { data: signed } = await supabase.storage.from("journal").createSignedUrls(receiptPaths, 3600);
    for (const each of signed ?? []) if (each.path && each.signedUrl && !each.error) receipts.set(each.path, each.signedUrl);
  }
  const bookings = doc.bookings.filter((booking) => booking.status !== "candidate" && booking.status !== "idea");
  const candidates = doc.bookings.length - bookings.length;
  const packaged = new Map<string, Doc["items"]>();
  for (const item of doc.items) if (item.bookingRef) packaged.set(item.bookingRef, [...(packaged.get(item.bookingRef) ?? []), item]);
  const open = doc.tasks.filter((task) => task.status === "open");
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
  const choices: Choices = planChoices(doc);
  // Strefy do podpowiedzi przy rezerwacji: wyjazdu, domu, dni i te, które rezerwacje już mają.
  const zones = [...new Set([doc.trip.primaryTz, doc.trip.homeTz, ...doc.days.map((day) => day.tz), ...doc.bookings.flatMap((booking) => [booking.start?.tz, booking.end?.tz])].filter((zone): zone is string => zone !== undefined))];
  const suggestions = budgetSuggestions(doc);
  // Waluty użyte w budżecie i rezerwacjach, a bez kursu — suma ich nie widzi.
  const missingFx = [
    ...new Set([...doc.budgetLines.map((line) => line.currency), ...bookings.flatMap((booking) => [booking.price?.currency, booking.paid?.currency])].filter((currency): currency is string => currency !== undefined)),
  ].filter((currency) => currency !== doc.trip.baseCurrency && !doc.trip.fx.some((each) => each.currency === currency));

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-col gap-1">
          <Link href={`/trips/${id}`} className="text-sm text-zinc-500 underline">
            ← {doc.trip.title}
          </Link>
          <h1 className="text-2xl font-semibold">Rezerwacje i budżet</h1>
        </div>
        {mayEdit && <EditToggle href={`/trips/${id}/logistics`} editing={canEdit} />}
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
        {budget.byCategory.length > 1 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-zinc-500">Według kategorii</summary>
            <table className="mt-2 w-full text-left">
              <thead className="text-xs text-zinc-500">
                <tr>
                  <th className="font-normal">Kategoria</th>
                  <th className="text-right font-normal">Zapłacone</th>
                  <th className="text-right font-normal">Razem</th>
                </tr>
              </thead>
              <tbody>
                {budget.byCategory.map((each) => (
                  <tr key={each.category} className="border-t border-zinc-100 dark:border-zinc-900">
                    <td className="py-0.5">{BUDGET_CATEGORY[each.category] ?? each.category}</td>
                    <td className="py-0.5 text-right font-mono">{money(each.paidMinor)}</td>
                    <td className="py-0.5 text-right font-mono">{range(each.lowMinor, each.highMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        )}
        {canEdit && <BudgetSuggestions tripId={id} suggestions={suggestions} />}
        <FxEditor tripId={id} fx={doc.trip.fx} base={doc.trip.baseCurrency} missing={missingFx} canEdit={canEdit} />
        <p className="text-sm">
          Portfel — wydane na miejscu: <span className="font-medium">{money(wallet.spentMinor)}</span>
          <span className="text-zinc-500"> ({wallet.count} wydatków z telefonu)</span>
        </p>
        {pace.plannedHighMinor > 0 && <PaceTable pace={pace} today={tripToday} money={money} range={range} />}
        {expenses.length > 0 && <ExpenseList expenses={expenses} receipts={receipts} names={new Map(doc.travelers.map((each) => [each.ref, each.name]))} refOf={refOf} />}
        <Settlement doc={doc} tables={payload.tables as unknown as Parameters<typeof Settlement>[0]["tables"]} />
      </section>

      {/* Wszystko wybrane i nic nie czeka na przegląd — cała sekcja zwinięta do nagłówka. */}
      <details className={card} open={!(comparisons.length > 0 && comparisons.every((group) => group.chosenRef !== undefined) && !(candidatesDraft.success && draftRow.data?.status === "ok")) || undefined}>
        <summary className={`${heading} cursor-pointer`}>
          Do porównania ({comparisons.length})
          {comparisons.length > 0 && <span className="text-sm font-normal text-zinc-500"> — wybrane: {comparisons.filter((group) => group.chosenRef !== undefined).length}</span>}
        </summary>
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
      </details>

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
                </div>
                <p className="text-zinc-600 dark:text-zinc-400">
                  {[when(booking), booking.kind === "flight" ? flightLine(booking) : [booking.provider, booking.confirmationCode ? `kod ${booking.confirmationCode}` : null].filter(Boolean).join(" · "), cost]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {facts(booking, cancelSoon).length > 0 && <p className="text-xs text-zinc-500">{facts(booking, cancelSoon).join(" · ")}</p>}
                {packaged.get(booking.ref) && <p className="text-xs text-zinc-500">w pakiecie: {packaged.get(booking.ref)!.map((item) => item.title).join(", ")}</p>}
                {canEdit && (
                  <div className="flex flex-col items-start gap-1">
                    <span className="flex gap-3">
                      <BookingEditor tripId={id} booking={booking} statuses={statuses} zones={zones} />
                      <BookingItems tripId={id} bookingRef={booking.ref} items={choices.items} chosen={(packaged.get(booking.ref) ?? []).map((item) => item.ref)} />
                    </span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {canEdit && <NewBooking tripId={id} statuses={statuses} zones={zones} />}
      </section>

      <section className={card}>
        <h2 className={heading}>Jedzenie i zakupy</h2>
        <Meals tripId={id} doc={doc} tables={payload.tables as unknown as Parameters<typeof Meals>[0]["tables"]} ids={refIndex(payload.tables)} canEdit={canEdit} />
      </section>

      <section className={card}>
        <h2 className={heading}>Kontakty ({doc.contacts.length})</h2>
        <Contacts tripId={id} contacts={doc.contacts} bookings={choices.bookings} canEdit={canEdit} />
      </section>

      <Link href={`/trips/${id}/tasks`} className="self-start text-sm text-zinc-500 underline hover:text-sea">
        Zadania — otwarte {open.length} →
      </Link>
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

const WEEKDAY = ["nd.", "pon.", "wt.", "śr.", "czw.", "pt.", "sob."];
const dayDate = (date: string) => `${WEEKDAY[new Date(`${date}T12:00:00Z`).getUTCDay()]} ${Number(date.slice(8))}.${date.slice(5, 7)}`;

/** Plan „do wydania” kontra wydatki z telefonu: tempo, prognoza, kategorie i dni ponad plan. */
function PaceTable({ pace, today, money, range }: { pace: ReturnType<typeof budgetPace>; today: string; money: (minor: number) => string; range: (low: number, high: number) => string }) {
  const perDay = Math.round(pace.plannedHighMinor / Math.max(pace.days.length, 1));
  const forecastOver = pace.forecastMinor !== null && pace.forecastMinor > pace.plannedHighMinor;
  const over = pace.categories.filter((each) => each.over);
  return (
    <details className="text-sm" open={pace.elapsedDays > 0}>
      <summary className="cursor-pointer font-medium">
        Plan a wydatki dzień po dniu
        {forecastOver ? <span className="ml-2 text-signal">⚠ prognoza ponad plan</span> : null}
      </summary>
      <div className="mt-2 flex flex-col gap-2">
        <p className="text-zinc-600 dark:text-zinc-400">
          Do wydania na miejscu: {range(pace.plannedLowMinor, pace.plannedHighMinor)} (wygodnie {money(perDay)} dziennie)
          {pace.elapsedDays > 0 && (
            <>
              {" "}
              · średnio wydajecie {money(Math.round((pace.spentMinor - pace.outsideMinor) / pace.elapsedDays))} dziennie ·{" "}
              <span className={forecastOver ? "font-semibold text-signal" : "font-semibold"}>prognoza na koniec {money(pace.forecastMinor!)}</span>
            </>
          )}
        </p>
        {over.map((each) => (
          <p key={each.category} className="text-signal">
            ⚠ {BUDGET_CATEGORY[each.category] ?? each.category}: wydane {money(each.spentMinor)} z planu {range(each.plannedLowMinor, each.plannedHighMinor)}
          </p>
        ))}
        <table className="w-full max-w-md text-left">
          <thead className="text-xs text-zinc-500">
            <tr>
              <th className="py-1 font-normal">Dzień</th>
              <th className="py-1 text-right font-normal">Plan (wygodnie)</th>
              <th className="py-1 text-right font-normal">Wydane</th>
            </tr>
          </thead>
          <tbody>
            {pace.days.map((day, index) => (
              <tr key={day.dayRef} className={`border-t border-zinc-200 dark:border-zinc-800 ${day.date === today ? "font-semibold" : ""}`}>
                <td className="py-1">
                  Dzień {index + 1} · {dayDate(day.date)}
                </td>
                <td className="py-1 text-right">{money(day.plannedHighMinor)}</td>
                <td className={`py-1 text-right ${day.over ? "text-signal" : ""}`}>
                  {day.over ? "⚠ " : ""}
                  {day.spentMinor > 0 ? money(day.spentMinor) : "—"}
                </td>
              </tr>
            ))}
            {pace.outsideMinor > 0 && (
              <tr className="border-t border-zinc-200 text-zinc-500 dark:border-zinc-800">
                <td className="py-1">Poza dniami planu</td>
                <td />
                <td className="py-1 text-right">{money(pace.outsideMinor)}</td>
              </tr>
            )}
          </tbody>
        </table>
        <p className="text-xs text-zinc-500">Plan dnia = pozycje przypięte do punktów tego dnia + równa część pozycji bez dnia. Pozycje zapłacone przed wyjazdem nie wchodzą.</p>
      </div>
    </details>
  );
}

type ExpenseRow = { id: string } & Record<string, unknown>;

/** Wydatki z telefonu: kwota, kategoria, kto płacił, notatka i miniatura paragonu (pełne zdjęcie w nowej karcie). */
function ExpenseList({ expenses, receipts, names, refOf }: { expenses: ExpenseRow[]; receipts: Map<string, string>; names: Map<string, string>; refOf: Map<string, string> }) {
  const sorted = [...expenses].sort((a, b) => String(b.paid_at).localeCompare(String(a.paid_at)));
  const withReceipt = sorted.filter((row) => row.receipt_path).length;
  return (
    <details className="text-sm">
      <summary className="cursor-pointer font-medium">
        Wydatki z telefonu ({expenses.length}){withReceipt > 0 ? ` · 🧾 ${withReceipt} z paragonem` : ""}
      </summary>
      <ul className="mt-2 flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
        {sorted.map((row) => {
          const url = row.receipt_path ? receipts.get(String(row.receipt_path)) : undefined;
          const payer = row.payer_traveler_id ? names.get(refOf.get(String(row.payer_traveler_id)) ?? "") : undefined;
          return (
            <li key={row.id} className="flex items-center gap-3 py-1.5">
              {url ? (
                <a href={url} target="_blank" rel="noreferrer" title="Zdjęcie paragonu">
                  {/* eslint-disable-next-line @next/next/no-img-element -- podpisany adres z Supabase Storage, ważny godzinę */}
                  <img src={url} alt="Paragon" className="size-12 rounded object-cover" />
                </a>
              ) : (
                <span className="size-12 shrink-0" />
              )}
              <span className="flex-1">
                <strong>{formatMoney(Number(row.amount_minor), String(row.currency))}</strong> · {BUDGET_CATEGORY[String(row.category)] ?? String(row.category)}
                {payer ? ` · płacił(a): ${payer}` : ""}
                {row.note ? <span className="text-zinc-500"> · {String(row.note)}</span> : null}
              </span>
              <span className="text-xs text-zinc-500">{new Date(String(row.paid_at)).toLocaleDateString("pl-PL", { day: "numeric", month: "short" })}</span>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
