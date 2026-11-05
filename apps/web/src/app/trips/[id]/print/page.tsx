import { routeStopsLabel, routeStopTime, dayItems, flightLine, flightOf, type GuideRow, guideFor, instantToZoned, itemIcon, legLabel, scheduleDay, stopsLabel, type TripDocument } from "@expeditionplan/core";
import { refIndex, stateFromPayload } from "@expeditionplan/sync";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PrintButton } from "@/components/print-button";
import { Loading } from "@/components/shell";
import { requireUser } from "@/lib/auth";
import { BOOKING_KIND, tripDates } from "@/lib/labels";

/**
 * Plan do druku / PDF (zapas na papierze): kontakty, rezerwacje i dni z godzinami z silnika
 * (scenariusz optymistyczny, warianty i zdarzenia jak w planie), pod opisanymi punktami skrót
 * przewodnika (opis i trzy ciekawostki, raz na miejsce). Jasna kartka niezależnie od motywu;
 * przy druku znikają przyciski.
 */

type Doc = TripDocument;
type Booking = Doc["bookings"][number];

const CONTACT_ROLE: Record<string, string> = {
  emergency: "alarmowy",
  host: "gospodarz",
  operator: "organizator",
  rental: "wynajem",
  guide: "przewodnik",
  venue: "miejsce",
  other: "inny",
};

