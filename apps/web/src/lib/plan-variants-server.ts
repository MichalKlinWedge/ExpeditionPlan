import { cookies } from "next/headers";

import { variantsCookie } from "@/lib/plan-variants";

/**
 * Warianty wybrane w widoku planu (ciasteczko sesji z `saveChosenVariants`), czytane na serwerze: film i zapowiedź
 * pokazują ten sam wariant dnia co plan. Zepsute albo puste = `{}` (warianty wybrane w planie).
 */
export async function chosenVariantsFromCookie(tripId: string): Promise<Record<string, string>> {
  const raw = (await cookies()).get(variantsCookie(tripId))?.value;
  if (raw === undefined) return {};
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(raw));
    if (typeof parsed !== "object" || parsed === null) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch {
    return {};
  }
}
