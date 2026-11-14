import { removeBooking } from './booking-remove.ts';
import { groupVariants, removeVariant, removeVariantGroup } from './plan-rules.ts';
import type { TripDocument } from './schemas/trip-document.ts';

/**
 * Usunięcie propozycji z porównania rezerwacji (grupa `scope: 'booking'`, strona „Rezerwacje i budżet”): znika jej
 * wariant i rezerwacje-kandydaci tego wariantu razem z odwołaniami do nich (`removeBooking`). Gdy zostaje jedna
 * propozycja, porównanie się kończy: zostaje ona jako zwykła rezerwacja (bez grupy), a noclegi dni i punkty wskazujące
 * grupę (`days.lodgingRef`, `items.bookingRef` — pola „rezerwacja albo porównanie”) wskazują ją. Zarezerwowanej albo opłaconej propozycji się tu nie usuwa — najpierw anulowanie w rezerwacjach.
 */

type Doc = TripDocument;
type Element = { ref?: string } & Record<string, unknown>;
export type CandidateRemovalWrite = { collection: string; element: { ref: string } & Record<string, unknown>; op: 'insert' | 'update' | 'remove' };
export type CandidateRemoval = { doc: Doc; writes: CandidateRemovalWrite[]; removedBookingRefs: string[]; ended: boolean; /** Zarezerwowane i opłacone, które zostały zwykłymi rezerwacjami. */ keptBookingRefs?: string[] };

const FIXED = new Set(['booked', 'paid']);

/** Zapisy między dwoma dokumentami: nowe i zmienione elementy, potem usunięte (rezerwacje przed wariantami, grupa na końcu). */
function writesBetween(before: Doc, after: Doc): CandidateRemovalWrite[] {
  const upserts: CandidateRemovalWrite[] = [];
  const removes: CandidateRemovalWrite[] = [];
  for (const [collection, list] of Object.entries(after)) {
    if (!Array.isArray(list)) continue;
    const old = (before as unknown as Record<string, unknown>)[collection];
    if (!Array.isArray(old)) continue;
    const previous = new Map((old as Element[]).filter((each) => typeof each?.ref === 'string').map((each) => [each.ref!, each]));
    const next = new Set<string>();
    for (const element of list as Element[]) {
      if (typeof element?.ref !== 'string') continue;
      next.add(element.ref);
      const was = previous.get(element.ref);
      if (was === undefined) upserts.push({ collection, element: element as CandidateRemovalWrite['element'], op: 'insert' });
      else if (JSON.stringify(was) !== JSON.stringify(element)) upserts.push({ collection, element: element as CandidateRemovalWrite['element'], op: 'update' });
    }
    for (const [ref, element] of previous) if (!next.has(ref)) removes.push({ collection, element: { ...element, ref }, op: 'remove' });
  }
  const order = (write: CandidateRemovalWrite) => (write.collection === 'variantGroups' ? 2 : write.collection === 'variants' ? 1 : 0);
  return [...upserts, ...removes.sort((a, b) => order(a) - order(b))];
}

