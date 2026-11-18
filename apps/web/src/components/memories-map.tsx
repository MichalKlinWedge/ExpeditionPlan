"use client";

import type { DayMap } from "@expeditionplan/core";
import { useState } from "react";

import { PlanMap } from "@/components/plan-map";

/**
 * Mapa całej trasy w pamiątce: ta sama co w planie, tylko do oglądania (bez edycji). Z `anchors` (punkt → id elementu
 * strony, `timelineAnchors`) dotknięcie pinezki przewija stronę do tego punktu na osi i na chwilę go podświetla.
 */
export function MemoriesMap({ map, banner = false, square = false, fitLines = false, anchors }: { map: DayMap; banner?: boolean; square?: boolean; fitLines?: boolean; anchors?: Record<string, string> }) {
  const [selected, setSelected] = useState<string | null>(null);
  const select = (ref: string) => {
    setSelected(ref);
    const id = anchors?.[ref];
    const target = id === undefined ? null : document.getElementById(id);
    if (target === null) return;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    target.classList.add("ring-2", "ring-signal");
    window.setTimeout(() => target.classList.remove("ring-2", "ring-signal"), 1800);
  };
  return <PlanMap map={map} fitKey="trasa" selected={selected} onSelect={select} banner={banner} square={square} fitLines={fitLines} />;
}
