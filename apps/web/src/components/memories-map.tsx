"use client";

import type { DayMap } from "@expeditionplan/core";
import { useState } from "react";

import { PlanMap } from "@/components/plan-map";

/** Mapa całej trasy w pamiątce: ta sama co w planie, tylko do oglądania (bez edycji). */
export function MemoriesMap({ map, banner = false, square = false, fitLines = false }: { map: DayMap; banner?: boolean; square?: boolean; fitLines?: boolean }) {
  const [selected, setSelected] = useState<string | null>(null);
  return <PlanMap map={map} fitKey="trasa" selected={selected} onSelect={setSelected} banner={banner} square={square} fitLines={fitLines} />;
}
