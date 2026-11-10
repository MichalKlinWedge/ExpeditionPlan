import { itemsForDay, scheduleDay, type ScheduleOptions } from './engine/schedule.ts';
import { instantToZoned } from './engine/time.ts';
import { dayLabel } from './format.ts';
import type { GuideContent } from './guide.ts';
import { itemIcon } from './item-icon.ts';
import { dayLodging } from './plan-info.ts';
import { isRouteStop } from './route-stops.ts';
import type { TripDocument } from './schemas/trip-document.ts';
import { dayStats, isShowWalk, walkFacts } from './trip-show.ts';

/**
 * Pamiątka jako oś czasu (`/trips/[id]/memories`): dzień po dniu, z góry na dół — mapa dnia, liczby, najważniejsze
 * punkty z krótkim opisem i zdjęciem z opisu miejsca, reszta planu w jednej linijce, a pomiędzy nimi wpisy z dziennika
 * w kolejności godzin. Wpis przypięty do punktu stoi pod tym punktem; wpis bez dnia zamyka oś.
 * Godziny punktów to godziny planu z silnika (te same warianty co reszta pamiątki); pominięte w terenie zostają skreślone.
 */

type Doc = TripDocument;
type Item = Doc['items'][number];

export type TimelineJournal = { id: string; dayRef?: string; itemRef?: string; body: string; takenAt: number; photoUrl?: string; author?: string };

export type TimelineImage = { url: string; caption: string; credit?: string; license?: string; sourceUrl: string };

export type TimelinePoint = {
  kind: 'point';
  ref: string;
  title: string;
  icon: string;
  time?: string;
  status: 'done' | 'skipped' | 'planned';
  /** Najważniejszy punkt dnia: duża karta z opisem i zdjęciem; reszta to jedna linijka. */
  key: boolean;
  /** Skrót opisu miejsca (pełne zdania do `SUMMARY_CHARS`). */
  summary?: string;
  /** Artykuł, z którego jest opis (atrybucja skrótu). */
  source?: { url: string; site: GuideContent['article']['site'] };
  /** „12,4 km · ↑ 650 m · 4 h” przy trasie pieszej. */
  facts?: string;
  image?: TimelineImage;
  /** Wpisy z dziennika przypięte do tego punktu. */
  journal: TimelineJournal[];
};

export type TimelineEntry = TimelinePoint | ({ kind: 'journal'; time: string } & TimelineJournal);

export type TimelineDay = {
  ref: string;
  no: number;
  date: string;
  label: string;
  title?: string;
  summary?: string;
  stats: string[];
  /** Punkty dnia do `dayMap` (bez pominiętych). */
  routeRefs: string[];
  entries: TimelineEntry[];
  lodging?: string;
};

export type MemoryTimeline = { days: TimelineDay[]; loose: TimelineJournal[] };

export type TimelineInput = Pick<ScheduleOptions, 'activeVariants' | 'pulled'> & {
  done: readonly { itemRef: string }[];
  skipRefs: readonly string[];
  guideOf: (item: Item) => GuideContent | null;
  journal: readonly TimelineJournal[];
};

const SUMMARY_CHARS = 220;
const DAY_SUMMARY_CHARS = 280;

/** Pełne zdania do limitu; pierwsze zdanie dłuższe niż limit ucięte na słowie. */
export function shortText(text: string, limit: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= limit) return clean;
  let out = '';
  for (const sentence of clean.split(/(?<=[.!?…])\s+/)) {
    if ((out ? out.length + 1 : 0) + sentence.length > limit) break;
    out = out ? `${out} ${sentence}` : sentence;
  }
  return out !== '' ? out : `${clean.slice(0, limit).replace(/\s+\S*$/, '')}…`;
}

const isSight = (item: Item) => item.kind === 'visit' || item.kind === 'activity' || (item.kind === 'transport' && item.leg?.mode === 'hike');

