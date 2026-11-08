"use client";

import { usePathname, useRouter } from "next/navigation";

import { PencilIcon } from "@/components/icons";
import { EDIT_COOKIE } from "@/lib/edit-cookie";

/**
 * Podgląd albo edycja — jeden tryb dla wszystkich stron: „Edytuj” włącza edycję wszędzie,
 * „Zakończ edycję” kończy ją wszędzie (ciasteczko sesji `EDIT_COOKIE`, czytane na serwerze).
 * `router.refresh()` przelicza bieżącą stronę i czyści zapamiętane inne. Tylko dla organizatora i edytora.
 */
export function EditToggle({ editing }: { editing: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const toggle = () => {
    document.cookie = editing ? `${EDIT_COOKIE}=; path=/; max-age=0; samesite=lax` : `${EDIT_COOKIE}=1; path=/; samesite=lax`;
    // Stary adres z `?edit=1` (zakładka) nie może zostawić edycji włączonej.
    if (window.location.search.includes("edit=")) {
      const params = new URLSearchParams(window.location.search);
      params.delete("edit");
      const query = params.toString();
      router.replace(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
    }
    router.refresh();
  };
  return (
    <button
      type="button"
      onClick={toggle}
      className={editing ? "inline-flex shrink-0 items-center gap-1.5 self-start rounded-full border border-signal bg-signal px-3 py-1 text-sm text-white transition hover:bg-signal-dark" : "btn-secondary shrink-0 self-start rounded-full px-3 py-1"}>
      {!editing && <PencilIcon className="size-4" />}
      {editing ? "Zakończ edycję" : "Edytuj"}
    </button>
  );
}
