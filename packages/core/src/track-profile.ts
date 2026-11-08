import { type ScheduleOptions, scheduleDay } from './engine/schedule.ts';
import { sunTimes } from './engine/sun.ts';
import { instantToZoned, MINUTE } from './engine/time.ts';
import { trackClimb, type TrackLine, type TrackPoint } from './gpx.ts';
import { distanceM, type LngLat } from './polyline.ts';
import type { TripDocument } from './schemas/trip-document.ts';

type PlanItem = TripDocument['items'][number];

/**
 * Profil wysokości i trudność trasy ze śladu GPX zapisanego w planie (`tracks.geojson`): wykres,
 * odcinki między szczytami i dolinami z czasem wg DIN 33466 i „punkt bez powrotu” względem zachodu
 * słońca. Wszystko lokalnie, bez API — działa tak samo na webie i offline na telefonie.
 */

export type ProfilePoint = { km: number; ele: number | null };
export type TrackProfile = { points: ProfilePoint[]; totalKm: number; minEle: number | null; maxEle: number | null; hasElevation: boolean };

const flat = (point: TrackPoint): LngLat => [point[0], point[1]];

/** Odległość od startu (km) w każdym punkcie śladu. */
export function trackKms(line: TrackLine): number[] {
  const kms = [0];
  let meters = 0;
  for (let i = 1; i < line.coordinates.length; i++) {
    meters += distanceM(flat(line.coordinates[i - 1]!), flat(line.coordinates[i]!));
    kms.push(meters / 1000);
  }
  return kms;
}

/** Punkty do wykresu: km od startu i wysokość. `hasElevation` — gdy wysokość ma większość punktów. */
export function trackProfile(line: TrackLine): TrackProfile {
  const kms = trackKms(line);
  const points = line.coordinates.map((point, i): ProfilePoint => ({ km: kms[i]!, ele: point[2] ?? null }));
  const heights = points.map((point) => point.ele).filter((ele): ele is number => ele !== null);
  const hasElevation = heights.length >= 2 && heights.length >= points.length * 0.8;
  return {
    points,
    totalKm: kms.at(-1) ?? 0,
    minEle: hasElevation ? Math.min(...heights) : null,
    maxEle: hasElevation ? Math.max(...heights) : null,
    hasElevation,
  };
}

/** Czas przejścia (min, bez zaokrąglenia) wg DIN 33466: 4 km/h, 300 m/h w górę, 500 m/h w dół. */
export function dinMinutes(distanceKm: number, ascentM: number, descentM: number): number {
  const horizontal = distanceKm / 4;
  const vertical = ascentM / 300 + descentM / 500;
  return (Math.max(horizontal, vertical) + Math.min(horizontal, vertical) / 2) * 60;
}

export type TrackSection = {
  fromKm: number;
  toKm: number;
  distanceKm: number;
  ascentM: number;
  descentM: number;
  /** Wysokość na początku i na końcu odcinka; `null` — ślad bez wysokości. */
  fromEle: number | null;
  toEle: number | null;
  trend: 'up' | 'down' | 'flat';
  /** Czas odcinka (min) wg DIN, z tempem; i w drugą stronę (powrót), gdzie podejścia stają się zejściami. */
  minutes: number;
  backMinutes: number;
  /** Od startu do początku i końca odcinka (min). */
  startMin: number;
  endMin: number;
};

export type SectionOptions = {
  /** Od ilu metrów różnicy wysokości szczyt albo dolina dzieli trasę (domyślnie 80). */
  turnM?: number;
  /** Krótsze odcinki (km) łączą się z sąsiednim. */
  minKm?: number;
  /** Ślad bez wysokości: odcinki co tyle km. */
  flatKm?: number;
  /** Mnożnik czasu DIN (1 = norma; 1,2 = wolniej). */
  pace?: number;
};

/** Indeksy szczytów i dolin: kierunek zmienia się dopiero po odejściu od szczytu (dołka) o `turnM`. */
function turningPoints(heights: readonly number[], turnM: number): number[] {
  const turns: number[] = [];
  let peak = 0;
  let direction = 0;
  for (let i = 1; i < heights.length; i++) {
    const height = heights[i]!;
    if (direction === 0) {
      if (Math.abs(height - heights[0]!) > Math.abs(heights[peak]! - heights[0]!)) peak = i;
      if (Math.abs(heights[peak]! - heights[0]!) >= turnM) direction = heights[peak]! > heights[0]! ? 1 : -1;
    } else if ((height - heights[peak]!) * direction >= 0) {
      peak = i;
    } else if (Math.abs(height - heights[peak]!) >= turnM) {
      turns.push(peak);
      peak = i;
      direction = -direction;
    }
  }
  return turns;
}

/**
 * Odcinki trasy: od szczytu do doliny i z powrotem (podejście, zejście, płasko), każdy z czasem
 * wg DIN. Ślad bez wysokości dzieli się co `flatKm`. Suma odcinków jest trochę dłuższa niż czas całej
 * trasy z jednego wzoru — DIN zaleca liczyć właśnie po odcinkach.
 */
