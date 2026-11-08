import type { Metadata } from "next";
import { BOOKING_KIND, BOOKING_STATUS, bookingContacts, bookingFacts, bookingLine, bookingPrice, bookingRemovalNote, bookingWhen, BUDGET_CATEGORY, budgetPace, budgetSuggestions, budgetSummary, dayChip, formatMoney, instantToZoned, LogisticsCandidates, removeBooking, tripCurrencies, type TripDocument, walletSummary } from "@expeditionplan/core";
import { dbLoadError, type PullPayload, refIndex, stateFromPayload } from "@expeditionplan/sync";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Fragment, Suspense } from "react";

import { draftCandidates } from "@/app/candidates-actions";
import { BookingImport } from "@/components/booking-import";
import { CandidatesReview, type ComparisonGroup, ComparisonTable } from "@/components/candidates";
import { LinkedText } from "@/components/linked-text";
import { BookingRow, BookingStatusSelect, BudgetLines, BudgetSuggestions, type Choices, ExpenseSplitEditor, FxEditor, HashFocus, NewBooking, RemoveCancelledBooking, TripCurrency } from "@/components/logistics-editors";
import { Settlement } from "@/components/settlement";
import { EditToggle } from "@/components/edit-toggle";
import { editMode } from "@/lib/edit-mode";
import { PlanActionButton } from "@/components/plan-action-button";
import { Loading, Shell } from "@/components/shell";
import { requireUser } from "@/lib/auth";
import { contactHref, isListedBooking } from "@/lib/booking-link";
import { planChoices } from "@/lib/tasks";

export const metadata: Metadata = { title: "Rezerwacje i budżet — Expedition Planner" };

/**
 * Rezerwacje i budżet „zapłacone / do wydania” (MVP-3); zadania i kontakty — osobne strony (`/tasks`, `/contacts`). Dane tą samą drogą co
 * plan: `pull_changes` → dokument; portfel z wydatków zapisanych na telefonie. Organizator
 * i edytor zmieniają wszystko (`logistics-actions.ts`), widz tylko czyta.
 */
// „Kandydaci z AI” i import rezerwacji z pliku (akcje serwera na tej stronie) trwają zwykle 15–60 s.
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

/** Kolor statusu rezerwacji; nazwy są w `BOOKING_STATUS` (core). */
const STATUS_TONE: Record<string, string> = {
  idea: "text-zinc-500",
  candidate: "text-zinc-500",
  to_book: "text-amber-700 dark:text-amber-400",
  booked: "text-blue-700 dark:text-blue-400",
  paid: "text-green-700 dark:text-green-400",
  cancelled: "text-zinc-400 line-through",
  unknown: "text-amber-700 dark:text-amber-400",
  not_required: "text-zinc-500",
};

const card = "flex flex-col gap-3 card p-4";
const heading = "card-title";

