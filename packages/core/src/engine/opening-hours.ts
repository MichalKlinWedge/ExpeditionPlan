/**
 * Godziny otwarcia w składni OSM `opening_hours` (https://wiki.openstreetmap.org/wiki/Key:opening_hours)
 * → przedziały otwarcia w danym dniu. Pokrywa to, co realnie zwracają OSM i Geoapify:
 *
 * - dni tygodnia: `Mo-Fr`, `Sa,Su`, `Fr-Mo` (przez weekend), `Su[1]` (n-ty — przybliżone),
 * - miesiące i daty: `Apr-Oct`, `Nov-Mar`, `Jan 01-Mar 31`, `Dec 24`, `Dec 24-26`, rok `2026`,
 * - godziny: `09:00-18:00`, kilka przedziałów po przecinku, przez północ `22:00-02:00`, `24:00`,
 *   otwarty koniec `18:00+`, słońce `sunrise-sunset`, `(sunset-01:00)`,
 * - `24/7`, `off` / `closed`, `open`, `unknown`, komentarze w cudzysłowie,
 * - święta `PH` (`PH off`, `Su,PH 10:00-14:00`) — gdy nie wiadomo, czy dzień jest świętem, wynik
 *   jest przybliżony; ferie `SH` zawsze przybliżone,
 * - reguły: `;` i `||` nadpisują wcześniejsze dla pasujących dni, `,` przed nową regułą ją dodaje.
 *
 * Czego parser nie rozumie (np. „zimą do 17:00”), zwraca `null` — silnik bierze wtedy pierwszy
 * przedział z tekstu jako przybliżony.
 */

/** Minuty od północy danego dnia; koniec może przekraczać 1440 (otwarte przez północ). */
export type Interval = [open: number, close: number];

type TimePoint = { kind: 'clock'; min: number } | { kind: 'sun'; event: SunEvent; offset: number };
type SunEvent = 'sunrise' | 'sunset' | 'dawn' | 'dusk';
type TimeSpan = { from: TimePoint; to: TimePoint | null };
type MonthDay = { m: number; d: number };

type Rule = {
  additional: boolean;
  years: [number, number][] | null;
  dates: { from: MonthDay; to: MonthDay }[] | null;
  weekdays: Set<number> | null;
  publicHoliday: boolean;
  schoolHoliday: boolean;
  times: TimeSpan[] | null;
  state: 'open' | 'closed' | 'unknown';
  approximate: boolean;
};

export type OpeningHours = { rules: Rule[] };

export type OpeningContext = {
  /** Czy dzień jest świętem państwowym w kraju miejsca; brak = nie wiadomo. */
  publicHoliday?: boolean;
  /** Słońce w minutach od północy (czas lokalny miejsca). */
  sun?: { sunrise?: number; sunset?: number; dawn?: number; dusk?: number };
};

export type DayOpening = { intervals: Interval[]; approximate: boolean };

const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY = 24 * 60;

/** Ostatnie dni miesięcy (luty z 29 — „Feb 01-Feb 29” ma działać w każdym roku). */
const MONTH_END = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const CLOCK = String.raw`(?:[01]?\d|2[0-4]):[0-5]\d`;
const SUN = String.raw`(?:sunrise|sunset|dawn|dusk)`;
const POINT = String.raw`(?:${CLOCK}|${SUN}|\(\s*${SUN}\s*[+-]\s*${CLOCK}\s*\))`;
const SPAN = new RegExp(String.raw`^(${POINT})(?:\s*-\s*(${POINT})(\+)?|(\+))`);
const DAY_RANGE = new RegExp(String.raw`^(${DAYS.join('|')})(?:\[[^\]]+\])?(?:\s*-\s*(${DAYS.join('|')}))?`);
const MONTH_RANGE = new RegExp(
  // Dzień miesiąca nie może być początkiem godziny: „Apr 09:00-18:00” to kwiecień o 9:00.
  String.raw`^(${MONTHS.join('|')})(?:\s+(\d{1,2})(?![\d:]))?(?:\s*-\s*(?:(${MONTHS.join('|')})\s*)?(\d{1,2}(?![\d:]))?)?(?![a-z])`,
);

function parsePoint(text: string): TimePoint {
  const sun = /^\(?\s*(sunrise|sunset|dawn|dusk)\s*(?:([+-])\s*(\d{1,2}):(\d{2}))?\s*\)?$/.exec(text);
  if (sun !== null) {
    const offset = sun[2] === undefined ? 0 : (Number(sun[3]) * 60 + Number(sun[4])) * (sun[2] === '-' ? -1 : 1);
    return { kind: 'sun', event: sun[1] as SunEvent, offset };
  }
  const [h, m] = text.split(':').map(Number) as [number, number];
  return { kind: 'clock', min: h * 60 + m };
}

