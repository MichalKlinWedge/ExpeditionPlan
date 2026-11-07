/**
 * Rezerwacja w tabeli „Rezerwacje” na stronie „Rezerwacje i budżet”: wiersz ma kotwicę, więc plan i karta
 * punktu prowadzą prosto do niego. Kandydaci i pomysły są wyżej, w „Do porównania”, i kotwicy nie mają.
 */

type BookingLike = { ref: string; status: string };

export const isListedBooking = (booking: Pick<BookingLike, "status">) => booking.status !== "candidate" && booking.status !== "idea";

export const bookingAnchor = (ref: string) => `rezerwacja-${ref}`;

export const contactAnchor = (ref: string) => `kontakt-${ref}`;

/** Kontakt na stronie „Kontakty” (z rezerwacji). */
export const contactHref = (tripId: string, ref: string) => `/trips/${tripId}/contacts#${encodeURIComponent(contactAnchor(ref))}`;

/** `null` dla kandydata i pomysłu. */
export function bookingHref(tripId: string, booking: BookingLike): string | null {
  return isListedBooking(booking) ? `/trips/${tripId}/logistics#${encodeURIComponent(bookingAnchor(booking.ref))}` : null;
}
