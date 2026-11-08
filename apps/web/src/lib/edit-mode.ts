import { cookies } from "next/headers";

import { EDIT_COOKIE } from "@/lib/edit-cookie";

/** Tryb edycji (wspólny dla wszystkich stron, `EDIT_COOKIE`); strona sprawdza jeszcze, czy konto może edytować. */
export async function editMode(): Promise<boolean> {
  return (await cookies()).get(EDIT_COOKIE)?.value === "1";
}