/** Jedna reguła („Mo-Fr 09:00-18:00”, „Dec 24 off”, „PH 10:00-14:00”); `null` = nie rozumiem. */
function parseRule(input: string, additional: boolean): Rule | null {
  const rule: Rule = {
    additional,
    years: null,
    dates: null,
    weekdays: null,
    publicHoliday: false,
    schoolHoliday: false,
    times: null,
    state: 'open',
    approximate: false,
  };
  let rest = input.trim();
  const eat = (pattern: RegExp) => {
    const match = pattern.exec(rest);
    if (match !== null) rest = rest.slice(match[0].length).trimStart();
    return match;
  };

  if (rest === '24/7') return { ...rule, times: null };

  const years = eat(/^(\d{4})(?:\s*-\s*(\d{4}))?(?=\s|$)/);
  if (years !== null) rule.years = [[Number(years[1]), Number(years[2] ?? years[1])]];

  // Miesiące / daty: „Apr-Oct”, „Jan 01-Mar 31”, „Dec 24-26”, „Jun,Sep”.
  for (let month = eat(MONTH_RANGE); month !== null; month = eat(/^,\s*/) && eat(MONTH_RANGE)) {
    const fromMonth = MONTHS.indexOf(month[1]!);
    const fromDay = month[2] === undefined ? 1 : Number(month[2]);
    const hasTo = month[3] !== undefined || month[4] !== undefined;
    const toMonth = month[3] !== undefined ? MONTHS.indexOf(month[3]) : fromMonth;
    const toDay = month[4] !== undefined ? Number(month[4]) : month[2] !== undefined && !hasTo ? fromDay : MONTH_END[toMonth]!;
    (rule.dates ??= []).push({ from: { m: fromMonth, d: fromDay }, to: { m: toMonth, d: toDay } });
  }

  // Numery tygodni — rzadkie; reguła zostaje, ale wynik jest przybliżony.
  if (eat(/^week\s+[\d,/-]+/) !== null) rule.approximate = true;

  // Dni tygodnia i święta: „Mo-Fr”, „Sa,Su”, „Su,PH”, „PH”, „SH”.
  for (;;) {
    const holiday = eat(/^(PH|SH)(?:\s*[+-]\s*\d+\s*days?)?/);
    if (holiday !== null) {
      if (holiday[1] === 'PH') rule.publicHoliday = true;
      else rule.schoolHoliday = true;
    } else {
      const days = eat(DAY_RANGE);
      if (days === null) break;
      if (days[0].includes('[')) rule.approximate = true;
      const from = DAYS.indexOf(days[1]!);
      const to = days[2] === undefined ? from : DAYS.indexOf(days[2]);
      rule.weekdays ??= new Set();
      for (let day = from; ; day = (day + 1) % 7) {
        rule.weekdays.add(day);
        if (day === to) break;
      }
    }
    if (eat(/^,\s*(?=[A-Z])/) === null) break;
  }

  // Godziny: „09:00-12:00,14:00-18:00”, „18:00+”, „sunrise-sunset”.
  for (let span = eat(SPAN); span !== null; span = eat(/^,\s*/) && eat(SPAN)) {
    const openEnd = span[3] !== undefined || span[4] !== undefined;
    if (openEnd) rule.approximate = true;
    (rule.times ??= []).push({ from: parsePoint(span[1]!), to: span[2] === undefined ? null : parsePoint(span[2]) });
  }

  const modifier = eat(/^(open|off|closed|unknown)\b/);
  if (modifier !== null) rule.state = modifier[1] === 'open' ? 'open' : modifier[1] === 'unknown' ? 'unknown' : 'closed';
  eat(/^"[^"]*"/);

  const empty = rule.years === null && rule.dates === null && rule.weekdays === null && !rule.publicHoliday && !rule.schoolHoliday && rule.times === null && modifier === null;
  if (rest !== '' || empty) return null;
  return rule;
}

/**
 * Tekst → reguły; `null`, gdy to nie jest składnia OSM (np. opis po polsku z dokumentu).
 * Przecinek przed nową regułą (po godzinie albo `off`, przed dniem lub miesiącem) to reguła dodatkowa.
 */
export function parseOpeningHours(raw: string | undefined): OpeningHours | null {
  if (raw === undefined) return null;
  const text = raw
    .replace(/[–—]/g, '-')
    .replace(/"[^"]*"/g, (comment) => comment.replace(/[;,|]/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
  if (text === '') return null;
  const rules: Rule[] = [];
  for (const part of text.split(/\s*(?:;|\|\|)\s*/)) {
    if (part === '') continue;
    const chunks = part.split(/(?<=\d|\+|off|closed|open)\s*,\s*(?=(?:\d{4}\s|[A-Z][a-z]|PH|SH))/);
    for (const [index, chunk] of chunks.entries()) {
      const rule = parseRule(chunk, index > 0);
      if (rule === null) return null;
      rules.push(rule);
    }
  }
  return rules.length === 0 ? null : { rules };
}

const dateParts = (date: string) => date.split('-').map(Number) as [number, number, number];

