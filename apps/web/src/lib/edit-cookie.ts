/**
 * Wspólny tryb edycji wszystkich stron wyjazdu: ciasteczko sesji ustawiane przez „Edytuj”
 * i kasowane przez „Zakończ edycję” (`components/edit-toggle.tsx`), czytane na serwerze
 * (`lib/edit-mode.ts`). Bez niego strony są w podglądzie.
 */
export const EDIT_COOKIE = "tryb_edycji";
