"use client";

import { itemInPlan, itemPlanFacts, type PlanStep, type TripDocument, variantsForItem } from "@expeditionplan/core";
import type { TripState } from "@expeditionplan/sync";
import Link from "next/link";
import type { ReactNode } from "react";

import { PlaceLink } from "@/components/place-pin";
import { readChosenVariants } from "@/lib/plan-variants";
import { useHydrated } from "@/lib/use-hydrated";

type Props = { tripId: string; doc: TripDocument; inputs: TripState["inputs"]; itemRef: string; editor?: ReactNode };

/**
 * „W planie” na karcie punktu: godziny z silnika dla wariantów wybranych w widoku planu (ta sama
 * pamięć karty przeglądarki), szczegóły z planu i przejście do poprzedniego i następnego punktu.
 * Godziny i sąsiedzi liczą się dopiero w przeglądarce — wybór wariantu jest tylko tam.
 * W trybie edycji zamiast szczegółów stoi formularz nagłówka punktu (`editor`).
 */
export function ItemPlanNav({ tripId, doc, inputs, itemRef, editor }: Props) {
  const hydrated = useHydrated();
  const item = doc.items.find((each) => each.ref === itemRef);
  if (item === undefined) return null;
  const facts = itemPlanFacts(doc, item);
  const href = (ref: string) => `/trips/${tripId}/item/${encodeURIComponent(ref)}`;
  const dayNumber = (dayRef: string) => doc.days.findIndex((day) => day.ref === dayRef) + 1;

  let plan: ReturnType<typeof itemInPlan> | null = null;
  let switched: string | null = null;
  if (hydrated) {
    const chosen = { ...inputs.activeVariants, ...readChosenVariants(tripId, doc) };
    const forItem = variantsForItem(doc, item, chosen);
    plan = itemInPlan(doc, item.ref, { activeVariants: forItem.variants, delays: inputs.delays, skipRefs: inputs.skipRefs, done: inputs.done, pulled: inputs.pulled });
    if (forItem.switched) switched = doc.variants.find((each) => each.ref === forItem.switched!.variantRef)?.label ?? null;
  }
  const scheduled = plan?.scheduled;
  // Miejsce punktu, a przy przejeździe skąd i dokąd w jednym wierszu: każde z pinezką do strony Miejsca.
  const placeOf = (ref: string | undefined) => (ref === undefined ? [] : doc.places.filter((each) => each.ref === ref));
  const route = item.leg ? [...placeOf(item.leg.fromPlaceRef), ...placeOf(item.leg.toPlaceRef)] : [];
  const own = item.placeRef !== undefined && item.placeRef !== item.leg?.fromPlaceRef && item.placeRef !== item.leg?.toPlaceRef ? placeOf(item.placeRef) : [];
  const places = [
    ...(route.length > 0 ? [{ label: item.leg?.fromPlaceRef && item.leg.toPlaceRef ? "Skąd → dokąd" : item.leg?.fromPlaceRef ? "Skąd" : "Dokąd", list: route }] : []),
    ...(own.length > 0 ? [{ label: "Miejsce", list: own }] : []),
  ];
  // Punkt w puli bez szczegółów: nie ma czego pokazać.
  if (item.dayRef === undefined && facts.length === 0 && editor === undefined) return null;
  const neighbour = (step: PlanStep, arrow: "prev" | "next") => {
    const other = step.dayRef !== item.dayRef ? `Dzień ${dayNumber(step.dayRef)}: ` : "";
    return (
      <Link href={href(step.ref)} className="btn-secondary btn-sm max-w-full truncate" aria-label={`${arrow === "prev" ? "Poprzedni" : "Następny"} punkt planu: ${other}${step.title}`}>
        {arrow === "prev" ? `← ${other}${step.title}` : `${other}${step.title} →`}
      </Link>
    );
  };

  return (
    <section className="card flex flex-col gap-2 p-4 text-sm">
      <h2 className="card-title">W planie</h2>
      {scheduled && (
        <p>
          <strong className="tabular-nums">
            {scheduled.routeStop ? `postój ${scheduled.durationMin} min w trakcie przejazdu` : `${scheduled.startLocal}–${scheduled.endLocal}${scheduled.endDate !== doc.days.find((day) => day.ref === item.dayRef)?.date ? " (+1)" : ""}`}
          </strong>
          {scheduled.statedLocal && scheduled.driftMin > 15 ? <span className="text-zinc-500"> · plan mówi {scheduled.statedLocal}, wychodzi +{scheduled.driftMin} min</span> : null}
          {scheduled.done ? <span className="text-zinc-500"> · ✓ zrobione w terenie</span> : null}
        </p>
      )}
      {hydrated && !scheduled && item.dayRef !== undefined && <p className="text-zinc-500">Punkt nie wchodzi do wyliczeń dnia (pominięty albo wyłączony przez wybrany wariant).</p>}
      {switched && <p className="text-zinc-500">W planie wybrany jest inny wariant — godziny i kolejność wg wariantu „{switched}”, do którego należy ten punkt.</p>}
      {plan?.warnings.map((warning, index) => (
        <p key={index} className={warning.severity === "hard" ? "msg-error" : "text-amber-600"}>
          {warning.severity === "hard" ? "⚠ " : "· "}
          {warning.message}
        </p>
      ))}
      {editor ?? ((places.length > 0 || facts.length > 0) && (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
          {places.map(({ label, list }) => (
            <div key={label} className="contents">
              <dt className="text-zinc-500">{label}</dt>
              <dd className="flex flex-wrap items-center gap-1.5">
                {list.map((place, index) => (
                  <span key={place.ref} className="flex items-center gap-1.5">
                    {index > 0 && <span className="text-zinc-400">→</span>}
                    {place.name}
                    <PlaceLink tripId={tripId} place={place} />
                  </span>
                ))}
              </dd>
            </div>
          ))}
          {facts.map((fact, index) => (
            <div key={index} className="contents">
              <dt className="text-zinc-500">{fact.label}</dt>
              <dd>
                {fact.text}
                {/* Godziny z silnika; postój w trasie ma tylko przybliżone położenie w ramach przejazdu. */}
                {fact.label === "Czas trwania" && scheduled && scheduled.end > scheduled.start && (
                  <span className="text-zinc-500 tabular-nums">
                    {" "}
                    · {scheduled.routeStop ? "ok. " : ""}
                    {scheduled.startLocal}–{scheduled.endLocal}
                  </span>
                )}
                {fact.refs && (
                  <span className="flex flex-wrap gap-1">
                    {fact.refs.map((each) => (
                      <Link key={each.ref} href={href(each.ref)} className="btn-mini">
                        {each.title}
                      </Link>
                    ))}
                  </span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      ))}
      {(plan?.previous || plan?.next) && (
        <nav aria-label="Sąsiednie punkty planu" className="flex flex-wrap items-center justify-between gap-2 pt-1">
          {plan.previous ? neighbour(plan.previous, "prev") : <span />}
          {plan.next ? neighbour(plan.next, "next") : <span />}
        </nav>
      )}
    </section>
  );
}
