import Link from "next/link";
import { Suspense } from "react";

import { CompassIcon } from "./icons";
import { RememberDetails } from "./remember-details";
import { TripNav } from "./trip-nav";
import { TaskAlerts } from "./task-alerts-server";
import { UserMenu } from "./user-menu";

/** Szerokość treści każdej strony: plan z mapą obok i film wyznaczają ją dla wszystkich. */
const CONTENT_WIDTH = "max-w-6xl";

/**
 * Wspólna rama stron: granatowy pasek z poziomicami (nazwa aplikacji, „Pomoc”, użytkownik) i treść. Każda strona ma tę
 * samą szerokość treści (jak plan z mapą obok i film), żeby przechodzenie między zakładkami nie skakało.
 */
export function Shell({ children }: { children: React.ReactNode }) {
  const width = CONTENT_WIDTH;
  return (
    <div className="flex flex-1 flex-col">
      <header className="topo shadow-md print:hidden">
        <div className={`mx-auto flex w-full ${width} items-center justify-between gap-4 px-4 py-4`}>
          <Link href="/" className="flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-full bg-signal text-white shadow">
              <CompassIcon className="size-6" />
            </span>
            <span className="flex flex-col leading-tight">
              <span className="font-display text-lg font-bold tracking-tight">Expedition Planner</span>
              <span className="text-xs text-zinc-300">Planner Hub</span>
            </span>
          </Link>
          <span className="flex items-center gap-3">
            {/* Zadania po terminie i zbliżające się we wszystkich moich wyjazdach (dochodzą strumieniem, tylko po zalogowaniu). */}
            <Suspense fallback={null}>
              <TaskAlerts />
            </Suspense>
            <Link href="/help" className="text-sm text-zinc-300 underline-offset-2 hover:text-white hover:underline">
              Pomoc
            </Link>
            <Suspense fallback={null}>
              <UserMenu />
            </Suspense>
          </span>
        </div>
      </header>
      {/* Adres (`useParams`) jest znany dopiero w czasie żądania — pasek dochodzi strumieniem. */}
      <div className="print:hidden">
        <Suspense fallback={null}>
          <TripNav width={width} />
        </Suspense>
      </div>
      <main className={`mx-auto flex w-full ${width} flex-col gap-6 px-4 py-8`}>{children}</main>
      {/* Zwijane sekcje pamiętają stan (localStorage, osobno dla każdej strony). */}
      <Suspense fallback={null}>
        <RememberDetails />
      </Suspense>
    </div>
  );
}

export const Loading = () => <p className="text-sm text-zinc-500">Wczytuję…</p>;