async function Logistics({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const wantsEdit = await editMode();
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
  // Domyślnie podgląd; formularze po „Edytuj” (wspólny tryb edycji).
  const canEdit = mayEdit && wantsEdit;
  if (error) return <p className="text-sm text-red-600">{dbLoadError(error)}</p>;
  if (data === null) notFound();
  const payload = data as PullPayload;
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
  const idOf = refIndex(payload.tables);
  const refOf = new Map(Object.entries(idOf).map(([ref, rowId]) => [rowId, ref]));
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
  const bookings = doc.bookings.filter(isListedBooking);
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
            price: booking ? (bookingPrice(booking) === null ? null : `${bookingPrice(booking)}${basis}`) : null,
            status: booking?.status ?? "candidate",
            links: booking?.links ?? [],
            pros: variant.pros,
            cons: variant.cons,
            notes: booking?.notes ?? [],
          };
        }),
    }));
  const statuses = BOOKING_STATUS;
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
          <Link href={`/trips/${id}`} className="back-link">
            ← {doc.trip.title}
          </Link>
          <h1 className="text-2xl font-semibold">Rezerwacje i budżet</h1>
        </div>
        {mayEdit && <EditToggle editing={canEdit} />}
      </div>

      <section className={card}>
        <h2 className={heading}>Budżet</h2>
        {doc.budgetLines.length === 0 ? (
          <>
            <p className="text-sm text-zinc-500">Plan nie ma pozycji budżetu.</p>
            <BudgetLines tripId={id} lines={[]} currency={doc.trip.baseCurrency} people={choices.travelers} canEdit={canEdit} />
          </>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
              <Stat label="Zapłacone" value={money(budget.paidMinor)} />
              <Stat label="Do wydania" value={range(budget.toSpendLowMinor, budget.toSpendHighMinor)} />
              <Stat label="Razem" value={range(budget.totalLowMinor, budget.totalHighMinor)} />
              {budget.perPersonLowMinor !== null && <Stat label="Na osobę" value={range(budget.perPersonLowMinor, budget.perPersonHighMinor!)} />}
            </dl>
            {/* Pozycje dla części osób: średnia nic nie mówi, więc kwota każdej osoby. */}
            {budget.perPersonLowMinor === null && budget.perTraveler.length > 0 && (
              <div className="text-sm">
                <p className="text-xs text-zinc-500">Na osobę</p>
                <ul className="flex flex-wrap gap-x-6 gap-y-1">
                  {budget.perTraveler.map((each) => (
                    <li key={each.ref}>
                      {each.name}: <span className="font-medium">{range(each.lowMinor, each.highMinor)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <BudgetLines tripId={id} lines={doc.budgetLines} currency={budget.currency} people={choices.travelers} canEdit={canEdit} />
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
        <TripCurrency tripId={id} base={doc.trip.baseCurrency} known={tripCurrencies(doc)} canEdit={canEdit} />
        {/* Klucz: wiersze edytora biorą kursy tylko przy montowaniu, a zmiana waluty podaje nowe. */}
        <FxEditor key={doc.trip.baseCurrency} tripId={id} fx={doc.trip.fx} base={doc.trip.baseCurrency} missing={missingFx} canEdit={canEdit} />
        <p className="text-sm">
          Portfel — wydane na miejscu: <span className="font-medium">{money(wallet.spentMinor)}</span>
          <span className="text-zinc-500"> ({wallet.count} wydatków z telefonu)</span>
        </p>
        {pace.plannedHighMinor > 0 && <PaceTable pace={pace} today={tripToday} money={money} range={range} />}
        {expenses.length > 0 && (
          <ExpenseList
            tripId={id}
            canEdit={canEdit}
            expenses={expenses}
            receipts={receipts}
            names={new Map(doc.travelers.map((each) => [each.ref, each.name]))}
            refOf={refOf}
            people={doc.travelers.map((each) => ({ ref: idOf[each.ref]!, name: each.name }))}
            splits={(payload.tables.expense_splits ?? []).filter((row) => row.deleted_at === null)}
          />
        )}
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
            ai
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
        {bookings.length > 0 && (
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-zinc-500">
              <tr>
                <th className="py-1 font-normal">Rezerwacja</th>
                <th className="hidden py-1 font-normal sm:table-cell">Rodzaj</th>
                <th className="hidden py-1 font-normal sm:table-cell">Termin</th>
                <th className="hidden py-1 font-normal sm:table-cell">Status</th>
                <th className="py-1 text-right font-normal">Kwota</th>
                {mayEdit && <th className="hidden py-1 sm:table-cell" />}
              </tr>
            </thead>
            <tbody>
              {bookings.map((booking) => {
                const tone = STATUS_TONE[booking.status] ?? "text-zinc-500";
                const cost = booking.paid ? formatMoney(booking.paid.amountMinor, booking.paid.currency) : bookingPrice(booking);
                const facts = bookingFacts(booking, today);
                const line = bookingLine(booking);
                const contacts = bookingContacts(doc, booking.ref);
                const statusControl = mayEdit ? <BookingStatusSelect tripId={id} bookingRef={booking.ref} status={booking.status} statuses={statuses} tone={tone} /> : <span className={`text-xs ${tone}`}>{BOOKING_STATUS[booking.status]}</span>;
                const place = booking.kind === "lodging" && booking.startPlaceRef !== undefined ? doc.places.find((each) => each.ref === booking.startPlaceRef) : undefined;
                return (
                  <BookingRow
                    key={booking.ref}
                    tripId={id}
                    booking={booking}
                    statuses={statuses}
                    zones={zones}
                    places={doc.places}
                    items={choices.items}
                    chosen={(packaged.get(booking.ref) ?? []).map((item) => item.ref)}
                    canEdit={canEdit}
                    actionsColumn={mayEdit}
                    removal={mayEdit && booking.status === "cancelled" ? <RemoveCancelledBooking tripId={id} bookingRef={booking.ref} title={booking.title} note={bookingRemovalNote(removeBooking(doc, booking.ref)!.summary)} /> : null}
                    details={
                      line || facts.length > 0 || place || packaged.get(booking.ref) || contacts.length > 0 ? (
                        <>
                          {line ? (
                            <span className="block text-zinc-600 dark:text-zinc-400">
                              <LinkedText text={line} />
                            </span>
                          ) : null}
                          {facts.length > 0 && (
                            <span className="block">
                              <LinkedText text={facts.join(" · ")} />
                            </span>
                          )}
                          {place && (
                            <span className="block">
                              miejsce: {place.name}
                              {place.lat === undefined || place.lng === undefined ? " · bez współrzędnych, nie ma go na mapie" : ""}
                            </span>
                          )}
                          {packaged.get(booking.ref) && (
                            <span className="mt-0.5 flex flex-wrap items-center gap-1">
                              w pakiecie:
                              {packaged.get(booking.ref)!.map((item) => (
                                <Link key={item.ref} href={`/trips/${id}/item/${encodeURIComponent(item.ref)}`} title="Karta punktu" className="btn-mini">
                                  {item.title}
                                </Link>
                              ))}
                            </span>
                          )}
                          {contacts.length > 0 && (
                            <span className="mt-0.5 flex flex-wrap items-center gap-1">
                              kontakty:
                              {contacts.map((contact) => (
                                <Fragment key={contact.ref}>
                                  <Link href={contactHref(id, contact.ref)} title="Na stronie Kontakty" className="btn-mini">
                                    {contact.name}
                                  </Link>
                                  {contact.phone && <span>{contact.phone}</span>}
                                </Fragment>
                              ))}
                            </span>
                          )}
                        </>
                      ) : null
                    }
                  >
                    <td className="py-1 pr-3 align-top">
                      <span className="font-medium">{booking.title}</span>
                      {/* Na telefonie rodzaj, termin i status pod nazwą — sześć kolumn się nie mieści. */}
                      <span className="block text-xs text-zinc-500 sm:hidden">{[BOOKING_KIND[booking.kind], bookingWhen(booking)].filter(Boolean).join(" · ")}</span>
                      <span className="block sm:hidden">{statusControl}</span>
                    </td>
                    <td className="hidden py-1 pr-3 align-top text-zinc-500 sm:table-cell">{BOOKING_KIND[booking.kind]}</td>
                    <td className="hidden py-1 pr-3 align-top text-zinc-500 sm:table-cell">{bookingWhen(booking)}</td>
                    <td className="hidden py-1 pr-3 align-top whitespace-nowrap sm:table-cell">{statusControl}</td>
                    <td className="py-1 text-right align-top font-mono whitespace-nowrap">
                      {cost}
                      {booking.paid && booking.status !== "paid" ? <span className="block font-sans text-xs text-zinc-500">zapłacono</span> : null}
                    </td>
                  </BookingRow>
                );
              })}
            </tbody>
          </table>
        )}
        {canEdit && <NewBooking tripId={id} statuses={statuses} zones={zones} places={doc.places} />}
        {canEdit && <BookingImport tripId={id} owner={membership.data?.role === "owner"} />}
        <HashFocus />
      </section>

      <Link href={`/trips/${id}/tasks`} className="btn-secondary self-start">
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
                  Dzień {index + 1} · {dayChip(day.date)}
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
function ExpenseList({
  tripId,
  canEdit,
  expenses,
  receipts,
  names,
  refOf,
  people,
  splits,
}: {
  tripId: string;
  canEdit: boolean;
  expenses: ExpenseRow[];
  receipts: Map<string, string>;
  names: Map<string, string>;
  refOf: Map<string, string>;
  people: { ref: string; name: string }[];
  splits: Record<string, unknown>[];
}) {
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
              <div className="flex-1">
                <strong>{formatMoney(Number(row.amount_minor), String(row.currency))}</strong> · {BUDGET_CATEGORY[String(row.category)] ?? String(row.category)}
                {payer ? ` · płacił(a): ${payer}` : ""}
                {row.note ? <span className="text-zinc-500"> · {String(row.note)}</span> : null}
                {people.length > 1 && <ExpenseSplitEditor tripId={tripId} expenseId={row.id} people={people} chosen={splits.filter((split) => split.expense_id === row.id).map((split) => String(split.traveler_id))} canEdit={canEdit} />}
              </div>
              <span className="text-xs text-zinc-500">{new Date(String(row.paid_at)).toLocaleDateString("pl-PL", { day: "numeric", month: "short" })}</span>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
