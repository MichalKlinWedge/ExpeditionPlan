import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Nagłówek strony — jeden układ wszędzie: powrót do strony nadrzędnej, tytuł z działaniami przy prawej
 * krawędzi („Edytuj”, przyciski strony), opis pod tytułem i na końcu `children` (np. edytor nagłówka punktu).
 * Dzięki temu „Edytuj” i opis stoją na każdej stronie w tym samym miejscu.
 */
export function PageHeader({
  back,
  title,
  actions,
  intro,
  children,
}: {
  back?: { href: string; label: ReactNode };
  title: ReactNode;
  actions?: ReactNode;
  intro?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-1">
      {back && (
        <Link href={back.href} className="back-link print:hidden">
          ← {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-2">
        {/* Długi tytuł zawija się obok działań; dopiero na wąskim ekranie działania schodzą pod niego. */}
        <h1 className="flex min-w-0 flex-1 basis-64 items-center gap-2 text-2xl font-semibold">{title}</h1>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2 print:hidden">{actions}</div>}
      </div>
      {intro && <p className="text-sm text-zinc-600 dark:text-zinc-400">{intro}</p>}
      {children}
    </header>
  );
}
