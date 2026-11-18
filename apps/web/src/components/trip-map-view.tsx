"use client";

import { GUIDE_SITE, type TripMap, type TripMapPhoto, type TripMapPlace, type TripMapStop } from "@expeditionplan/core";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { DialogTitle } from "@/components/dialog-title";
import { highlightRoute, PlanMap } from "@/components/plan-map";
import { WalkProfile } from "@/components/walk-profile";

/**
 * Mapa wyjazdu (`/trips/[id]/map`): cała trasa na jednej mapie (`core/trip-map.ts`), a po kliknięciu okno nad mapą
 * (na wąskim ekranie pod nią): miejsce — opis z przewodnika ze zdjęciami, punkty planu w tym miejscu z dniem i godziną,
 * zdjęcia z dziennika; trasa — liczby, profil wysokości i podświetlona linia na mapie. Z okna przejście do planu dnia
 * i do karty punktu. Dojazd i powrót są widoczne od razu i wyłącza je przycisk na mapie; zdjęcia — przełącznik nad mapą.
 */

type Open = { kind: "place"; placeRef: string; photosFirst?: boolean } | { kind: "stop"; ref: string };

export function TripMapView({ tripId, data }: { tripId: string; data: TripMap }) {
  const [open, setOpen] = useState<Open | null>(null);
  const [showPhotos, setShowPhotos] = useState(true);
  const photoPins = useMemo(() => (showPhotos ? data.photoPins : []), [showPhotos, data.photoPins]);

  // Wybrana trasa świeci na mapie, dopóki jej okno jest otwarte.
  const lineRef = open?.kind === "stop" && data.stops[open.ref]?.route ? open.ref : null;
  useEffect(() => {
    highlightRoute(lineRef);
    return () => highlightRoute(null);
  }, [lineRef]);

  useEffect(() => {
    if (open === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const openPin = open?.kind === "place" ? data.map.pins.find((pin) => pin.placeRef === open.placeRef) : undefined;
  const selected = open === null ? null : open.kind === "stop" ? open.ref : (openPin?.stops[0]?.ref ?? openPin?.clickRef ?? null);
  const onSelect = (ref: string) => {
    const pin = data.map.pins.find((each) => each.clickRef === ref || each.stops.some((stop) => stop.ref === ref));
    if (pin !== undefined) setOpen({ kind: "place", placeRef: pin.placeRef });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
        <span>Kliknij punkt, trasę{data.photoPins.length > 0 ? " albo zdjęcie" : ""}, żeby zobaczyć opis i plan. Numery na pinezkach to kolejne punkty całego wyjazdu.</span>
        {data.photoPins.length > 0 && (
          <button type="button" onClick={() => setShowPhotos((value) => !value)} aria-pressed={showPhotos} className="toggle-chip">
            📷 Zdjęcia z dziennika ({data.photos.length})
          </button>
        )}
      </div>
      <div className="relative">
        <PlanMap
          map={data.map}
          fitKey="wyjazd"
          selected={selected}
          onSelect={onSelect}
          transitShown
          onSelectLine={(ref) => setOpen({ kind: "stop", ref })}
          photoPins={photoPins}
          onSelectPhotos={(placeRef) => setOpen({ kind: "place", placeRef, photosFirst: true })}
          emptyText="Żaden punkt planu nie ma miejsca ze współrzędnymi."
          fitLines
        />
        {open !== null && (
          <aside
            aria-label="Szczegóły z mapy"
            className="card mt-3 flex flex-col gap-3 p-4 text-sm lg:absolute lg:top-12 lg:left-3 lg:z-10 lg:mt-0 lg:max-h-[calc(100%-4.5rem)] lg:w-[26rem] lg:overflow-y-auto lg:shadow-xl">
            {open.kind === "place" ? (
              <PlacePanel tripId={tripId} data={data} place={data.places[open.placeRef]} photosFirst={open.photosFirst === true} onOpen={setOpen} onClose={() => setOpen(null)} />
            ) : (
              <StopPanel tripId={tripId} data={data} stop={data.stops[open.ref]} onOpen={setOpen} onClose={() => setOpen(null)} />
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

type PanelProps = { tripId: string; data: TripMap; onOpen: (open: Open) => void; onClose: () => void };

function PlacePanel({ tripId, data, place, photosFirst, onOpen, onClose }: PanelProps & { place: TripMapPlace | undefined; photosFirst: boolean }) {
  if (place === undefined) return <DialogTitle onClose={onClose}>Nie ma już tego miejsca</DialogTitle>;
  const stops = place.stopRefs.flatMap((ref) => (data.stops[ref] ? [data.stops[ref]] : []));
  const days = [...new Set(stops.map((stop) => stop.dayNo))];
  const photos = place.photoIds.flatMap((id) => data.photos.filter((photo) => photo.id === id));
  const gallery = photos.length > 0 && <Photos photos={photos} />;
  return (
    <>
      <DialogTitle onClose={onClose}>
        <h2 className="text-base font-semibold">{place.name}</h2>
        {days.length > 0 && <p className="text-xs text-zinc-500">{days.length === 1 ? `dzień ${days[0]}` : `dni ${days.join(", ")}`}</p>}
      </DialogTitle>
      {photosFirst && gallery}
      {place.guide && <Guide guide={place.guide} />}
      {!photosFirst && gallery}
      {stops.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="font-semibold">W planie</h3>
          <ul className="flex flex-col gap-2">
            {stops.map((stop) => (
              <li key={stop.ref} className="panel flex flex-col gap-1">
                <StopLine stop={stop} />
                <StopLinks tripId={tripId} stop={stop}>
                  {stop.route && (
                    <button type="button" className="btn-mini" onClick={() => onOpen({ kind: "stop", ref: stop.ref })}>
                      pokaż trasę
                    </button>
                  )}
                </StopLinks>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function StopPanel({ tripId, data, stop, onOpen, onClose }: PanelProps & { stop: TripMapStop | undefined }) {
  if (stop === undefined) return <DialogTitle onClose={onClose}>Nie ma już tego punktu</DialogTitle>;
  const ends = [stop.fromPlaceRef, stop.placeRef].filter((ref, at, all): ref is string => ref !== undefined && all.indexOf(ref) === at && data.places[ref] !== undefined);
  const target = stop.placeRef === undefined ? undefined : data.places[stop.placeRef];
  const photos = data.photos.filter((photo) => photo.itemRef === stop.ref);
  return (
    <>
      <DialogTitle onClose={onClose}>
        <h2 className="text-base font-semibold">
          {stop.no !== undefined && <span className="text-sea">{stop.no}. </span>}
          {stop.icon} {stop.title}
        </h2>
        <p className="text-xs text-zinc-500">
          dzień {stop.dayNo} · {stop.dayLabel}
          {stop.time ? ` · ${stop.time}` : ""}
        </p>
      </DialogTitle>
      <p>
        <span className="text-zinc-500">{stop.kind}</span>
        {stop.facts && <span> · {stop.facts}</span>}
      </p>
      {stop.profile && <WalkProfile profile={stop.profile.points} minEle={stop.profile.minEle} maxEle={stop.profile.maxEle} />}
      {stop.route && <p className="text-xs text-zinc-500">Trasa podświetlona na mapie.</p>}
      {photos.length > 0 && <Photos photos={photos} />}
      {target?.guide && stop.kind !== "nocleg" && !stop.route && <Guide guide={target.guide} />}
      {ends.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-zinc-500">{ends.length > 1 ? "Miejsca:" : "Miejsce:"}</span>
          {ends.map((ref) => (
            <button key={ref} type="button" className="btn-mini" onClick={() => onOpen({ kind: "place", placeRef: ref })}>
              {data.places[ref]!.name}
            </button>
          ))}
        </div>
      )}
      <StopLinks tripId={tripId} stop={stop} />
    </>
  );
}

function StopLine({ stop }: { stop: TripMapStop }) {
  return (
    <>
      <p className="font-medium">
        {stop.no !== undefined && <span className="text-sea">{stop.no}. </span>}
        {stop.icon} {stop.title}
      </p>
      <p className="text-xs text-zinc-500">
        dzień {stop.dayNo} · {stop.dayLabel}
        {stop.time ? ` · ${stop.time}` : ""}
        {stop.facts ? ` · ${stop.kind} · ${stop.facts}` : ""}
      </p>
    </>
  );
}

function StopLinks({ tripId, stop, children }: { tripId: string; stop: TripMapStop; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap gap-1">
      <Link href={`/trips/${tripId}/plan?day=${encodeURIComponent(stop.dayRef)}`} className="btn-mini">
        plan dnia {stop.dayNo}
      </Link>
      {!stop.night && (
        <Link href={`/trips/${tripId}/item/${encodeURIComponent(stop.ref)}`} className="btn-mini">
          karta punktu
        </Link>
      )}
      {children}
    </div>
  );
}

function Guide({ guide }: { guide: NonNullable<TripMapPlace["guide"]> }) {
  const [first, ...rest] = guide.images;
  return (
    <section className="flex flex-col gap-2">
      {first && (
        <figure className="flex flex-col">
          {/* Miniatura z Commons; atrybucja pod zdjęciem. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={first.url} alt={first.caption} className="max-h-56 w-full rounded-lg object-cover" />
          <Credit image={first} />
        </figure>
      )}
      {rest.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {rest.map((image) => (
            <figure key={image.url} className="flex flex-col">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image.url} alt={image.caption} loading="lazy" className="h-20 w-full rounded object-cover" />
              <Credit image={image} />
            </figure>
          ))}
        </div>
      )}
      <p>{guide.summary}</p>
      <p className="text-xs text-zinc-500">
        Skrót opisu z{" "}
        <a href={guide.url} target="_blank" rel="noreferrer" className="underline">
          {GUIDE_SITE[guide.site]}
        </a>
        {guide.site === "web" ? "" : ", CC BY-SA 4.0"}
      </p>
    </section>
  );
}

function Credit({ image }: { image: NonNullable<TripMapPlace["guide"]>["images"][number] }) {
  return (
    <figcaption className="text-[10px] text-zinc-500">
      <a href={image.sourceUrl} target="_blank" rel="noreferrer" className="underline">
        fot. {image.credit ?? "Wikimedia Commons"}
      </a>
      {image.license ? `, ${image.license}` : ""}
    </figcaption>
  );
}

/** Zdjęcia z dziennika: miniatury otwierają pełne zdjęcie w nowej karcie (podpisany adres z bucketu, ważny godzinę). */
function Photos({ photos }: { photos: TripMapPhoto[] }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-semibold">Zdjęcia z dziennika</h3>
      <div className="grid grid-cols-2 gap-2">
        {photos.map((photo) => (
          <figure key={photo.id} className="flex flex-col gap-0.5">
            <a href={photo.photoUrl} target="_blank" rel="noreferrer" title="Otwórz zdjęcie">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.photoUrl} alt={photo.body || "Zdjęcie z wyjazdu"} loading="lazy" className="h-32 w-full rounded object-cover" />
            </a>
            <figcaption className="text-xs text-zinc-500">
              {[photo.dayLabel, photo.time, photo.author].filter(Boolean).join(" · ")}
              {photo.itemTitle ? <span className="block">{photo.itemTitle}</span> : null}
              {photo.body ? <span className="block text-zinc-700 dark:text-zinc-300">{photo.body}</span> : null}
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
