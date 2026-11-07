import { isShopping, type TripDocument } from "@expeditionplan/core";

import { ShoppingList } from "@/components/logistics-editors";

/** Wspólna lista zakupów. Odhacza się ją na telefonie (offline), tu widać, co już kupione. Same posiłki: `meals-view.tsx`. */

type Row = Record<string, unknown> & { id: string; deleted_at?: string | null };

/** Pozycje listy zakupów z tym, co już kupione (odhaczenia z telefonu). */
export function shoppingItems(doc: TripDocument, tables: Record<string, Row[] | undefined>, ids: Record<string, string>) {
  const bought = new Set((tables.packing_checks ?? []).filter((row) => !row.deleted_at && row.packed === true).map((row) => String(row.packing_item_id)));
  return doc.packing.filter(isShopping).map((item) => ({ ...item, bought: bought.has(ids[item.ref] ?? "") }));
}

export function Shopping({ tripId, doc, tables, ids, canEdit }: { tripId: string; doc: TripDocument; tables: Record<string, Row[] | undefined>; ids: Record<string, string>; canEdit: boolean }) {
  const items = shoppingItems(doc, tables, ids);
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-zinc-600 dark:text-zinc-400">
        Kupione: <strong>{items.filter((item) => item.bought).length}</strong> z {items.length}. Odhacza się na telefonie (zakładka Sprzęt, lista Zakupy), także bez internetu.
      </p>
      <ShoppingList tripId={tripId} items={items} canEdit={canEdit} />
    </div>
  );
}
