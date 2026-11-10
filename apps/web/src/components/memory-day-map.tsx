"use client";

import type { DayMap } from "@expeditionplan/core";
import { useEffect, useRef, useState } from "react";

import { MemoriesMap } from "@/components/memories-map";

/**
 * Mapa dnia na osi czasu pamiątki. Przeglądarka ma kilkanaście kontekstów WebGL na stronę, a dni bywa więcej:
 * mapa powstaje dopiero blisko ekranu i znika, gdy odjedzie daleko. Do druku jest ślad trasy obok (`RouteTrace`).
 */
export function MemoryDayMap({ map, square = false }: { map: DayMap; square?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const element = box.current;
    if (element === null) return;
    const observer = new IntersectionObserver(([entry]) => setNear(entry?.isIntersecting ?? false), { rootMargin: "800px 0px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={box} className="print:hidden">
      {near ? (
        <MemoriesMap map={map} banner={!square} square={square} fitLines={square} />
      ) : (
        <div className={`rounded-xl border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 ${square ? "aspect-square" : "h-72 lg:h-[calc(50vh-4rem)]"}`} />
      )}
    </div>
  );
}
