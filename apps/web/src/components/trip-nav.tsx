"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";

import { CompareIcon, CompassIcon, InfoIcon, NoteIcon, PeopleIcon, RouteIcon, SparkIcon, TicketIcon, VaultIcon } from "@/components/icons";

/**
 * Szybkie przejście między sekcjami wyjazdu: rząd ikon pod górną belką, na każdej podstronie
 * wyjazdu (plan, rezerwacje, sejf…). Nazwa w podpowiedzi i dla czytnika ekranu; bieżąca sekcja
 * wyróżniona. Na stronie samego wyjazdu są duże kafelki, więc tam pasek się nie pokazuje.
 * Linki prowadzą do podglądu (bez `?edit=1`).
 */

const SECTIONS = [
  { path: "", title: "Wyjazd — wszystkie sekcje", Icon: CompassIcon },
  { path: "plan", title: "Plan dzień po dniu", Icon: RouteIcon },
  { path: "logistics", title: "Rezerwacje i budżet", Icon: TicketIcon },
  { path: "documents", title: "Sejf dokumentów", Icon: VaultIcon },
  { path: "practical", title: "Informacje praktyczne", Icon: InfoIcon },
  { path: "people", title: "Uczestnicy i dostęp", Icon: PeopleIcon },
  { path: "tune", title: "Dostrajanie z AI", Icon: SparkIcon },
  { path: "brief", title: "Brief wyjazdu", Icon: NoteIcon },
  { path: "compare", title: "Porównanie ze szkicem", Icon: CompareIcon },
] as const;

export function TripNav({ width }: { width: string }) {
  const params = useParams<{ id?: string }>();
  const pathname = usePathname();
  const id = params.id;
  if (id === undefined) return null;
  const base = `/trips/${id}`;
  const current = pathname.startsWith(`${base}/`) ? pathname.slice(base.length + 1).split("/")[0] : null;
  if (current === null || current === "") return null;

  return (
    <nav aria-label="Sekcje wyjazdu" className="border-b border-zinc-200 bg-[var(--background)] dark:border-zinc-800">
      <ul className={`mx-auto flex w-full ${width} gap-1.5 overflow-x-auto px-4 py-2`}>
        {SECTIONS.map(({ path, title, Icon }) => {
          const active = path === current;
          return (
            <li key={path} className="shrink-0">
              <Link
                href={path === "" ? base : `${base}/${path}`}
                title={title}
                aria-label={title}
                aria-current={active ? "page" : undefined}
                className={`flex size-9 items-center justify-center rounded-xl transition ${active ? "bg-sea text-white" : "bg-sea-light text-sea hover:bg-sea hover:text-white dark:bg-sea/20 dark:text-teal-300"}`}>
                <Icon className="size-5" />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
