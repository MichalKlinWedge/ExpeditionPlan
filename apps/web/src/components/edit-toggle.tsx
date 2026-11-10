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
      // Przycisk funkcji, więc prostokątny (pigułka to przejście na inną stronę); w edycji pomarańczowy, żeby było widać tryb.
      className={`${editing ? "btn-primary" : "btn-secondary"} btn-sm shrink-0 self-start`}>
      {!editing && <PencilIcon className="size-4" />}
      {editing ? "Zakończ edycję" : "Edytuj"}
    </button>
  );
}
