import Link from "next/link";
import { Suspense } from "react";

import { UserMenu } from "./user-menu";

/** Wspólna rama stron: nazwa aplikacji, użytkownik, treść. */
export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-8">
      <header className="flex items-center justify-between gap-4">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          ExpeditionPlan <span className="font-normal text-zinc-500">· Planner Hub</span>
        </Link>
        <Suspense fallback={null}>
          <UserMenu />
        </Suspense>
      </header>
      <main className="flex flex-col gap-6">{children}</main>
    </div>
  );
}

export const Loading = () => <p className="text-sm text-zinc-500">Wczytuję…</p>;