export function trackSections(line: TrackLine, options: SectionOptions = {}): TrackSection[] {
  const { turnM = 80, minKm = 0.8, flatKm = 5, pace = 1 } = options;
  const points = line.coordinates;
  const kms = trackKms(line);
  const total = kms.at(-1) ?? 0;
  const profile = trackProfile(line);
  let cuts: number[];
  if (profile.hasElevation) {
    // Brakujące wysokości uzupełnia poprzednia znana, żeby indeksy zgadzały się ze śladem.
    let last = points.find((point) => point[2] !== undefined)?.[2] ?? 0;
    const heights = points.map((point) => (last = point[2] ?? last));
    cuts = turningPoints(heights, turnM);
  } else {
    cuts = [];
    let next = flatKm;
    for (let i = 1; i < points.length - 1; i++) {
      if (kms[i]! >= next && total - kms[i]! >= flatKm / 2) {
        cuts.push(i);
        next = kms[i]! + flatKm;
      }
    }
  }
  // Krótkie odcinki łączą się z poprzednim (pierwszy z następnym).
  let bounds = [0, ...cuts, points.length - 1];
  for (let changed = true; changed && bounds.length > 2; ) {
    changed = false;
    for (let s = 0; s < bounds.length - 1; s++) {
      if (kms[bounds[s + 1]!]! - kms[bounds[s]!]! >= minKm) continue;
      // Usuwamy granicę między tym odcinkiem a sąsiadem (końców trasy nie ruszamy).
      const drop = s === 0 ? 1 : s;
      if (drop <= 0 || drop >= bounds.length - 1) continue;
      bounds = bounds.filter((_, i) => i !== drop);
      changed = true;
      break;
    }
  }
  let elapsed = 0;
  return bounds.slice(0, -1).map((from, s): TrackSection => {
    const to = bounds[s + 1]!;
    const slice = points.slice(from, to + 1);
    const heights = trackClimb(slice) ?? { ascentM: 0, descentM: 0 };
    const distanceKm = kms[to]! - kms[from]!;
    const fromEle = profile.hasElevation ? (points[from]![2] ?? null) : null;
    const toEle = profile.hasElevation ? (points[to]![2] ?? null) : null;
    const net = fromEle !== null && toEle !== null ? toEle - fromEle : 0;
    const minutes = dinMinutes(distanceKm, heights.ascentM, heights.descentM) * pace;
    const backMinutes = dinMinutes(distanceKm, heights.descentM, heights.ascentM) * pace;
    const section: TrackSection = {
      fromKm: kms[from]!,
      toKm: kms[to]!,
      distanceKm,
      ascentM: heights.ascentM,
      descentM: heights.descentM,
      fromEle,
      toEle,
      trend: net > 30 ? 'up' : net < -30 ? 'down' : 'flat',
      minutes,
      backMinutes,
      startMin: elapsed,
      endMin: elapsed + minutes,
    };
    elapsed += minutes;
    return section;
  });
}

/** Tempo z planu: czas punktu ÷ suma odcinków DIN, w granicach 0,5–2. `1` — plan nie podaje czasu. */
export function planPace(sections: readonly TrackSection[], plannedMin: number | undefined): number {
  const din = sections.reduce((sum, section) => sum + section.minutes, 0);
  if (plannedMin === undefined || plannedMin <= 0 || din <= 0) return 1;
  return Math.min(2, Math.max(0.5, plannedMin / din));
}

/** Minuty od startu do punktu `km` i z niego z powrotem do startu (liniowo w odcinku). */
function timesAt(sections: readonly TrackSection[], km: number): { forward: number; back: number } {
  let back = 0;
  for (const section of sections) {
    if (km <= section.toKm || section === sections.at(-1)) {
      const part = section.distanceKm === 0 ? 1 : Math.min(1, Math.max(0, (km - section.fromKm) / section.distanceKm));
      return { forward: section.startMin + section.minutes * part, back: back + section.backMinutes * part };
    }
    back += section.backMinutes;
  }
  return { forward: 0, back: 0 };
}

export type TrackDaylight = {
  /** Godziny lokalne (strefa dnia). */
  startLocal: string;
  finishLocal: string;
  /** Data mety, gdy różna od daty startu. */
  finishDate?: string;
  sunsetLocal: string | null;
  duskLocal: string | null;
  /** Zapas od mety do zachodu (min); ujemny = meta po zachodzie. `null` — słońce tego dnia nie zachodzi. */
  marginMin: number | null;
  /**
   * Najdalszy punkt, z którego powrót do startu kończy się przed zachodem: zawróćcie najpóźniej tam
   * i o tej godzinie. `null`, gdy przejście tam i z powrotem całej trasy mieści się przed zachodem.
   */
  turnaround: { km: number; atLocal: string } | null;
  /** Start już po zachodzie, czyli zawracać nie ma kiedy. */
  startsAfterSunset: boolean;
  /** Od tego km do mety jest bliżej (w czasie) niż z powrotem do startu. */
  pointOfNoReturnKm: number | null;
};

