import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Next (Cache Components) nie odmontowuje opuszczonej strony, tylko ją ukrywa (`<Activity>`),
 * a przy powrocie (wstecz albo link) pokazuje z zachowanym stanem — także planem sprzed zmian
 * zrobionych w porównaniu ze szkicem albo na telefonie. Ukrycie i ponowne pokazanie uruchamia
 * efekty od nowa, a `ref` przeżywa, więc drugie uruchomienie = powrót: pobierz świeże dane.
 * Widok trzyma dokument w `useState`, dlatego strona daje mu `key` z wersji danych.
 */
export function useRefreshOnReturn() {
  const router = useRouter();
  const shown = useRef(false);
  useEffect(() => {
    if (shown.current) router.refresh();
    shown.current = true;
  }, [router]);
}
