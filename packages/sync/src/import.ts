import type { TripDocument, TripDocumentInput } from '@expeditionplan/core';
import type { SupabaseClient } from '@supabase/supabase-js';

import { rowsFromDocument } from './document.ts';
import { RemoteError } from './remote.ts';
import { uuidv7 } from './uuid.ts';

/**
 * Nowy wyjazd z całego dokumentu — jednym wywołaniem `import_trip`, czyli w jednej transakcji:
 * plan wchodzi w całości albo wcale. Wywołujący zostaje właścicielem.
 */
export async function importTrip(client: SupabaseClient, doc: TripDocumentInput | TripDocument, tripId = uuidv7()) {
  const rows = rowsFromDocument(doc, tripId, uuidv7);
  const { error } = await client.rpc('import_trip', { p_trip: rows.trip, p_tables: rows.tables });
  if (error) throw new RemoteError(error.message, error.code);
  return { tripId, rows };
}