/** Dzień tygodnia 0 = poniedziałek (jak w OSM). */
function weekday(date: string): number {
  const [y, m, d] = dateParts(date);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

function inDates(rule: Rule, date: string): boolean {
  const [y, m, d] = dateParts(date);
  if (rule.years !== null && !rule.years.some(([from, to]) => y >= from && y <= to)) return false;
  if (rule.dates === null) return true;
  const key = (m - 1) * 100 + d;
  return rule.dates.some(({ from, to }) => {
    const start = from.m * 100 + from.d;
    const end = to.m * 100 + to.d;
    // „Nov-Mar” przechodzi przez Nowy Rok.
    return start <= end ? key >= start && key <= end : key >= start || key <= end;
  });
}

function matches(rule: Rule, date: string, ctx: OpeningContext): { match: boolean; approximate: boolean } {
  if (!inDates(rule, date)) return { match: false, approximate: false };
  if (rule.schoolHoliday) return { match: false, approximate: true };
  if (rule.weekdays === null && !rule.publicHoliday) return { match: true, approximate: false };
  const byWeekday = rule.weekdays?.has(weekday(date)) ?? false;
  if (!rule.publicHoliday) return { match: byWeekday, approximate: false };
  if (ctx.publicHoliday === undefined) return { match: byWeekday, approximate: true };
  return { match: byWeekday || ctx.publicHoliday, approximate: false };
}

function resolve(point: TimePoint, ctx: OpeningContext): { min: number; approximate: boolean } {
  if (point.kind === 'clock') return { min: point.min, approximate: false };
  const known = ctx.sun?.[point.event];
  // Bez współrzędnych: przeciętne godziny (wschód 6:00, zachód 18:00, zmierzch ±30 min).
  const fallback = { sunrise: 360, sunset: 1080, dawn: 330, dusk: 1110 }[point.event];
  return { min: (known ?? fallback) + point.offset, approximate: known === undefined };
}

function merge(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const out: Interval[] = [];
  for (const [open, close] of sorted) {
    const last = out[out.length - 1];
    if (last !== undefined && open <= last[1]) last[1] = Math.max(last[1], close);
    else out.push([open, close]);
  }
  return out;
}

/** Przedziały otwarcia w jednym dniu, bez tego, co przechodzi z dnia poprzedniego. */
function ownIntervals(hours: OpeningHours, date: string, ctx: OpeningContext): DayOpening {
  let intervals: Interval[] = [];
  let approximate = false;
  for (const rule of hours.rules) {
    const { match, approximate: unsure } = matches(rule, date, ctx);
    approximate ||= unsure;
    if (!match) continue;
    approximate ||= rule.approximate || rule.state === 'unknown';
    let spans: Interval[] = [];
    if (rule.state !== 'closed') {
      spans = (rule.times ?? [{ from: { kind: 'clock', min: 0 }, to: { kind: 'clock', min: DAY } }]).map((span) => {
        const from = resolve(span.from, ctx);
        const to = span.to === null ? { min: DAY, approximate: true } : resolve(span.to, ctx);
        approximate ||= from.approximate || to.approximate;
        return [from.min, to.min <= from.min ? to.min + DAY : to.min];
      });
    }
    // `off` zamyka dzień także jako reguła dodatkowa („Mo-Sa 10:00-18:00, PH off”).
    intervals = rule.state === 'closed' ? [] : rule.additional ? intervals.concat(spans) : spans;
  }
  return { intervals: merge(intervals), approximate };
}

const previousDate = (date: string) => {
  const [y, m, d] = dateParts(date);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
};

/**
 * Kiedy miejsce jest otwarte w danym dniu — razem z końcówką otwarcia z poprzedniej nocy
 * („Fr 18:00-02:00” w sobotę daje [0, 120]).
 */
export function openingOn(hours: OpeningHours, date: string, ctx: OpeningContext = {}): DayOpening {
  const today = ownIntervals(hours, date, ctx);
  const yesterday = ownIntervals(hours, previousDate(date), { ...ctx, publicHoliday: undefined, sun: ctx.sun });
  const spill = yesterday.intervals.filter(([, close]) => close > DAY).map(([, close]): Interval => [0, close - DAY]);
  return { intervals: merge([...spill, ...today.intervals]), approximate: today.approximate || (spill.length > 0 && yesterday.approximate) };
}

/**
 * Ile minut pobytu [start, end] wypada poza godzinami otwarcia (0 = cały w jednym przedziale).
 * Przy kilku przedziałach liczy się ten, w który pobyt trafia najlepiej.
 */
export function minutesOutside(opening: DayOpening, start: number, end: number): number {
  if (opening.intervals.length === 0) return end - start;
  return Math.min(...opening.intervals.map(([open, close]) => Math.max(0, open - start) + Math.max(0, end - close)));
}

export const formatInterval = ([open, close]: Interval) => {
  const clock = (min: number) => `${String(Math.floor((min % DAY) / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
  return `${clock(open)}–${close >= DAY && close % DAY === 0 && close !== open ? '24:00' : clock(close)}`;
};
