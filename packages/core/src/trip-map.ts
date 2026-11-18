import { itemsForDay, scheduleDay, type ScheduleOptions } from './engine/schedule.ts';
import { instantToZoned } from './engine/time.ts';
import { dayLabel, formatKm } from './format.ts';
import type { GuideContent } from './guide.ts';
import type { TrackLine } from './gpx.ts';
import { itemIcon } from './item-icon.ts';
import { ITEM_KIND, LEG_MODE } from './labels.ts';
import { shortText, type TimelineImage } from './memory-timeline.ts';
import { dayLodging, dayMap, type DayMap, formatMinutes } from './plan-info.ts';
import { isRouteStop } from './route-stops.ts';
import type { TripDocument } from './schemas/trip-document.ts';
import { profileSketch, trackProfile } from './track-profile.ts';
import { isShowWalk, walkFacts } from './trip-show.ts';

/**
 * Mapa wyjazdu (`/trips/[id]/map`): jedna mapa całego wyjazdu — wszystkie punkty dni po kolei (warianty jak w widoku
 * planu, bez pominiętych w terenie), wszystkie trasy (ślady GPX, przejazdy po drogach, proste między miejscami),
 * noclegi, dojazd i powrót (`transit`, do wyłączenia na mapie). Numery pinezek to kolejne punkty całego wyjazdu
 * (`dayMap` przez wszystkie dni, każdy numer raz); noc nie dostaje numeru, a pinezka bez numeru (sam nocleg, sam cel
 * przejazdu) otwiera okno przez `MapPin.clickRef`.
 * Do okna po kliknięciu: miejsce (opis z przewodnika, zdjęcia, punkty planu w tym miejscu z dniem i godziną) i punkt
 * z trasą (liczby, profil wysokości). Zdjęcia z dziennika stoją przy miejscu swojego punktu, a wpis z samym dniem —
 * przy punkcie, który zaczął się ostatni przed zdjęciem (bez takiego: przy noclegu dnia).
 */

type Doc = TripDocument;
type Item = Doc['items'][number];

export type TripMapJournal = { id: string; dayRef?: string; itemRef?: string; body: string; takenAt: number; photoUrl: string; author?: string };

export type TripMapPhoto = TripMapJournal & { placeRef: string; time?: string; dayLabel?: string; itemTitle?: string };

export type TripMapStop = {
  ref: string;
  title: string;
  icon: string;
  dayRef: string;
  dayNo: number;
  dayLabel: string;
  /** Numer na mapie (kolejny w całym wyjeździe); brak = punkt bez miejsca na mapie albo noc. */
  no?: number;
  /** „10:00–12:30” z silnika. */
  time?: string;
  kind: string;
  /** Miejsce punktu (cel przejazdu); `fromPlaceRef` — skąd rusza przejazd. */
  placeRef?: string;
  fromPlaceRef?: string;
  /** „12,4 km · ↑ 650 m · 4 h” albo „120 km · 1 h 40 min” (rodzaj przejazdu jest w `kind`). */
  facts?: string;
  /** Punkt ma swoją linię na mapie (ślad, trasa po drogach albo prosta przejazdu) — można ją kliknąć. */
  route: boolean;
  profile?: { points: { km: number; ele: number }[]; minEle: number; maxEle: number };
  /** Pseudo-punkt nocy (`nocleg:<dzień>`) — bez karty punktu. */
  night?: true;
};

export type TripMapPlace = {
  placeRef: string;
  name: string;
  guide?: { title: string; summary: string; url: string; site: GuideContent['article']['site']; images: TimelineImage[] };
  /** Punkty planu w tym miejscu po kolei (także noce). */
  stopRefs: string[];
  photoIds: string[];
};

export type TripMapPhotoPin = { placeRef: string; lat: number; lng: number; thumbUrl: string; count: number };

export type TripMap = {
  map: DayMap;
  stops: Record<string, TripMapStop>;
  places: Record<string, TripMapPlace>;
  photos: TripMapPhoto[];
  photoPins: TripMapPhotoPin[];
  days: { ref: string; no: number; label: string; title?: string }[];
};

export type TripMapInput = Pick<ScheduleOptions, 'activeVariants' | 'pulled'> & {
  skipRefs: readonly string[];
  /** Opis miejsca z przewodnika: miejsce i punkt, który z niego korzysta (własny opis punktu ma pierwszeństwo). */
  guideOf: (placeRef: string, item: Item | undefined) => (GuideContent & { title: string }) | null;
  journal: readonly TripMapJournal[];
};

const SUMMARY_CHARS = 600;
const IMAGES = 4;
const PROFILE_POINTS = 120;
export const NIGHT_STOP = 'nocleg:';

