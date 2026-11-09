import Link from "next/link";

import { tripDates } from "@/lib/labels";
import { SHOW_PAGES } from "@/lib/show-pages";

type Tab = "overview" | "plan" | "show" | "film";

/** Nagłówek publicznego linku: nazwa wyjazdu i przejście między ogólnym opisem, planem dzień po dniu i pokazami (gdy właściciel je udostępnił). */
export function PublicTripHeader({
  token,
  trip,
  active,
  shows = { show: false, film: false },
}: {
  token: string;
  trip: { title: string; startDate: string; endDate: string };
  active: Tab;
  shows?: { show: boolean; film: boolean };
}) {
  const base = `/p/${encodeURIComponent(token)}`;
  const tab = (name: Tab, href: string, label: string) => (
    <Link href={href} aria-current={active === name ? "page" : undefined} className={`rounded-lg border px-3 py-1.5 text-sm font-semibold transition ${active === name ? "border-white bg-white text-zinc-900" : "border-white/50 bg-white/15 text-white hover:border-white hover:bg-white/25"}`}>
      {label}
    </Link>
  );
  return (
    <section className="topo flex flex-col gap-2 rounded-2xl px-6 py-6 shadow-md">
      <h1 className="text-3xl font-bold text-white">{trip.title}</h1>
      <p className="text-zinc-200">{tripDates(trip.startDate, trip.endDate)} · tylko do odczytu</p>
      <nav aria-label="Widok wyjazdu" className="mt-1 flex flex-wrap gap-1.5">
        {tab("overview", base, "Opis wyprawy")}
        {tab("plan", `${base}/plan`, "Plan dzień po dniu")}
        {shows.show && tab("show", `${base}/show`, SHOW_PAGES.preview.title)}
        {shows.film && tab("film", `${base}/film`, SHOW_PAGES.film.title)}
      </nav>
    </section>
  );
}
