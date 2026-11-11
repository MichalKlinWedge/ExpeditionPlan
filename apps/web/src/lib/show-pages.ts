import type { ShowKind } from "@expeditionplan/core";

/** Nazwy i opisy obu pokazów z lektorem (strony, nawigacja, kafelki, publiczny link, ekran startowy filmu). */
export const SHOW_PAGES: Record<ShowKind, { title: string; label: string; about: string; ready: string }> = {
  preview: {
    title: "Film zapowiedź",
    label: "Zapowiedź wyjazdu",
    about: "zapowiedź wyjazdu: mapy, zdjęcia z opisów miejsc, głos",
    ready: "Mapy i zdjęcia są gotowe z planu.",
  },
  film: {
    title: "Film z wyjazdu",
    label: "Film z wyjazdu",
    about: "po powrocie: zdjęcia i wpisy z dziennika, mapy, głos",
    ready: "Mapy i zdjęcia z dziennika są gotowe.",
  },
};
