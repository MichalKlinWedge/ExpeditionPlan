import { type DocumentVisibility, documentPath } from "@expeditionplan/core";
import { dbErrorMessage, uuidv7 } from "@expeditionplan/sync";

import { sha256 } from "@/lib/barcode";
import { createClient } from "@/lib/supabase/client";

/**
 * Wgranie pliku do sejfu z przeglądarki: plik do bucketu `documents`, potem wiersz `documents`;
 * nieudany wiersz sprząta plik. Wspólne dla sejfu i importu rezerwacji. O prawach decyduje RLS.
 */

export const VAULT_BUCKET = "documents";

export type VaultFields = {
  file_name: string;
  booking_id: string | null;
  item_id: string | null;
  visibility: DocumentVisibility;
  visible_to: string[];
  offline: boolean;
  code_payload: string | null;
  code_format: string | null;
};

/** `null` = zapisano, tekst = komunikat dla użytkownika. */
export async function uploadToVault(tripId: string, file: File, fields: VaultFields): Promise<string | null> {
  const supabase = createClient();
  const id = uuidv7();
  const path = documentPath(tripId, id, file.name);
  const upload = await supabase.storage.from(VAULT_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (upload.error) return dbErrorMessage(upload.error, "Nie wgrano pliku. Spróbuj jeszcze raz.");
  const { error } = await supabase.from("documents").insert({ ...fields, file_name: fields.file_name || file.name, id, trip_id: tripId, storage_path: path, mime: file.type, size: file.size, sha256: await sha256(file) });
  if (error) {
    await supabase.storage.from(VAULT_BUCKET).remove([path]);
    return dbErrorMessage(error, "Nie zapisano dokumentu. Spróbuj jeszcze raz.");
  }
  return null;
}
