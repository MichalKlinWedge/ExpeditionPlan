"use client";

import type { DayMap } from "@expeditionplan/core";
import { useState } from "react";

import { PlanMap } from "@/components/plan-map";

/** Mapa całej trasy w pamiątce: ta sama co w planie, tylko do oglądania (bez edycji). */
export function MemoriesMap({ map }: { map: DayMap }) {
  const [selected, setSelected] = useState<string | null>(null);
  return <PlanMap map={map} fitKey="trasa" selected={selected} onSelect={setSelected} />;
}
