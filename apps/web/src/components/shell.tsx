import Link from "next/link";
import { Suspense } from "react";

import { CompassIcon } from "./icons";
import { UserMenu } from "./user-menu";

/** Wspólna rama stron: granatowy pasek z poziomicami (nazwa aplikacji, użytkownik) i treść. */
export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="topo shadow-md">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-4 py-4">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-full bg-signal text-white shadow">
              <CompassIcon className="size-6" />
            </span>
            <span className="flex flex-col leading-tight">
              <span className="font-display text-lg font-bold tracking-tight">ExpeditionPlan</span>
              <span className="text-xs text-zinc-300">Planner Hub</span>
            </span>
          </Link>
          <Suspense fallback={null}>
            <UserMenu />
          </Suspense>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8">{children}</main>
    </div>
  );
}

export const Loading = () => <p className="text-sm text-zinc-500">Wczytuję…</p>;
