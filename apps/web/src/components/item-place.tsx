"use client";

import { type PlanEdit, type PlanItem as Item, placeUses, renamePlace, replacePlace, setItemPlace, type TripDocument } from "@expeditionplan/core";
import { uuidv7 } from "@expeditionplan/sync";
import { useId, useState } from "react";

import { PlacePin } from "@/components/place-pin";

/**
 * Miejsce punktu w edycji: poprawa nazwy, „to inny lokal” (ta sama pozycja w planie, stare współrzędne
 * i adres znikają) albo inne miejsce tylko dla tego punktu. Nazwa miejsca jest wspólna: punkt, baza
 * dnia, nocleg i rezerwacje pokazują to samo, więc dwie pierwsze akcje zmieniają je wszędzie.
 */
/** `tripId` — pinezka przy polu prowadzi do wpisanego miejsca na stronie Miejsca. */
export function ItemPlaceEditor({ tripId, doc, item, onEdit, disabled = false }: { tripId?: string; doc: TripDocument; item: Item; onEdit: (edit: PlanEdit | null) => void; disabled?: boolean }) {
  const place = item.placeRef === undefined ? undefined : doc.places.find((each) => each.ref === item.placeRef);
  const [name, setName] = useState(place?.name ?? "");
  const listId = useId();
  const typed = name.trim();
  const changed = typed !== "" && typed !== place?.name;
  const uses = place === undefined ? 0 : placeUses(doc, place.ref);
  return (
    <div className="mt-2 flex flex-col gap-2 panel p-3 text-sm">
      <label className="flex flex-col gap-1 text-xs text-zinc-500">
        Miejsce
        <span className="flex items-stretch gap-1">
          <input value={name} onChange={(event) => setName(event.target.value)} list={listId} placeholder="Nazwa miejsca" className="field w-full min-w-0 px-2 py-1 text-sm" />
          {tripId !== undefined && <PlacePin tripId={tripId} places={doc.places} name={name} />}
        </span>
        <datalist id={listId}>
          {doc.places.map((each) => (
            <option key={each.ref} value={each.name} />
          ))}
        </datalist>
      </label>
      {place !== undefined && uses > 1 && <p className="text-xs text-zinc-500">To miejsce występuje w planie {uses} razy (punkty, nocleg dnia, rezerwacje).</p>}
      <div className="flex flex-wrap gap-2">
        {place !== undefined && (
          <>
            <button type="button" disabled={disabled || !changed} onClick={() => onEdit(renamePlace(doc, place.ref, typed))} title="Ta sama lokalizacja, nowa nazwa wszędzie" className="btn-secondary btn-sm">
              Popraw nazwę
            </button>
            <button
              type="button"
              disabled={disabled || !changed}
              onClick={() => {
                if (window.confirm(`Zastąpić „${place.name}” przez „${typed}” wszędzie w planie? Adres i pinezka starego miejsca znikną, nową pinezkę postawisz na mapie.`)) onEdit(replacePlace(doc, place.ref, typed));
              }}
              title="Pod tą pozycją planu jest teraz inne miejsce: stare współrzędne i adres znikają"
              className="btn-secondary btn-sm">
              To inne miejsce
            </button>
          </>
        )}
        <button type="button" disabled={disabled || !changed} onClick={() => onEdit(setItemPlace(doc, item.ref, uuidv7(), typed))} title="Miejsce z listy albo nowe, tylko dla tego punktu" className="btn-secondary btn-sm">
          {place === undefined ? "Przypnij miejsce" : "Tylko ten punkt"}
        </button>
      </div>
    </div>
  );
}
