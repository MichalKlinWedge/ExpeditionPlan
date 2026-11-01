import { useSyncExternalStore } from "react";

/**
 * `true` dopiero w przeglądarce (po hydratacji). Godziny planu liczy silnik przez `Intl` z bazą
 * stref systemu, a ta bywa inna w Node i w przeglądarce (Maroko: tzdata 2026b w Node, starsza
 * w Chromium — godzina różnicy), co psuje hydratację. Plan ogląda się w przeglądarce, więc
 * godziny liczy tylko ona.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );
}