const weekday = (date: string) =>
  new Intl.DateTimeFormat("pl-PL", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
const shortDate = (date: string) => new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
const at = (time: Booking["start"]) => (time ? `${shortDate(time.date)}${time.time ? ` ${time.precision === "approx" ? "ok. " : ""}${time.time}` : ""}` : "");

export default function PrintPage(props: PageProps<"/trips/[id]/print">) {
  return (
    <div className="min-h-screen bg-white text-zinc-900 print:min-h-0">
      <Suspense fallback={<Loading />}>
        <PrintDoc params={props.params} />
      </Suspense>
    </div>
  );
}

async function PrintDoc({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireUser(`/trips/${id}/print`);
  const { data, error } = await supabase.rpc("pull_changes", { p_trip: id, p_since: 0 });
  if (error) return <p className="p-6 text-sm text-red-600">{error.message}</p>;
  if (data === null) notFound();
  const payload = data as Parameters<typeof stateFromPayload>[0];
  const { doc, inputs } = stateFromPayload(payload);
  const ids = refIndex(payload.tables);
  const guides = (payload.tables as unknown as { audio_guides?: GuideRow[] }).audio_guides ?? [];
  /** Miejsca, których przewodnik już jest na kartce — drugi punkt w tym samym miejscu go nie powtarza. */
  const printed = new Set<string>();
  const places = new Map(doc.places.map((place) => [place.ref, place]));
  const items = new Map(doc.items.map((item) => [item.ref, item]));
  const options = { scenario: "optimistic" as const, activeVariants: inputs.activeVariants, delays: inputs.delays, skipRefs: inputs.skipRefs, done: inputs.done, pulled: inputs.pulled };
  const contacts = doc.contacts.filter((contact) => contact.phone || contact.email);
  const bookings = doc.bookings.filter((booking) => !["idea", "candidate", "cancelled"].includes(booking.status));

  return (
    <article className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-8 text-sm print:max-w-none print:px-0 print:py-0">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link href={`/trips/${id}`} className="back-link">
          ← {doc.trip.title}
        </Link>
        <PrintButton />
      </div>

      <header className="border-b-2 border-zinc-900 pb-3">
        <h1 className="font-display text-3xl font-bold">{doc.trip.title}</h1>
        <p className="text-zinc-600">
          {tripDates(doc.trip.startDate, doc.trip.endDate)} · {doc.days.length} dni · {doc.travelers.length} os.
        </p>
      </header>

      {contacts.length > 0 && (
        <section className="break-inside-avoid">
          <h2 className="mb-1 text-base font-bold uppercase tracking-wide">Kontakty</h2>
          <ul className="grid gap-x-6 sm:grid-cols-2 print:grid-cols-2">
            {contacts.map((contact) => (
              <li key={contact.ref}>
                <strong>{contact.name}</strong> <span className="text-zinc-500">({CONTACT_ROLE[contact.role]})</span> {contact.phone ?? contact.email}
              </li>
            ))}
          </ul>
        </section>
      )}

      {bookings.length > 0 && (
        <section>
          <h2 className="mb-1 text-base font-bold uppercase tracking-wide">Rezerwacje</h2>
          <table className="w-full border-collapse">
            <tbody>
              {bookings.map((booking) => {
                const place = places.get(booking.startPlaceRef ?? "");
                const when = [at(booking.start), at(booking.end)].filter(Boolean).join(" – ");
                return (
                  <tr key={booking.ref} className="break-inside-avoid border-b border-zinc-200 align-top">
                    <td className="py-1 pr-3 whitespace-nowrap text-zinc-500">{BOOKING_KIND[booking.kind]}</td>
                    <td className="py-1 pr-3">
                      <strong>{booking.title}</strong>
                      {flightLine(booking) ? <span> · {flightLine(booking)}</span> : null}
                      {place?.address ? <span className="block text-zinc-500">{place.address}</span> : null}
                    </td>
                    <td className="py-1 pr-3 whitespace-nowrap">{when}</td>
                    <td className="py-1 font-mono whitespace-nowrap">{booking.confirmationCode ?? ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {doc.days.map((day, index) => {
        let schedule: ReturnType<typeof scheduleDay> | null = null;
        try {
          schedule = scheduleDay(doc, day.ref, options);
        } catch {
          schedule = null;
        }
        const base = day.baseRef === undefined ? undefined : places.get(day.baseRef)?.name;
        const sun = schedule?.facts.sun;
        const rows = schedule?.items ?? dayItems(doc, day.ref).map((item) => ({ ref: item.ref, title: item.title, startLocal: "", endLocal: "", routeStop: undefined as true | undefined, durationMin: 0, routeStopsMin: undefined as number | undefined }));
        return (
          <section key={day.ref} className="break-inside-avoid-page flex flex-col gap-1">
            <h2 className="border-b border-zinc-400 pb-0.5 text-lg font-bold">
              <span className="text-zinc-500">Dzień {index + 1} · </span>
              {weekday(day.date).replace(/^./, (first) => first.toUpperCase())}
              {day.title ? ` — ${day.title}` : ""}
            </h2>
            <p className="text-xs text-zinc-600">
              {base ? `Nocleg / baza: ${base}` : ""}
              {base && sun?.sunrise != null ? " · " : ""}
              {sun?.sunrise != null && sun.sunset != null ? `wschód ${instantToZoned(sun.sunrise, day.tz).time} · zachód ${instantToZoned(sun.sunset, day.tz).time}` : ""}
            </p>
            {day.summary && <p className="text-zinc-700">{day.summary}</p>}
            <table className="w-full border-collapse">
              <tbody>
                {rows.map((row) => {
                  const item = items.get(row.ref);
                  const place = item?.placeRef === undefined ? undefined : places.get(item.placeRef)?.name;
                  const leg = item === undefined ? null : (legLabel(item) ?? stopsLabel(item));
                  const flight = item === undefined ? undefined : flightOf(doc, item);
                  const extra = [place, leg, routeStopsLabel(row), flight ? flightLine(flight) : undefined].filter(Boolean).join(" · ");
                  const guideKey = item?.leg?.toPlaceRef ?? item?.placeRef ?? item?.ref;
                  const guide = item === undefined || guideKey === undefined || printed.has(guideKey) ? null : guideFor(guides, ids[item.ref], ids[guideKey]);
                  if (guide !== null && guideKey !== undefined) printed.add(guideKey);
                  return (
                    <tr key={row.ref} className="break-inside-avoid border-b border-zinc-100 align-top">
                      <td className="w-24 py-0.5 pr-2 font-mono whitespace-nowrap">{row.routeStop ? routeStopTime(row.durationMin) : row.startLocal ? `${row.startLocal}–${row.endLocal}` : ""}</td>
                      <td className="w-6 py-0.5">{item ? itemIcon(doc, item) : ""}</td>
                      <td className={`py-0.5 ${row.routeStop ? "pl-4" : ""}`}>
                        <strong className="font-semibold">{row.title}</strong>
                        {extra && <span className="text-zinc-600"> · {extra}</span>}
                        {guide && (
                          <div className="mt-0.5 mb-1 border-l-2 border-zinc-300 pl-2 text-xs text-zinc-700">
                            <p>{guide.summary}</p>
                            {guide.facts.length > 0 && (
                              <ul className="ml-4 list-disc">
                                {guide.facts.slice(0, 3).map((fact) => (
                                  <li key={fact}>{fact}</li>
                                ))}
                              </ul>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        );
      })}

      <footer className="border-t border-zinc-300 pt-2 text-xs text-zinc-500">
        Godziny orientacyjne (scenariusz optymistyczny)
        {printed.size > 0 ? " · Opisy miejsc: streszczenia AI artykułów z Wikipedii i Wikivoyage (CC BY-SA 4.0) oraz stron podanych przy opisie" : ""} · Expedition Planner
      </footer>
    </article>
  );
}
