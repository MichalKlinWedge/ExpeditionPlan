import Link from "next/link";

import { PinIcon } from "@/components/icons";

/**
 * Przycisk z pinezką obok pola z nazwą miejsca: gdy wpisana nazwa to miejsce z tego wyjazdu, prowadzi do niego na
 * stronie Miejsca (`?miejsce=<ref>`). Ma wysokość pola, więc rodzic układa je w `flex items-stretch`.
 */
export function PlacePin({ tripId, places, name }: { tripId: string; places: readonly { ref: string; name: string }[]; name: string }) {
  const typed = name.trim().toLowerCase();
  const place = typed === "" ? undefined : places.find((each) => each.name.trim().toLowerCase() === typed);
  if (place === undefined) return null;
  return (
    <Link href={`/trips/${tripId}/places?miejsce=${encodeURIComponent(place.ref)}`} title={`„${place.name}” w Miejscach`} aria-label={`Pokaż „${place.name}” w Miejscach`} className="btn-mini my-0 shrink-0 justify-center self-stretch px-2">
      <PinIcon className="size-5" />
    </Link>
  );
}