/**
 * Słońce na trasie: kiedy meta, ile zapasu do zachodu w miejscu startu i gdzie najpóźniej zawrócić,
 * żeby wrócić do startu przed zachodem. `start` — chwila wyjścia (UTC ms, z silnika planu).
 */
export function trackDaylight(line: TrackLine, sections: readonly TrackSection[], start: number, tz: string): TrackDaylight {
  const first = line.coordinates[0]!;
  const date = instantToZoned(start, tz).date;
  const sun = sunTimes(date, first[1], first[0]);
  const total = sections.at(-1)?.toKm ?? 0;
  const walk = sections.at(-1)?.endMin ?? 0;
  const finish = start + walk * MINUTE;
  const local = (instant: number) => instantToZoned(instant, tz).time;
  const finishZoned = instantToZoned(finish, tz);
  const limit = sun.sunset === null ? null : (sun.sunset - start) / MINUTE;
  let turnaround: TrackDaylight['turnaround'] = null;
  if (limit !== null && limit > 0) {
    const round = (km: number) => {
      const times = timesAt(sections, km);
      return times.forward + times.back;
    };
    if (round(total) > limit) {
      // Tam i z powrotem rośnie z odległością: bisekcja.
      let low = 0;
      let high = total;
      for (let i = 0; i < 40; i++) {
        const mid = (low + high) / 2;
        if (round(mid) <= limit) low = mid;
        else high = mid;
      }
      turnaround = { km: Math.round(low * 10) / 10, atLocal: local(start + timesAt(sections, low).forward * MINUTE) };
    }
  }
  // Pierwszy punkt, od którego dalsza droga do mety jest krótsza niż powrót.
  let pointOfNoReturnKm: number | null = null;
  if (total > 0) {
    let low = 0;
    let high = total;
    const ahead = (km: number) => walk - timesAt(sections, km).forward - timesAt(sections, km).back;
    if (ahead(0) > 0) {
      for (let i = 0; i < 40; i++) {
        const mid = (low + high) / 2;
        if (ahead(mid) > 0) low = mid;
        else high = mid;
      }
      pointOfNoReturnKm = Math.round(high * 10) / 10;
    }
  }
  return {
    startLocal: local(start),
    finishLocal: finishZoned.time,
    ...(finishZoned.date !== date ? { finishDate: finishZoned.date } : {}),
    sunsetLocal: sun.sunset === null ? null : local(sun.sunset),
    duskLocal: sun.civilDusk === null ? null : local(sun.civilDusk),
    marginMin: sun.sunset === null ? null : Math.round((sun.sunset - finish) / MINUTE),
    turnaround,
    startsAfterSunset: limit !== null && limit <= 0,
    pointOfNoReturnKm,
  };
}

export type ItemTrackWalk = {
  line: TrackLine;
  profile: TrackProfile;
  sections: TrackSection[];
  /** Tempo z planu (`planPace`). */
  pace: number;
  /** Wyjście wg silnika planu (UTC ms) i strefa dnia; `null` — punkt poza dniem albo poza wyliczeniami. */
  start: number | null;
  tz: string | null;
  daylight: TrackDaylight | null;
};

/**
 * Wszystko o śladzie punktu naraz — dla karty punktu na webie i szczegółów na telefonie: profil,
 * odcinki z tempem z planu i słońce od godziny wyjścia z silnika (`options` jak w widoku planu).
 */
export function itemTrackWalk(doc: TripDocument, item: PlanItem, options: ScheduleOptions = {}): ItemTrackWalk | null {
  const track = doc.tracks.find((each) => each.ref === item.activity?.trackRef);
  const line = track?.geojson as TrackLine | undefined;
  if (line === undefined) return null;
  const pace = planPace(trackSections(line), item.durationMin ?? item.leg?.durationMin);
  const sections = trackSections(line, { pace });
  const day = doc.days.find((each) => each.ref === item.dayRef);
  let start: number | null = null;
  if (day !== undefined) {
    try {
      start = scheduleDay(doc, day.ref, options).items.find((each) => each.ref === item.ref)?.start ?? null;
    } catch {
      // Błąd dnia widać w planie; tu bez godzin.
    }
  }
  return {
    line,
    profile: trackProfile(line),
    sections,
    pace,
    start,
    tz: day?.tz ?? null,
    daylight: start === null || day === undefined ? null : trackDaylight(line, sections, start, day.tz),
  };
}

/** Minuty od startu do punktu `km` (liniowo w odcinku) — do podpowiedzi na wykresie. */
export function minutesToKm(sections: readonly TrackSection[], km: number): number {
  return timesAt(sections, km).forward;
}
