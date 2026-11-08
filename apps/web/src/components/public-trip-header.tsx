import Link from "next/link";

import { tripDates } from "@/lib/labels";

/** Nagłówek publicznego linku: nazwa wyjazdu i przejście między ogólnym opisem, planem dzień po dniu i pokazem (gdy właściciel go udostępnił). */
export function PublicTripHeader({ token, trip, active, show = false }: { token: string; trip: { title: string; startDate: string; endDate: string }; active: "overview" | "plan" | "show"; show?: boolean }) {
  const base = `/p/${encodeURIComponent(token)}`;
  const tab = (name: "overview" | "plan" | "show", href: string, label: string) => (
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
        {show && tab("show", `${base}/show`, "Pokaz z lektorem")}
      </nav>
    </section>
  );
}