export function memoryTimeline(doc: Doc, input: TimelineInput): MemoryTimeline {
  const schedule = { ...(input.activeVariants ? { activeVariants: input.activeVariants } : {}), ...(input.pulled ? { pulled: input.pulled } : {}) };
  const done = new Set(input.done.map((each) => each.itemRef));
  const skipped = new Set(input.skipRefs);
  const dates = [...doc.days].sort((a, b) => a.date.localeCompare(b.date));
  const dayRefs = new Set(dates.map((day) => day.ref));
  const seenImages = new Set<string>();
  const placed = new Set<string>();

  const days = dates.map((day, index): TimelineDay => {
    const items = itemsForDay(doc, day.ref, schedule).filter((item) => item.parentRef === undefined || isRouteStop(doc, item));
    const times = new Map(scheduleDay(doc, day.ref, schedule).items.map((each) => [each.ref, each.startLocal]));
    const ofDay = input.journal.filter((entry) => entry.dayRef === day.ref);

    const points: TimelinePoint[] = items
      .filter((item) => item.kind !== 'lodging')
      .map((item) => {
        const guide = item.kind === 'transport' && !isShowWalk(item) ? null : input.guideOf(item);
        const image = guide?.images.find((each) => !seenImages.has(each.url));
        const journal = ofDay.filter((entry) => entry.itemRef === item.ref);
        const key = isSight(item) && (item.priority === 'must' || guide !== null || journal.some((entry) => entry.photoUrl !== undefined));
        if (key && image !== undefined) seenImages.add(image.url);
        for (const entry of journal) placed.add(entry.id);
        const facts = isShowWalk(item) ? walkFacts(item) : '';
        const time = times.get(item.ref);
        return {
          kind: 'point',
          ref: item.ref,
          title: item.title,
          icon: itemIcon(doc, item),
          ...(time !== undefined ? { time } : {}),
          status: skipped.has(item.ref) ? 'skipped' : done.has(item.ref) ? 'done' : 'planned',
          key,
          ...(key && guide ? { summary: shortText(guide.summary, SUMMARY_CHARS), source: { url: guide.article.url, site: guide.article.site } } : {}),
          ...(facts !== '' ? { facts } : {}),
          ...(key && image !== undefined
            ? { image: { url: image.thumbUrl, caption: item.title, sourceUrl: image.sourceUrl, ...(image.author ? { credit: image.author } : {}), ...(image.license ? { license: image.license } : {}) } }
            : {}),
          journal,
        };
      });

    // Wpisy bez punktu (albo z punktem spoza dnia) wchodzą między punkty po godzinie: za ostatnim, który zaczął się nie później.
    const entries: TimelineEntry[] = [...points];
    for (const entry of ofDay.filter((each) => !placed.has(each.id))) {
      placed.add(entry.id);
      const time = instantToZoned(entry.takenAt, day.tz).time;
      let at = entries.length;
      while (at > 0) {
        const before = entries[at - 1]!;
        if (before.time === undefined || before.time <= time) break;
        at -= 1;
      }
      entries.splice(at, 0, { kind: 'journal', time, ...entry });
    }

    const lodging = dayLodging(doc, day.ref);
    const counted = items.filter((item) => !skipped.has(item.ref));
    return {
      ref: day.ref,
      no: index + 1,
      date: day.date,
      label: dayLabel(day.date),
      ...(day.title ? { title: day.title } : {}),
      ...(day.summary ? { summary: shortText(day.summary, DAY_SUMMARY_CHARS) } : {}),
      stats: dayStats(doc, counted),
      routeRefs: counted.map((item) => item.ref),
      entries,
      ...(lodging !== null ? { lodging: lodging.name } : {}),
    };
  });

  return { days, loose: input.journal.filter((entry) => !placed.has(entry.id) && (entry.dayRef === undefined || !dayRefs.has(entry.dayRef))) };
}