function legFacts(item: Item): string {
  if (isShowWalk(item)) return walkFacts(item);
  const leg = item.kind === 'transport' ? item.leg : undefined;
  if (leg === undefined) return '';
  const minutes = item.durationMin ?? leg.durationMin;
  return [leg.distanceKm !== undefined ? formatKm(leg.distanceKm) : '', minutes ? formatMinutes(minutes) : ''].filter((part) => part !== '').join(' · ');
}

export function tripMap(doc: Doc, input: TripMapInput): TripMap {
  const schedule = { ...(input.activeVariants ? { activeVariants: input.activeVariants } : {}), ...(input.pulled ? { pulled: input.pulled } : {}) };
  const skipped = new Set(input.skipRefs);
  const placesByRef = new Map(doc.places.map((place) => [place.ref, place]));
  const tracks = new Map(doc.tracks.map((track) => [track.ref, track]));
  const dates = [...doc.days].sort((a, b) => a.date.localeCompare(b.date));
  const stops: Record<string, TripMapStop> = {};
  const routeRefs: string[] = [];
  /** Godzina startu punktów dnia — do przypięcia zdjęć z samym dniem. */
  const starts = new Map<string, { ref: string; start: string; placeRef?: string }[]>();
  const nights: { ref: string; dayNo: number; placeRef: string }[] = [];

  dates.forEach((day, index) => {
    const no = index + 1;
    const items = itemsForDay(doc, day.ref, schedule).filter((item) => (item.parentRef === undefined || isRouteStop(doc, item)) && !skipped.has(item.ref));
    const times = new Map(scheduleDay(doc, day.ref, schedule).items.map((each) => [each.ref, each]));
    const ofDay: { ref: string; start: string; placeRef?: string }[] = [];
    for (const item of items) {
      routeRefs.push(item.ref);
      const time = times.get(item.ref);
      const placeRef = item.leg?.toPlaceRef ?? item.placeRef;
      const facts = legFacts(item);
      const trackRef = item.activity?.trackRef;
      const line = trackRef === undefined ? undefined : (tracks.get(trackRef)?.geojson as TrackLine | undefined);
      const profile = line === undefined ? null : profileSketch(trackProfile(line), PROFILE_POINTS);
      const heights = profile?.map((point) => point.ele) ?? [];
      stops[item.ref] = {
        ref: item.ref,
        title: item.title,
        icon: itemIcon(doc, item),
        dayRef: day.ref,
        dayNo: no,
        dayLabel: dayLabel(day.date),
        ...(time !== undefined ? { time: time.startLocal === time.endLocal ? time.startLocal : `${time.startLocal}–${time.endLocal}` } : {}),
        kind: item.kind === 'transport' && item.leg !== undefined ? (LEG_MODE[item.leg.mode] ?? ITEM_KIND.transport ?? '') : (ITEM_KIND[item.kind] ?? item.kind),
        ...(placeRef !== undefined ? { placeRef } : {}),
        ...(item.leg?.fromPlaceRef !== undefined ? { fromPlaceRef: item.leg.fromPlaceRef } : {}),
        ...(facts !== '' ? { facts } : {}),
        route: false,
        ...(profile !== null && profile.length > 1 ? { profile: { points: profile, minEle: Math.min(...heights), maxEle: Math.max(...heights) } } : {}),
      };
      if (time !== undefined) ofDay.push({ ref: item.ref, start: time.startLocal, ...(placeRef !== undefined ? { placeRef } : {}) });
    }
    starts.set(day.ref, ofDay);
    const lodging = dayLodging(doc, day.ref);
    if (lodging?.placeRef !== undefined) {
      const ref = `${NIGHT_STOP}${day.ref}`;
      nights.push({ ref, dayNo: no, placeRef: lodging.placeRef });
      stops[ref] = { ref, title: `Nocleg: ${lodging.name}`, icon: '🛏', dayRef: day.ref, dayNo: no, dayLabel: dayLabel(day.date), kind: 'nocleg', placeRef: lodging.placeRef, route: false, night: true };
    }
  });

  const map = dayMap(doc, routeRefs);
  const pinOf = new Map(map.pins.map((pin) => [pin.placeRef, pin]));
  // Noce: pinezka noclegu (także miejsca, którego żaden punkt nie używa).
  for (const night of nights) {
    let pin = pinOf.get(night.placeRef);
    if (pin === undefined) {
      const place = placesByRef.get(night.placeRef);
      if (place?.lat === undefined || place.lng === undefined) continue;
      pin = { placeRef: place.ref, name: place.name, lat: place.lat, lng: place.lng, stops: [] };
      pinOf.set(place.ref, pin);
      map.pins.push(pin);
    }
    pin.base = true;
    delete pin.transit;
    pin.clickRef ??= night.ref;
  }
  for (const [ref, n] of Object.entries(map.numbers)) if (stops[ref] !== undefined) stops[ref].no = n;
  // Sam cel przejazdu (numer stoi przy starcie) też jest do kliknięcia: otwiera okno miejsca.
  for (const stop of Object.values(stops)) {
    const pin = stop.night || stop.placeRef === undefined ? undefined : pinOf.get(stop.placeRef);
    if (pin !== undefined && pin.stops.length === 0) pin.clickRef ??= stop.ref;
  }
  for (const line of map.lines) for (const ref of line.refs ?? []) if (stops[ref] !== undefined) stops[ref].route = true;
  for (const ref of Object.keys(map.straightLegs ?? {})) if (stops[ref] !== undefined) stops[ref].route = true;

  // Zdjęcia z dziennika przy miejscach.
  const photos: TripMapPhoto[] = [];
  const dayByRef = new Map(dates.map((day) => [day.ref, day]));
  for (const entry of input.journal) {
    const own = entry.itemRef === undefined ? undefined : stops[entry.itemRef];
    const day = entry.dayRef === undefined ? undefined : dayByRef.get(entry.dayRef);
    const time = day === undefined ? undefined : instantToZoned(entry.takenAt, day.tz).time;
    let placeRef = own?.placeRef ?? own?.fromPlaceRef;
    let itemRef = own === undefined ? undefined : entry.itemRef;
    if (placeRef === undefined && day !== undefined) {
      const before = (starts.get(day.ref) ?? []).filter((each) => each.placeRef !== undefined && pinOf.has(each.placeRef) && (time === undefined || each.start <= time)).at(-1);
      placeRef = before?.placeRef ?? nights.find((night) => night.ref === `${NIGHT_STOP}${day.ref}`)?.placeRef;
      itemRef = before?.ref ?? itemRef;
    }
    if (placeRef === undefined || !pinOf.has(placeRef)) continue;
    const item = itemRef === undefined ? undefined : stops[itemRef];
    photos.push({
      ...entry,
      ...(itemRef !== undefined ? { itemRef } : {}),
      placeRef,
      ...(time !== undefined ? { time } : {}),
      ...(day !== undefined ? { dayLabel: dayLabel(day.date) } : {}),
      ...(item !== undefined && !item.night ? { itemTitle: item.title } : {}),
    });
  }

  const places: Record<string, TripMapPlace> = {};
  for (const pin of map.pins) {
    const firstItem = pin.stops.map((stop) => doc.items.find((item) => item.ref === stop.ref)).find((item) => item !== undefined && item.kind !== 'transport' && item.kind !== 'lodging');
    const guide = input.guideOf(pin.placeRef, firstItem);
    const stopRefs = [...pin.stops.map((stop) => stop.ref), ...Object.values(stops).filter((stop) => (stop.fromPlaceRef === pin.placeRef || stop.placeRef === pin.placeRef) && !pin.stops.some((each) => each.ref === stop.ref)).map((stop) => stop.ref)];
    const order = new Map(Object.keys(stops).map((ref, at) => [ref, at]));
    stopRefs.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    places[pin.placeRef] = {
      placeRef: pin.placeRef,
      name: pin.name,
      ...(guide !== null
        ? {
            guide: {
              title: guide.article.title,
              summary: shortText(guide.summary, SUMMARY_CHARS),
              url: guide.article.url,
              site: guide.article.site,
              images: guide.images.slice(0, IMAGES).map((image) => ({
                url: image.thumbUrl,
                caption: image.title ?? pin.name,
                sourceUrl: image.sourceUrl,
                ...(image.author ? { credit: image.author } : {}),
                ...(image.license ? { license: image.license } : {}),
              })),
            },
          }
        : {}),
      stopRefs,
      photoIds: photos.filter((photo) => photo.placeRef === pin.placeRef).map((photo) => photo.id),
    };
  }

  const photoPins: TripMapPhotoPin[] = [];
  for (const place of Object.values(places)) {
    const first = photos.find((photo) => photo.id === place.photoIds[0]);
    const pin = pinOf.get(place.placeRef);
    if (first === undefined || pin === undefined) continue;
    photoPins.push({ placeRef: place.placeRef, lat: pin.lat, lng: pin.lng, thumbUrl: first.photoUrl, count: place.photoIds.length });
  }

  return {
    map,
    stops,
    places,
    photos,
    photoPins,
    days: dates.map((day, index) => ({ ref: day.ref, no: index + 1, label: dayLabel(day.date), ...(day.title ? { title: day.title } : {}) })),
  };
}
