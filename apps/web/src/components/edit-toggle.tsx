import Link from "next/link";

import { PencilIcon } from "@/components/icons";

/**
 * Podgląd albo edycja strony wyjazdu. Strona otwiera się w podglądzie; tryb edycji to `?edit=1`
 * w adresie, więc znają go i części serwerowe (formularze, akcje), i widok w przeglądarce,
 * a zwykły link zawsze prowadzi do podglądu. Tylko dla organizatora i edytora.
 */
export function EditToggle({ href, editing }: { href: string; editing: boolean }) {
  return (
    <Link
      href={editing ? href : `${href}?edit=1`}
      scroll={false}
      replace
      className={editing ? "inline-flex shrink-0 items-center gap-1.5 self-start rounded-full border border-signal bg-signal px-3 py-1 text-sm text-white transition hover:bg-signal-dark" : "btn-secondary shrink-0 self-start rounded-full px-3 py-1"}>
      {!editing && <PencilIcon className="size-4" />}
      {editing ? "Zakończ edycję" : "Edytuj"}
    </Link>
  );
}

/** `?edit=1` z adresu strony — tryb edycji (dla tych, którzy mogą edytować). */
export async function editMode(searchParams: Promise<Record<string, string | string[] | undefined>>): Promise<boolean> {
  return (await searchParams).edit === "1";
}
