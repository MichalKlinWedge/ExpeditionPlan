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
  return <PlaceLink tripId={tripId} place={place} className="btn-mini my-0 shrink-0 justify-center self-stretch px-2" size="size-5" />;
}

/** Sama pinezka do znanego miejsca (np. w tekście karty punktu). */
export function PlaceLink({ tripId, place, className = "btn-mini shrink-0 px-1.5", size = "size-4" }: { tripId: string; place: { ref: string; name: string }; className?: string; size?: string }) {
  return (
    <Link href={`/trips/${tripId}/places?miejsce=${encodeURIComponent(place.ref)}`} title={`„${place.name}” w Miejscach`} aria-label={`Pokaż „${place.name}” w Miejscach`} className={className}>
      <PinIcon className={size} />
    </Link>
  );
}
