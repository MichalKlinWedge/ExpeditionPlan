"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { ArticleIcon, BackpackIcon, BallotIcon, BookIcon, CartIcon, CompareIcon, CompassIcon, FilmIcon, InfoIcon, ListIcon, MealIcon, NoteIcon, PeakIcon, PhoneIcon, PeopleIcon, PinIcon, PrinterIcon, RouteIcon, SparkIcon, TicketIcon, VaultIcon } from "@/components/icons";
import { tripDates } from "@/lib/labels";
import { createClient } from "@/lib/supabase/client";

/**
 * Szybkie przejście między sekcjami wyjazdu: rząd ikon pod górną belką, na każdej podstronie
 * wyjazdu (plan, rezerwacje, sejf…). Nazwa w podpowiedzi i dla czytnika ekranu; bieżąca sekcja
 * wyróżniona. Na stronie samego wyjazdu są duże kafelki, więc tam pasek się nie pokazuje.
 * Tryb edycji jest wspólny dla stron (`lib/edit-mode.ts`), linki go nie zmieniają. Dostrajanie i porównanie są dla organizatora i edytora,
 * a pamiątka od początku wyjazdu, tak jak kafelki: te pozycje dochodzą po odczytaniu roli i dat.
 * Pod ikonami nazwa wyjazdu i jego daty, żeby na każdej podstronie było widać, którego wyjazdu dotyczy.
 */

const SECTIONS = [
  { path: "", title: "Wyjazd — wszystkie sekcje", Icon: CompassIcon },
  { path: "plan", title: "Plan dzień po dniu", Icon: RouteIcon },
  { path: "places", title: "Miejsca", Icon: PinIcon },
  { path: "guides", title: "Opisy miejsc", Icon: ArticleIcon },
  { path: "logistics", title: "Rezerwacje i budżet", Icon: TicketIcon },
  { path: "tasks", title: "Zadania", Icon: ListIcon },
  { path: "votes", title: "Głosowanie", Icon: BallotIcon },
  { path: "gear", title: "Sprzęt", Icon: BackpackIcon },
  { path: "meals", title: "Posiłki", Icon: MealIcon },
  { path: "shopping", title: "Lista zakupów", Icon: CartIcon },
  { path: "contacts", title: "Kontakty", Icon: PhoneIcon },
  { path: "documents", title: "Sejf dokumentów", Icon: VaultIcon },
  { path: "practical", title: "Informacje praktyczne", Icon: InfoIcon },
  { path: "journal", title: "Dziennik", Icon: BookIcon },
  { path: "people", title: "Uczestnicy i dostęp", Icon: PeopleIcon },
  { path: "tune", title: "Dostrajanie z AI", Icon: SparkIcon },
  { path: "brief", title: "Brief wyjazdu", Icon: NoteIcon },
  { path: "compare", title: "Porównanie ze szkicem", Icon: CompareIcon },
  { path: "print", title: "Wydruk / PDF", Icon: PrinterIcon },
  { path: "memories", title: "Pamiątka z wyjazdu", Icon: PeakIcon },
  { path: "show", title: "Pokaz z lektorem", Icon: FilmIcon },
] as const;

type Access = { canEdit: boolean; started: boolean; title: string; dates: string | null; postponed: boolean };

export function TripNav({ width }: { width: string }) {
  const params = useParams<{ id?: string }>();
  const pathname = usePathname();
  const id = params.id;
  const [access, setAccess] = useState<Access | null>(null);
  useEffect(() => {
    if (id === undefined) return;
    let current = true;
    void createClient()
      .from("my_trips")
      .select("role, start_date, end_date, status, title")
      .eq("id", id)
      .maybeSingle()
      .then(({ data }) => {
        if (!current || data === null) return;
        const today = new Date().toISOString().slice(0, 10);
        const started = data.status !== "postponed" && !(data.title ?? "").startsWith("Szkic AI: ") && (data.start_date ?? today) <= today;
        setAccess({
          canEdit: data.role === "owner" || data.role === "editor",
          started,
          title: data.title ?? "",
          dates: data.start_date && data.end_date ? tripDates(data.start_date, data.end_date) : null,
          postponed: data.status === "postponed",
        });
      });
    return () => {
      current = false;
    };
  }, [id]);
  if (id === undefined) return null;
  const base = `/trips/${id}`;
  const current = pathname.startsWith(`${base}/`) ? pathname.slice(base.length + 1).split("/")[0] : null;
  if (current === null || current === "") return null;

  return (
    <nav aria-label="Sekcje wyjazdu" className="border-b border-zinc-200 bg-[var(--background)] dark:border-zinc-800">
      <ul className={`mx-auto flex w-full ${width} gap-1.5 overflow-x-auto px-4 py-2 sm:flex-wrap sm:gap-1 sm:overflow-visible`}>
        {SECTIONS.map(({ path, title, Icon }) => {
          const active = path === current;
          const hidden = ((path === "tune" || path === "compare") && !access?.canEdit) || (path === "memories" && !access?.started);
          if (hidden && !active) return null;
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
      {access && (
        <p className={`mx-auto w-full ${width} truncate px-4 pb-2 text-sm`}>
          <span className="font-semibold">{access.title}</span>
          {access.dates && (
            <span className="text-zinc-600 dark:text-zinc-400">
              {" "}
              · {access.dates}
              {access.postponed ? " (termin wstępny, wyjazd odłożony)" : ""}
            </span>
          )}
        </p>
      )}
    </nav>
  );
}
