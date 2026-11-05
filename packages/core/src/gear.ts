import { isShopping } from './meals.ts';
import type { TripDocument } from './schemas/trip-document.ts';

/**
 * Sprzęt: rzeczy do zabrania (lista pakowania bez zakupów). Osobiste pakuje każdy sam, wspólne
 * wymagają decyzji, kto je bierze — również po kawałku („Namiot × 3”, „Woda 28 l”). Tu: ile jeszcze
 * brakuje, co się dubluje i ile kto niesie. Kto bierze to dane spoza dokumentu (`packing_carriers`).
 */

type Doc = TripDocument;
type Item = Doc['packing'][number];

export type GearCarry = { itemRef: string; travelerRef: string; quantity: number };
export type GearCarrier = { travelerRef: string; quantity: number };
export type GearStatus = 'open' | 'partial' | 'covered' | 'over';
export type GearShare = { carriers: GearCarrier[]; needed: number; taken: number; /** Ile jeszcze nikt nie bierze. */ left: number; status: GearStatus };
export type GearLoad = {
  travelerRef: string;
  personal: Item[];
  shared: { item: Item; quantity: number }[];
  /** Waga rzeczy osobistych i wspólnych, które ją mają. */
  weightG: number;
  /** Ile rzeczy z listy osoby nie ma podanej wagi: suma jest wtedy zaniżona. */
  noWeight: number;
};

export const isGear = (item: Pick<Item, 'category'>) => !isShopping(item);

/** Wiersze `packing_carriers` jako klucze dokumentu; wiersze usuniętych rzeczy i osób odpadają. */
export function carriesFromRows(rows: readonly Record<string, unknown>[], ids: Record<string, string>): GearCarry[] {
  const refOf = new Map(Object.entries(ids).map(([ref, id]) => [id, ref]));
  return rows.flatMap((row) => {
    const itemRef = refOf.get(String(row.packing_item_id));
    const travelerRef = refOf.get(String(row.traveler_id));
    if (row.deleted_at || itemRef === undefined || travelerRef === undefined) return [];
    return [{ itemRef, travelerRef, quantity: Number(row.quantity) }];
  });
}

/**
 * Kto bierze rzecz wspólną. Osoba wskazana w planie (`assigneeRef`, np. z importu) bierze całość,
 * póki nie ma własnego wiersza: inni mogą dołączyć, a zdejmuje ją dopiero jej własne „nie biorę”.
 */
export function gearCarriers(item: Item, carries: readonly GearCarry[]): GearCarrier[] {
  if (item.scope !== 'shared') return [];
  const rows = carries.filter((carry) => carry.itemRef === item.ref);
  const chosen = rows.filter((row) => row.quantity > 0).map(({ travelerRef, quantity }) => ({ travelerRef, quantity }));
  const planned = item.assigneeRef !== undefined && !rows.some((row) => row.travelerRef === item.assigneeRef);
  return planned ? [{ travelerRef: item.assigneeRef!, quantity: item.quantity ?? 1 }, ...chosen] : chosen;
}

export function gearShare(item: Item, carries: readonly GearCarry[]): GearShare {
  const carriers = gearCarriers(item, carries);
  const needed = item.quantity ?? 1;
  const taken = carriers.reduce((sum, carrier) => sum + carrier.quantity, 0);
  const left = Math.max(0, needed - taken);
  const status: GearStatus = taken === 0 ? 'open' : left > 0 ? 'partial' : taken > needed ? 'over' : 'covered';
  return { carriers, needed, taken, left, status };
}

/** Ile bierze ktoś, kto właśnie mówi „biorę”: sztukę, a gdy zostało mniej — resztę. */
export const defaultTake = (share: Pick<GearShare, 'left'>) => (share.left > 0 && share.left < 1 ? share.left : 1);

const weightOf = (item: Item, quantity: number) => (item.weightG === undefined ? 0 : item.weightG * quantity);

/** Lista i obciążenie każdego uczestnika, w kolejności z dokumentu. */
export function gearLoads(doc: Doc, carries: readonly GearCarry[]): GearLoad[] {
  const gear = doc.packing.filter(isGear);
  return doc.travelers.map(({ ref }) => {
    const personal = gear.filter((item) => item.scope === 'personal' && (item.assigneeRef === undefined || item.assigneeRef === ref));
    const shared = gear.flatMap((item) => {
      const carrier = gearCarriers(item, carries).find((each) => each.travelerRef === ref);
      return carrier === undefined ? [] : [{ item, quantity: carrier.quantity }];
    });
    const lines = [...personal.map((item) => ({ item, quantity: item.quantity ?? 1 })), ...shared];
    return {
      travelerRef: ref,
      personal,
      shared,
      weightG: lines.reduce((sum, line) => sum + weightOf(line.item, line.quantity), 0),
      noWeight: lines.filter((line) => line.item.weightG === undefined).length,
    };
  });
}

/** Rzeczy wspólne, których jeszcze nikt nie bierze albo bierze tylko część. */
export const gearGaps = (doc: Doc, carries: readonly GearCarry[]): Item[] =>
  doc.packing.filter((item) => isGear(item) && item.scope === 'shared' && gearShare(item, carries).left > 0);

/** „1,5 kg” albo „800 g”. */
export function formatWeight(grams: number): string {
  if (grams < 1000) return `${Math.round(grams)} g`;
  return `${(grams / 1000).toLocaleString('pl-PL', { maximumFractionDigits: 1 })} kg`;
}

/** Waga z pola w kilogramach („1,5”) na gramy; puste = brak, śmieci = `null`. */
export function parseWeightKg(value: string): number | undefined | null {
  const text = value.trim().replace(',', '.');
  if (text === '') return undefined;
  const grams = Math.round(Number(text) * 1000);
  return Number.isFinite(grams) && grams > 0 ? grams : null;
}
