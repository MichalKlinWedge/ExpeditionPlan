"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * Zwijane sekcje (`<details>`) pamiętają, czy były otwarte — w przeglądarce (`localStorage`), osobno
 * dla każdej strony (adres bez parametrów, więc też dla każdego wyjazdu). Klucz sekcji: `data-remember`
 * albo tekst nagłówka bez liczb („Do porównania (1) — wybrane: 0” → „Do porównania wybrane:”), żeby
 * licznik w nagłówku nie gubił zapamiętanego stanu. Działa dla wszystkich stron naraz — jeden komponent
 * w ramie (`Shell`), bez zmian w samych sekcjach; bez zapisu (tryb prywatny) sekcje mają stan domyślny.
 * Zapisuje się tylko zmiana zrobiona przez użytkownika (kliknięcie nagłówka) — sekcja otwarta przez
 * stronę (np. „Plan a wydatki” w trakcie wyjazdu) zostaje przy stanie domyślnym, póki ktoś jej nie zwinie.
 */

const PREFIX = "details:";

function keyOf(pathname: string, details: HTMLDetailsElement): string | null {
  const name =
    details.dataset.remember ??
    details
      .querySelector(":scope > summary")
      ?.textContent?.replace(/[\d()]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  return name ? `${PREFIX}${pathname}:${name}` : null;
}

function read(key: string): boolean | null {
  try {
    const value = localStorage.getItem(key);
    return value === null ? null : value === "1";
  } catch {
    return null;
  }
}

function write(key: string, open: boolean) {
  try {
    localStorage.setItem(key, open ? "1" : "0");
  } catch {
    // Bez zapisu — sekcja wróci do stanu domyślnego.
  }
}

export function RememberDetails() {
  const pathname = usePathname();

  useEffect(() => {
    const restore = (root: ParentNode) => {
      const list = root instanceof HTMLDetailsElement ? [root] : Array.from(root.querySelectorAll("details"));
      for (const details of list) {
        const key = keyOf(pathname, details);
        const saved = key === null ? null : read(key);
        if (saved !== null && details.open !== saved) details.open = saved;
      }
    };
    restore(document);

    // Kliknięcie (albo Enter/spacja) w nagłówek = zmiana od użytkownika; tylko taką zapisujemy.
    const touched = new WeakSet<HTMLDetailsElement>();
    const onClick = (event: Event) => {
      const summary = event.target instanceof Element ? event.target.closest("summary") : null;
      if (summary?.parentElement instanceof HTMLDetailsElement) touched.add(summary.parentElement);
    };
    // `toggle` nie wypływa w górę — łapiemy go w fazie przechwytywania.
    const onToggle = (event: Event) => {
      const details = event.target;
      if (!(details instanceof HTMLDetailsElement) || !touched.has(details)) return;
      touched.delete(details);
      const key = keyOf(pathname, details);
      if (key !== null) write(key, details.open);
    };
    document.addEventListener("click", onClick, true);
    document.addEventListener("toggle", onToggle, true);

    // Sekcje dochodzące później (strumień, przełączenie dnia, formularze) — też dostają zapamiętany stan.
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) if (node instanceof HTMLElement) restore(node);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("toggle", onToggle, true);
      observer.disconnect();
    };
  }, [pathname]);

  return null;
}
