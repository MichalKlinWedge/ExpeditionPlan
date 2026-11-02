import { dayItems, flightLine, flightOf, instantToZoned, itemIcon, legLabel, scheduleDay, type TripDocument } from "@expeditionplan/core";
import { stateFromPayload } from "@expeditionplan/sync";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PrintButton } from "@/components/print-button";
import { Loading } from "@/components/shell";
import { requireUser } from "@/lib/auth";
import { BOOKING_KIND, tripDates } from "@/lib/labels";

/**
 * Plan do druku / PDF (zapas na papierze): kontakty, rezerwacje i dni z godzinami z silnika
 * (scenariusz optymistyczny, warianty i zdarzenia jak w planie). Jasna kartka niezależnie od motywu;
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
  const { doc, inputs } = stateFromPayload(data as Parameters<typeof stateFromPayload>[0]);
  const places = new Map(doc.places.map((place) => [place.ref, place]));
  const items = new Map(doc.items.map((item) => [item.ref, item]));
  const options = { scenario: "optimistic" as const, activeVariants: inputs.activeVariants, delays: inputs.delays, skipRefs: inputs.skipRefs };
  const contacts = doc.contacts.filter((contact) => contact.phone || contact.email);
  const bookings = doc.bookings.filter((booking) => !["idea", "candidate", "cancelled"].includes(booking.status));

  return (
    <article className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-8 text-sm print:max-w-none print:px-0 print:py-0">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link href={`/trips/${id}`} className="text-sm text-zinc-500 underline">
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
        const rows = schedule?.items ?? dayItems(doc, day.ref).map((item) => ({ ref: item.ref, title: item.title, startLocal: "", endLocal: "" }));
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
                  const leg = item === undefined ? null : legLabel(item);
                  const flight = item === undefined ? undefined : flightOf(doc, item);
                  const extra = [place, leg, flight ? flightLine(flight) : undefined].filter(Boolean).join(" · ");
                  return (
                    <tr key={row.ref} className="break-inside-avoid border-b border-zinc-100 align-top">
                      <td className="w-24 py-0.5 pr-2 font-mono whitespace-nowrap">{row.startLocal ? `${row.startLocal}–${row.endLocal}` : ""}</td>
                      <td className="w-6 py-0.5">{item ? itemIcon(doc, item) : ""}</td>
                      <td className="py-0.5">
                        <strong className="font-semibold">{row.title}</strong>
                        {extra && <span className="text-zinc-600"> · {extra}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        );
      })}

      <footer className="border-t border-zinc-300 pt-2 text-xs text-zinc-500">Godziny orientacyjne (scenariusz optymistyczny) · ExpeditionPlan</footer>
    </article>
  );
}
