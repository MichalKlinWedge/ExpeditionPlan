import Link from "next/link";

import { tripDates } from "@/lib/labels";

/** Nagłówek publicznego linku: nazwa wyjazdu i przejście między ogólnym opisem a planem dzień po dniu. */
export function PublicTripHeader({ token, trip, active }: { token: string; trip: { title: string; startDate: string; endDate: string }; active: "overview" | "plan" }) {
  const base = `/p/${encodeURIComponent(token)}`;
  const tab = (name: "overview" | "plan", href: string, label: string) => (
    <Link href={href} aria-current={active === name ? "page" : undefined} className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${active === name ? "bg-white text-zinc-900" : "text-zinc-200 hover:bg-white/10 hover:text-white"}`}>
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
      </nav>
    </section>
  );
}