export function removeCandidate(doc: Doc, groupRef: string, variantRef: string): CandidateRemoval | { error: string } {
  const group = doc.variantGroups.find((each) => each.ref === groupRef && each.scope === 'booking');
  if (group === undefined) return { error: 'Nie ma takiego porównania — odśwież stronę.' };
  const variant = groupVariants(doc, groupRef).find((each) => each.ref === variantRef);
  if (variant === undefined) return { error: 'Tej propozycji już nie ma — odśwież stronę.' };
  const own = doc.bookings.filter((booking) => booking.variantRef === variantRef);
  const fixed = own.find((booking) => FIXED.has(booking.status));
  if (fixed !== undefined) return { error: `„${fixed.title}” jest już zarezerwowana — najpierw zmień jej status na „anulowana”, potem usuń ją w rezerwacjach.` };

  let next = doc;
  for (const booking of own) next = removeBooking(next, booking.ref)?.doc ?? next;

  const rest = groupVariants(next, groupRef).filter((each) => each.ref !== variantRef);
  let ended = false;
  try {
    if (rest.length >= 2) {
      next = removeVariant(next, variantRef)!.doc;
    } else if (rest.length === 1) {
      // Jedna propozycja to już nie wybór: zostaje zwykłą rezerwacją, a to, co wskazywało grupę, wskazuje ją.
      const keep = rest[0]!;
      const kept = next.bookings.filter((booking) => booking.variantGroupRef === groupRef);
      const lodging = kept.length === 1 ? kept[0]!.ref : undefined;
      next = {
        ...next,
        bookings: next.bookings.map((booking) => {
          if (booking.variantGroupRef !== groupRef) return booking;
          const { variantGroupRef: _group, variantRef: _variant, ...plain } = booking;
          return plain;
        }),
        tasks: next.tasks.map((task) => {
          if (task.variantGroupRef !== groupRef) return task;
          const { variantGroupRef: _group, ...plain } = task;
          return plain;
        }),
        days: next.days.map((day) => {
          if (day.lodgingRef !== groupRef) return day;
          const { lodgingRef: _lodging, ...plain } = day;
          return lodging === undefined ? plain : { ...plain, lodgingRef: lodging };
        }),
        // Notatka o porównaniu staje się notatką o tej rezerwacji (bez niej — o wyjeździe).
        notes: next.notes.map((note) => {
          if (note.scope !== 'variant_group' || note.targetRef !== groupRef) return note;
          const { targetRef: _target, ...plain } = note;
          return lodging === undefined ? { ...plain, scope: 'trip' as const } : { ...plain, scope: 'booking' as const, targetRef: lodging };
        }),
        // Punkt (np. zameldowanie) wskazujący porównanie — teraz tę jedną rezerwację.
        items: next.items.map((item) => {
          if (item.bookingRef !== groupRef) return item;
          const { bookingRef: _booking, ...plain } = item;
          return lodging === undefined ? plain : { ...plain, bookingRef: lodging };
        }),
      };
      next = removeVariantGroup(next, groupRef, keep.ref)!.doc;
      ended = true;
    } else {
      return { error: 'Porównanie nie ma innych propozycji — usuń je w planie.' };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  return { doc: next, writes: writesBetween(doc, next), removedBookingRefs: own.map((booking) => booking.ref), ended };
}

/**
 * Usunięcie całego porównania rezerwacji: grupa, jej warianty i rezerwacje-kandydaci (`removeBooking`). Propozycje już
 * zarezerwowane albo opłacone zostają jako zwykłe rezerwacje (bez grupy) — gdy jest jedna, dni, punkty i notatki
 * wskazujące porównanie wskazują ją; inaczej przestają je wskazywać (notatki o porównaniu znikają).
 */
export function removeComparison(doc: Doc, groupRef: string): CandidateRemoval | { error: string } {
  const group = doc.variantGroups.find((each) => each.ref === groupRef && each.scope === 'booking');
  if (group === undefined) return { error: 'Nie ma takiego porównania — odśwież stronę.' };
  const variants = groupVariants(doc, groupRef);
  const own = doc.bookings.filter((booking) => booking.variantGroupRef === groupRef || (booking.variantRef !== undefined && variants.some((variant) => variant.ref === booking.variantRef)));
  const fixed = own.filter((booking) => FIXED.has(booking.status));
  const gone = own.filter((booking) => !FIXED.has(booking.status));
  const target = fixed.length === 1 ? fixed[0]!.ref : undefined;

  let next = doc;
  for (const booking of gone) next = removeBooking(next, booking.ref)?.doc ?? next;
  next = {
    ...next,
    bookings: next.bookings.map((booking) => {
      if (!fixed.some((each) => each.ref === booking.ref)) return booking;
      const { variantGroupRef: _group, variantRef: _variant, ...plain } = booking;
      return plain;
    }),
    tasks: next.tasks.map((task) => {
      if (task.variantGroupRef !== groupRef) return task;
      const { variantGroupRef: _group, ...plain } = task;
      return plain;
    }),
    days: next.days.map((day) => {
      if (day.lodgingRef !== groupRef) return day;
      const { lodgingRef: _lodging, ...plain } = day;
      return target === undefined ? plain : { ...plain, lodgingRef: target };
    }),
    items: next.items.map((item) => {
      if (item.bookingRef !== groupRef) return item;
      const { bookingRef: _booking, ...plain } = item;
      return target === undefined ? plain : { ...plain, bookingRef: target };
    }),
    notes:
      target === undefined
        ? next.notes.filter((note) => !(note.scope === 'variant_group' && note.targetRef === groupRef))
        : next.notes.map((note) => (note.scope === 'variant_group' && note.targetRef === groupRef ? { ...note, scope: 'booking' as const, targetRef: target } : note)),
  };
  try {
    // Punkty wybranej (albo pierwszej) propozycji zostają w planie, pozostałych — do puli; zwykle porównanie rezerwacji ich nie ma.
    const keep = fixed[0]?.variantRef ?? group.chosenRef ?? variants[0]?.ref;
    if (keep !== undefined) next = removeVariantGroup(next, groupRef, keep)!.doc;
    else next = { ...next, variantGroups: next.variantGroups.filter((each) => each.ref !== groupRef) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  return { doc: next, writes: writesBetween(doc, next), removedBookingRefs: gone.map((booking) => booking.ref), keptBookingRefs: fixed.map((booking) => booking.ref), ended: true };
}
