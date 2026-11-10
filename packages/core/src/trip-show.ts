import { z } from 'zod';

import { itemsForDay, type ScheduleOptions } from './engine/schedule.ts';
import { dayLabel, formatKm, plural } from './format.ts';
import type { GuideContent, GuideImage } from './guide.ts';
import { LEG_MODE } from './labels.ts';
import { dayLodging, formatMinutes, isTransit, transitPlaceRefs } from './plan-info.ts';
import { isRouteStop } from './route-stops.ts';
import type { TripDocument } from './schemas/trip-document.ts';
import { tripMemories } from './trip-memories.ts';

/**
 * Dwa pokazy z lektorem jednego wyjazdu (`ShowKind`): zapowiedź (`/trips/[id]/show`, czas przyszły, zdjęcia z opisów
 * miejsc) i film z wyjazdu (`/trips/[id]/film`, czas przeszły, przede wszystkim zdjęcia i wpisy z dziennika).
 * Każdy ma własny scenariusz (tabela `trip_shows`, wiersz na wyjazd i rodzaj).
 *
 * Pokaz z lektorem: sceny zebrane z planu — wstęp z mapą całej trasy, po jednej scenie na dzień
 * (mapa dnia, zdjęcia z dziennika i z opisów miejsc) i zakończenie z podziękowaniami za zdjęcia i teksty.
 * Obraz liczy się zawsze od nowa z planu, a zapisany jest tylko tekst lektora i jego nagranie (`ShowScript`, tabela `trip_shows`).
 * Tekst pisze AI jako szkic z faktów sceny (`showBrief`), człowiek go poprawia; nagranie powstaje z tekstu (Gemini TTS)
 * i wie, z jakiego tekstu, głosu i modelu powstało (`narrationHash`), więc po poprawce nagrywa się tylko zmieniona scena.
 * Nieaktualne nagranie zostaje w scenie do czasu nowego (nie gra, `audioFits`), żeby plik dało się potem usunąć z bucketu.
 */

type Doc = TripDocument;
type Item = Doc['items'][number];

export const ShowAudio = z.object({
  /** Plik w prywatnym buckecie `show_audio`: `<trip_id>/<hash>.wav`. */
  path: z.string().min(1),
  hash: z.string().min(1),
  /** Model, którym nagrano: nowszy model Google nie unieważnia gotowych nagrań. */
  model: z.string().min(1),
  durationMs: z.number().int().positive(),
});

export const ShowNarration = z.object({
  key: z.string().min(1),
  text: z.string().max(3000),
  /** Poprawione ręcznie: nowy szkic z AI tego nie zastąpi. */
  edited: z.boolean().optional(),
  audio: ShowAudio.optional(),
});

/**
 * Podkład muzyczny: własny plik organizatora w tym samym buckecie co nagrania (`<trip_id>/muzyka-<znacznik>.<rozszerzenie>`),
 * więc pod publicznym linkiem gra na tej samej zgodzie co lektor. Prawa do utworu są po stronie tego, kto go wgrał.
 */
export const ShowMusic = z.object({
  path: z.string().min(1),
  /** Nazwa pliku od użytkownika, do pokazania w edytorze. */
  name: z.string().min(1).max(200),
  /** Głośność między scenami (0,05–1); pod lektorem odtwarzacz ścisza ją jeszcze bardziej. */
  volume: z.number().min(0.05).max(1).default(0.5),
  /** Ile sekund z początku pliku pominąć (cisza, wstęp); w pętli utwór też wraca do tego miejsca. */
  skipS: z.number().min(0).max(3600).default(0),
});

export const ShowScript = z.object({
  voice: z.string().min(1).default('Sulafat'),
  scenes: z.array(ShowNarration).default([]),
  music: ShowMusic.optional(),
  /** Mapa dojazdu na początku i powrotu na końcu pokazu (pola wyboru w edycji pokazu). */
  showApproach: z.boolean().default(true),
  showReturn: z.boolean().default(true),
  /**
   * Zdjęcie przed planszą końcową (`ShowImage.key`): brak = ostatnie zdjęcie wyjazdu, pusty tekst = bez zdjęcia
   * (`withEndPhoto`).
   */
  endPhoto: z.string().max(1000).optional(),
});

export const SHOW_KINDS = ['preview', 'film'] as const;
export type ShowKind = (typeof SHOW_KINDS)[number];
export const isShowKind = (value: unknown): value is ShowKind => SHOW_KINDS.includes(value as ShowKind);

export type ShowAudio = z.infer<typeof ShowAudio>;
export type ShowMusic = z.infer<typeof ShowMusic>;
export type ShowNarration = z.infer<typeof ShowNarration>;
export type ShowScript = z.infer<typeof ShowScript>;

/** Szkic tekstu lektora od AI: po jednym tekście na scenę. */
export const ShowDraft = z.object({
  scenes: z.array(z.object({ key: z.string().describe('klucz sceny dokładnie jak w danych'), text: z.string().describe('tekst lektora tej sceny') })),
});
export type ShowDraft = z.infer<typeof ShowDraft>;

/** `key`: stały klucz zdjęcia (ścieżka w dzienniku albo plik z Commons) do wyboru zdjęcia na koniec; adres bywa podpisany. */
export type ShowImage = { url: string; caption: string; credit?: string; key?: string };

/**
 * Trasa piesza albo rowerowa dnia: odtwarzacz przybliża ją osobno, z kartą liczb. Bez linii na mapie (aktywność bez
 * śladu GPX) przybliża jej miejsce (`at`, [lng, lat]).
 */
export type ShowWalk = { refs: string[]; title: string; label: string; facts: string; at?: [number, number] };

/** Dojazd (wstęp) albo powrót (zakończenie): osobna mapa na początku i na końcu; mapy dni go nie pokazują. */
export type ShowApproach = { refs: string[]; label: 'Dojazd' | 'Powrót'; title: string; facts: string };

export type ShowScene = {
  key: string;
  kind: 'intro' | 'day' | 'outro';
  heading: string;
  subheading?: string;
  /** Punkty na mapie sceny (`dayMap`): całej trasy albo dnia. */
  routeRefs: string[];
  images: ShowImage[];
  /** Karta „Plan dnia” na widoku mapy: liczby dnia (autem, pieszo, podejścia) i najważniejsze punkty. */
  stats: string[];
  points: string[];
  walks: ShowWalk[];
  approach?: ShowApproach;
  /** Kolaż we wstępie: po jednym zdjęciu z kolejnych dni (do 6), zapowiedź tego, co będzie w filmie. */
  collage?: ShowImage[];
  /** Film: wstęp bez mapy — plansza z tekstem, kolaż ze zdjęć opisów miejsc (`guideCollage`) i kolaż z dziennika. */
  mapless?: true;
  /** Kolaż ze zdjęć opisów miejsc (wstęp filmu): pierwsze zdjęcia kolejnych miejsc, najpierw te, których dni nie pokazują. */
  guideCollage?: ShowImage[];
  /** Fakty sceny dla AI piszącego tekst lektora. */
  facts: string[];
};

export type ShowCredits = {
  articles: { title: string; url: string; site: GuideContent['article']['site'] }[];
  images: { title: string; author?: string; license?: string; sourceUrl: string }[];
};

export type ShowInput = Pick<ScheduleOptions, 'activeVariants' | 'pulled'> & {
  done: readonly { itemRef: string }[];
  skipRefs: readonly string[];
  /** Opis punktu (jak `guideOf` na stronach planu). */
  guideOf: (item: Item) => GuideContent | null;
  /** Zdjęcia i wpisy z dziennika (adresy już podpisane), dzień po `dayRef`; używa ich tylko film z wyjazdu. */
  journal?: readonly { dayRef?: string; body: string; photoUrl?: string; photoKey?: string }[];
  /** Zapowiedź (czas przyszły, bez dziennika) albo film z wyjazdu (czas przeszły, dziennik na pierwszym planie). */
  kind: ShowKind;
};

const IMAGES_PER_DAY = 6;
/** Film z wyjazdu: tyle zdjęć z dziennika na dzień; zdjęcia z opisów miejsc dopełniają tylko do `IMAGES_PER_DAY`. */
const FILM_IMAGES_PER_DAY = 10;
const GUIDE_FACT_CHARS = 280;

const FOOT_MODES: ReadonlySet<string> = new Set(['walk', 'hike', 'bike']);
const CAR_MODES: ReadonlySet<string> = new Set(['car', 'rental_car', 'taxi', 'hired_driver']);
/** Krótszy spacer nie dostaje własnego ujęcia (przejście między zabytkami). */
const WALK_MIN_KM = 1.5;
const POINTS_PER_DAY = 6;

/**
 * Punkt pieszy albo rowerowy (przejście, trekking, ślad GPX, aktywność z opisem trasy: km, podejście, trudność) — na
 * mapie pokazu ma inny kolor i własne ujęcie.
 */
export const isShowWalk = (item: Item): boolean =>
  (item.kind === 'transport' && item.leg !== undefined && FOOT_MODES.has(item.leg.mode)) || item.activity?.trackRef !== undefined || (item.kind === 'activity' && item.activity !== undefined);

const walkKm = (item: Item) => item.activity?.distanceKm ?? item.leg?.distanceKm;

/** „12,4 km · ↑ 650 m · 4 h 30 min” z liczb planu (czego nie ma, tego nie ma). */
function walkFacts(item: Item): string {
  const km = walkKm(item);
  const minutes = item.durationMin ?? item.leg?.durationMin;
  return [km !== undefined ? formatKm(km) : '', item.activity?.ascentM ? `↑ ${item.activity.ascentM} m` : '', minutes ? formatMinutes(minutes) : ''].filter((part) => part !== '').join(' · ');
}

/** Liczby dnia na kartę: autem (bez dojazdu i powrotu), pieszo z podejściami, rowerem. */
function dayStats(doc: Doc, items: readonly Item[]): string[] {
  let car = 0;
  let foot = 0;
  let bike = 0;
  let ascent = 0;
  for (const item of items) {
    if (isShowWalk(item)) {
      if (item.leg?.mode === 'bike') bike += walkKm(item) ?? 0;
      else foot += walkKm(item) ?? 0;
      ascent += item.activity?.ascentM ?? 0;
    } else if (item.kind === 'transport' && item.leg !== undefined && CAR_MODES.has(item.leg.mode) && !isTransit(doc, item)) car += item.leg.distanceKm ?? 0;
  }
  return [
    car >= 1 ? `autem ${formatKm(car)}` : '',
    foot >= 1 ? `pieszo ${formatKm(foot)}${ascent > 0 ? ` · ↑ ${ascent} m` : ''}` : '',
    bike >= 1 ? `rowerem ${formatKm(bike)}` : '',
  ].filter((part) => part !== '');
}

/**
 * Dojazd i powrót: przejazdy pierwszego i ostatniego dnia z domu albo do domu (miejsce startu pierwszego przejazdu
 * wyjazdu, które nie jest noclegiem ani miejscem żadnego punktu) oraz loty i przejazdy dłuższe niż 250 km
 * (`isTransit`) albo z miejsc tylko dojazdowych (`transitPlaceRefs`).
 */
function approaches(doc: Doc, firstDay: readonly Item[], lastDay: readonly Item[], allItems: readonly Item[]): { outbound: Item[]; back: Item[] } {
  const legs = allItems.filter((item) => item.kind === 'transport' && item.leg !== undefined);
  const bases = new Set(doc.days.flatMap((day) => (day.baseRef === undefined ? [] : [day.baseRef])));
  const visited = new Set(allItems.filter((item) => item.kind !== 'transport').flatMap((item) => (item.placeRef === undefined ? [] : [item.placeRef])));
  const start = legs[0]?.leg?.fromPlaceRef;
  const home = start !== undefined && !bases.has(start) && !visited.has(start) ? start : undefined;
  const transitPlaces = transitPlaceRefs(doc);
  // Lot bywa punktem bez `leg` (przylot z rezerwacją lotu): `isTransit` rozpoznaje go po rezerwacji.
  const isApproach = (item: Item) =>
    item.kind === 'transport' &&
    (isTransit(doc, item) || [item.leg?.fromPlaceRef, item.leg?.toPlaceRef].some((ref) => ref !== undefined && (ref === home || transitPlaces.has(ref))));
  // Punkty, które nie są przejazdem, ale należą do dojazdu: oznaczone jako dojazd (lot z rezerwacji, „Dojazd lub powrót”)
  // albo stojące tam, skąd dojazd rusza (zbiórka i odprawa na lotnisku w domu); przy powrocie — tam, dokąd wraca.
  const along = (legs: readonly Item[], end: 'fromPlaceRef' | 'toPlaceRef') => {
    const places = new Set(legs.flatMap((leg) => (leg.leg?.[end] === undefined ? [] : [leg.leg[end]!])));
    // Cel dojazdu (lotnisko na miejscu) i start powrotu to już wyjazd: odbiór i zwrot auta zostają w dniu.
    const local = end === 'fromPlaceRef' ? legs.at(-1)?.leg?.toPlaceRef : legs[0]?.leg?.fromPlaceRef;
    if (local !== undefined) places.delete(local);
    return (item: Item) => item.kind !== 'transport' && (isTransit(doc, item) || (item.placeRef !== undefined && places.has(item.placeRef)));
  };
  const outboundLegs = firstDay.filter(isApproach);
  const backLegs = firstDay === lastDay ? [] : lastDay.filter(isApproach);
  const outboundStop = along(outboundLegs, 'fromPlaceRef');
  const backStop = along(backLegs, 'toPlaceRef');
  return {
    outbound: outboundLegs.length === 0 ? [] : firstDay.filter((item) => outboundLegs.includes(item) || outboundStop(item)),
    back: backLegs.length === 0 ? [] : lastDay.filter((item) => backLegs.includes(item) || backStop(item)),
  };
}

/** „Wrocław → Parking …” i „autem 130 km” dla karty dojazdu albo powrotu. */
function approachCard(doc: Doc, items: readonly Item[], label: ShowApproach['label']): ShowApproach | undefined {
  if (items.length === 0) return undefined;
  const name = (ref: string | undefined) => doc.places.find((place) => place.ref === ref)?.name;
  // Opis „A → B · samolot” z samych przejazdów; zbiórka czy odprawa obok nich idą tylko na mapę.
  const legs = items.some((item) => item.kind === 'transport') ? items.filter((item) => item.kind === 'transport') : items;
  const from = name(legs[0]!.leg?.fromPlaceRef ?? legs[0]!.placeRef);
  const to = name(legs.at(-1)!.leg?.toPlaceRef ?? legs.at(-1)!.placeRef);
  const km = legs.reduce((sum, item) => sum + (item.leg?.distanceKm ?? 0), 0);
  const flightBooking = (item: Item) => item.bookingRef !== undefined && doc.bookings.find((booking) => booking.ref === item.bookingRef)?.kind === 'flight';
  const mode = (item: Item) => (item.leg !== undefined ? (LEG_MODE[item.leg.mode] ?? item.leg.mode) : flightBooking(item) || (item.kind === 'transport' && isTransit(doc, item)) ? LEG_MODE.flight! : '');
  const modes = [...new Set(legs.map(mode).filter((each) => each !== ''))];
  return {
    refs: items.map((item) => item.ref),
    label,
    // Sam przylot (punkt bez „skąd”) ma tylko cel: wtedy nazwa punktu („Lądowanie w Agadirze”).
    title: from && to && from !== to ? `${from} → ${to}` : legs.length === 1 ? legs[0]!.title : (to ?? from ?? legs[0]!.title),
    facts: [modes.join(', '), km >= 1 ? formatKm(km) : ''].filter((part) => part !== '').join(' · '),
  };
}

const isSight = (item: Item) => item.kind === 'visit' || item.kind === 'activity' || (item.kind === 'transport' && item.leg?.mode === 'hike');

const clip = (text: string, limit: number) => (text.length <= limit ? text : `${text.slice(0, limit).replace(/\s+\S*$/, '')}…`);

/** Zdjęcia wpisów dziennika (podpis: pierwszy wiersz wpisu), najwyżej `FILM_IMAGES_PER_DAY`. */
function journalImages(entries: ShowInput['journal'] & {}): ShowImage[] {
  return entries
    .flatMap((entry) => (entry.photoUrl === undefined ? [] : [{ url: entry.photoUrl, caption: entry.body.split('\n')[0]?.trim() ?? '', ...(entry.photoKey ? { key: entry.photoKey } : {}) }]))
    .slice(0, FILM_IMAGES_PER_DAY);
}

const COLLAGE_MAX = 6;

/** Kolaż: pierwsze zdjęcia kolejnych dni, potem drugie itd., do `COLLAGE_MAX`; mniej niż 2 zdjęcia to nie kolaż. */
function collageOf(days: readonly ShowScene[]): ShowImage[] {
  const picked: ShowImage[] = [];
  for (let round = 0; picked.length < COLLAGE_MAX && days.some((day) => day.images.length > round); round += 1) {
    for (const day of days) if (day.images[round] && picked.length < COLLAGE_MAX) picked.push(day.images[round]!);
  }
  return picked.length >= 2 ? picked : [];
}

/**
 * Zdjęcie przed planszą końcową, dopisane na koniec zakończenia: wybrane (`ShowScript.endPhoto` = `ShowImage.key` albo
 * adres), domyślnie ostatnie zdjęcie ostatniego dnia, który je ma; pusty tekst = bez zdjęcia. Jedyne zdjęcie, które gra
 * drugi raz — tak chciał organizator.
 */
export function withEndPhoto<S extends { kind: string; images: ShowImage[] }>(scenes: readonly S[], choice?: string): S[] {
  if (choice === '') return [...scenes];
  const days = scenes.filter((scene) => scene.kind === 'day');
  const all = days.flatMap((scene) => scene.images);
  const chosen = choice === undefined ? days.flatMap((scene) => scene.images).at(-1) : all.find((image) => (image.key ?? image.url) === choice);
  if (chosen === undefined) return [...scenes];
  return scenes.map((scene) => (scene.kind === 'outro' && !scene.images.some((image) => image.url === chosen.url) ? { ...scene, images: [...scene.images, chosen] } : scene));
}

export function showScenes(doc: Doc, input: ShowInput): { scenes: ShowScene[]; credits: ShowCredits } {
  const schedule = { ...(input.activeVariants ? { activeVariants: input.activeVariants } : {}), ...(input.pulled ? { pulled: input.pulled } : {}) };
  // Film opowiada o tym, co było; zapowiedź o tym, co będzie (niezależnie od daty).
  const after = input.kind === 'film';
  const journalAll = after ? (input.journal ?? []) : [];
  const done = new Set(input.done.map((each) => each.itemRef));
  const skipped = new Set(input.skipRefs);
  const stats = tripMemories(doc, { ...schedule, done: input.done, skipRefs: input.skipRefs });
  const days = [...doc.days].sort((a, b) => a.date.localeCompare(b.date));
  const usedImages = new Map<string, GuideImage>();
  const usedArticles = new Map<string, GuideContent['article']>();
  const seenUrls = new Set<string>();

  const dayItems = days.map((day) => itemsForDay(doc, day.ref, schedule).filter((item) => item.parentRef === undefined || isRouteStop(doc, item)));
  const { outbound, back } = approaches(doc, dayItems[0] ?? [], dayItems.at(-1) ?? [], dayItems.flat());
  // Dojazd i powrót mają własne mapy we wstępie i zakończeniu: mapy dni zaczynają się na miejscu.
  const approachRefs = new Set([...outbound, ...back].map((item) => item.ref));

  const dayScenes: ShowScene[] = days.map((day, index) => {
    const items = dayItems[index]!.filter((item) => !approachRefs.has(item.ref));
    const sights = items.filter(isSight).filter((item) => !(after && skipped.has(item.ref)));
    const journal = journalAll.filter((entry) => entry.dayRef === day.ref);
    const images = journalImages(journal);
    const facts: string[] = [`Dzień ${index + 1}: ${dayLabel(day.date)}${day.title ? ` — ${day.title}` : ''}`];
    if (day.summary) facts.push(`Opis dnia: ${day.summary}`);
    for (const item of sights) {
      const guide = input.guideOf(item);
      const image = guide?.images.find((each) => !seenUrls.has(each.url));
      if (guide && image !== undefined && images.length < IMAGES_PER_DAY) {
        seenUrls.add(image.url);
        usedImages.set(image.url, image);
        images.push({ url: image.thumbUrl, caption: item.title, key: image.url, ...(image.author ? { credit: image.author } : {}) });
      }
      const km = item.activity?.distanceKm ?? item.leg?.distanceKm;
      const parts = [
        `Punkt: ${item.title}`,
        item.priority === 'must' ? '(najważniejszy punkt dnia)' : '',
        km !== undefined && item.kind === 'transport' ? `trasa piesza ${formatKm(km)}` : '',
        item.activity?.ascentM ? `podejście ${item.activity.ascentM} m` : '',
        after && done.has(item.ref) ? '(zrobione)' : '',
      ].filter((part) => part !== '');
      if (guide) {
        usedArticles.set(guide.article.url, guide.article);
        parts.push(`— ${clip(guide.summary, GUIDE_FACT_CHARS)}`);
      }
      facts.push(parts.join(' '));
    }
    if (after) {
      const missed = items.filter((item) => skipped.has(item.ref) && isSight(item)).map((item) => item.title);
      if (missed.length > 0) facts.push(`Pominięte w terenie: ${missed.join(', ')}`);
      for (const entry of journal) if (entry.body.trim() !== '') facts.push(`Wpis z dziennika: ${clip(entry.body.trim(), 400)}`);
    }
    const lodging = dayLodging(doc, day.ref);
    if (lodging !== null) facts.push(`Nocleg: ${lodging.name}`);
    const counted = items.filter((item) => !(after && skipped.has(item.ref)));
    const walks = counted
      // Krótkie przejście między zabytkami nie; trekking, ślad, aktywność z trasą zawsze.
      .filter((item) => isShowWalk(item) && (item.activity !== undefined || item.leg?.mode === 'hike' || (walkKm(item) ?? 0) >= WALK_MIN_KM))
      // Wejście i zejście tym samym śladem to jedno ujęcie (pierwszy punkt).
      .filter((item, at, all) => item.activity?.trackRef === undefined || all.findIndex((each) => each.activity?.trackRef === item.activity?.trackRef) === at)
      .map((item) => {
        const place = doc.places.find((each) => each.ref === (item.leg?.toPlaceRef ?? item.placeRef));
        const label = item.leg?.mode === 'bike' ? 'Rowerem' : item.kind === 'transport' ? 'Trasa piesza' : 'Trasa';
        return { refs: [item.ref], title: item.title, label, facts: walkFacts(item), ...(place?.lat !== undefined && place.lng !== undefined ? { at: [place.lng, place.lat] as [number, number] } : {}) };
      });
    const points = [...sights.filter((item) => item.priority === 'must'), ...sights.filter((item) => item.priority !== 'must')]
      .filter((item) => !isShowWalk(item))
      .map((item) => item.title)
      .filter((title, at, all) => all.indexOf(title) === at)
      .slice(0, POINTS_PER_DAY);
    if (lodging !== null) points.push(`Nocleg: ${lodging.name}`);
    return {
      key: `day:${day.ref}`,
      kind: 'day',
      heading: `Dzień ${index + 1}${day.title ? ` · ${day.title}` : ''}`,
      subheading: dayLabel(day.date),
      routeRefs: items.map((item) => item.ref).filter((ref) => !(after && skipped.has(ref))),
      images,
      stats: dayStats(doc, counted),
      points,
      walks,
      facts,
    };
  });

  const intro: string[] = [
    `Wyjazd: ${doc.trip.title}${doc.trip.subtitle ? ` — ${doc.trip.subtitle}` : ''}`,
    `Termin: ${dayLabel(doc.trip.startDate)} – ${dayLabel(doc.trip.endDate)} (${plural(stats.days, ['dzień', 'dni', 'dni'])})`,
  ];
  if (doc.travelers.length > 0) intro.push(`Jadą: ${doc.travelers.map((traveler) => traveler.name).join(', ')}`);
  if (doc.trip.goal) intro.push(`Cel: ${doc.trip.goal}`);
  if (doc.trip.summary) intro.push(`Opis: ${doc.trip.summary}`);
  const numbers = [
    stats.footKm > 0 ? `pieszo ${formatKm(stats.footKm)}${stats.ascentM > 0 ? `, ${stats.ascentM} m podejść` : ''}` : '',
    stats.driveKm > 0 ? `autem ${formatKm(stats.driveKm)}` : '',
    stats.transitKm > 0 ? `komunikacją ${formatKm(stats.transitKm)}` : '',
    stats.flightKm > 0 ? `samolotem ${formatKm(stats.flightKm)}` : '',
  ].filter((part) => part !== '');
  // Liczba punktów planu brzmi jak raport, a nie opowieść: po wyjeździe liczy się, ile zrobiono.
  const outro: string[] = numbers.length > 0 ? [`Liczby: ${numbers.join(', ')}`] : [];
  if (after && stats.done > 0) outro.push(`Zrobione: ${stats.done} z ${stats.planned}`);
  if (after && journalAll.length > 0) outro.push(`Wpisów w dzienniku: ${journalAll.length}`);
  // Wpisy bez dnia (np. dodane po powrocie) zamykają film.
  const loose = journalAll.filter((entry) => entry.dayRef === undefined || !days.some((day) => day.ref === entry.dayRef));
  for (const entry of loose) if (entry.body.trim() !== '') outro.push(`Wpis z dziennika: ${clip(entry.body.trim(), 400)}`);

  // Każde zdjęcie gra raz: wstęp ich nie powtarza, zakończenie ma tylko zdjęcia z wpisów bez dnia.
  const outroImages = journalImages(loose);
  const collage = collageOf(dayScenes);
  // Film zaczyna się bez mapy: zamiast niej kolaż ze zdjęć opisów miejsc (najpierw tych, których dni nie pokazują).
  const guideCollage: ShowImage[] = [];
  if (after) {
    const sights = dayItems.flat().filter((item) => isSight(item) && !approachRefs.has(item.ref) && !skipped.has(item.ref));
    const candidates = sights.flatMap((item) => {
      const image = input.guideOf(item)?.images[0];
      return image === undefined ? [] : [{ item, image }];
    });
    const unseen = candidates.filter(({ image }) => !seenUrls.has(image.url));
    for (const { item, image } of [...unseen, ...candidates.filter((each) => !unseen.includes(each))]) {
      if (guideCollage.length >= COLLAGE_MAX) break;
      if (guideCollage.some((each) => each.key === image.url)) continue;
      usedImages.set(image.url, image);
      guideCollage.push({ url: image.thumbUrl, caption: item.title, key: image.url, ...(image.author ? { credit: image.author } : {}) });
    }
    if (guideCollage.length < 2) guideCollage.length = 0;
  }
  const outboundCard = approachCard(doc, outbound, 'Dojazd');
  const backCard = approachCard(doc, back, 'Powrót');
  const localRoute = stats.routeRefs.filter((ref) => !approachRefs.has(ref));
  if (outboundCard) intro.push(`Dojazd: ${outboundCard.title}${outboundCard.facts ? ` (${outboundCard.facts})` : ''}`);

  const scenes: ShowScene[] = [
    {
      key: 'intro',
      kind: 'intro',
      heading: doc.trip.title,
      subheading: `${dayLabel(doc.trip.startDate)} – ${dayLabel(doc.trip.endDate)}`,
      routeRefs: localRoute,
      images: [],
      ...(collage.length > 0 ? { collage } : {}),
      ...(after ? { mapless: true as const } : {}),
      ...(guideCollage.length > 0 ? { guideCollage } : {}),
      stats: [plural(stats.days, ['dzień', 'dni', 'dni']), ...numbers],
      points: [],
      walks: [],
      // Wstęp filmu nie ma mapy, więc i mapy dojazdu (opis dojazdu zostaje w faktach dla lektora).
      ...(outboundCard && !after ? { approach: outboundCard } : {}),
      facts: intro,
    },
    ...dayScenes,
    {
      key: 'outro',
      kind: 'outro',
      heading: doc.trip.title,
      subheading: numbers.join(' · '),
      routeRefs: localRoute,
      images: outroImages,
      stats: [],
      points: [],
      walks: [],
      ...(backCard ? { approach: backCard } : {}),
      facts: outro,
    },
  ];
  return {
    scenes,
    credits: {
      articles: [...usedArticles.values()].map((article) => ({ title: article.title, url: article.url, site: article.site })),
      images: [...usedImages.values()].map((image) => ({ title: image.title, ...(image.author ? { author: image.author } : {}), ...(image.license ? { license: image.license } : {}), sourceUrl: image.sourceUrl })),
    },
  };
}

/** Dane dla AI piszącego tekst lektora: tytuł, czas opowieści (film: przeszły) i fakty kolejnych scen. */
export function showBrief(doc: Doc, scenes: readonly ShowScene[], kind: ShowKind) {
  return { title: doc.trip.title, after: kind === 'film', scenes: scenes.map((scene) => ({ key: scene.key, kind: scene.kind, facts: scene.facts })) };
}
export type ShowBrief = ReturnType<typeof showBrief>;

/**
 * Szkic AI w zapisanym scenariuszu: tekst dostają sceny puste i niepoprawione ręcznie (stare nagranie przestaje pasować). Klucze spoza scen planu są pomijane; sceny planu bez szkicu zostają, jak były.
 */
export function applyShowDraft(script: ShowScript, scenes: readonly ShowScene[], draft: ShowDraft): ShowScript {
  const texts = new Map(draft.scenes.map((scene) => [scene.key, scene.text.trim()]));
  const stored = new Map(script.scenes.map((scene) => [scene.key, scene]));
  return {
    ...script,
    scenes: scenes.flatMap((scene) => {
      const old = stored.get(scene.key);
      const text = texts.get(scene.key);
      if (old?.edited && old.text.trim() !== '') return [old];
      if (text === undefined || text === '') return old ? [old] : [];
      return [{ key: scene.key, text, ...(old?.audio ? { audio: old.audio } : {}) }];
    }),
  };
}

/** Tekst sceny poprawiony ręcznie; pusty tekst usuwa scenę ze scenariusza (wraca szkic przy następnym AI). */
export function editShowText(script: ShowScript, key: string, text: string): ShowScript {
  const trimmed = text.trim();
  const others = script.scenes.filter((scene) => scene.key !== key);
  const old = script.scenes.find((scene) => scene.key === key);
  if (trimmed === '') return { ...script, scenes: others };
  if (old?.text === trimmed) return script;
  const at = script.scenes.findIndex((scene) => scene.key === key);
  const next: ShowNarration = { key, text: trimmed, edited: true, ...(old?.audio ? { audio: old.audio } : {}) };
  return { ...script, scenes: at === -1 ? [...script.scenes, next] : script.scenes.map((scene, index) => (index === at ? next : scene)) };
}

/** Odcisk tekstu, głosu i modelu (FNV-1a, 2 × 32 bity): nagranie z tym odciskiem pasuje do tekstu sceny. */
export function narrationHash(text: string, voice: string, model: string): string {
  const input = `${model}\u0000${voice}\u0000${text.trim()}`;
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ code, 0x5bd1e995) >>> 0;
  }
  return `${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`;
}

/** Czy nagranie sceny pasuje do jej tekstu i głosu scenariusza. */
export const audioFits = (scene: ShowNarration, voice: string): scene is ShowNarration & { audio: ShowAudio } =>
  scene.audio !== undefined && scene.audio.hash === narrationHash(scene.text, voice, scene.audio.model);

/** Sceny, którym brakuje nagrania pasującego do tekstu (po poprawce albo zmianie głosu). */
export function scenesToRecord(script: ShowScript): string[] {
  return script.scenes.filter((scene) => scene.text.trim() !== '' && !audioFits(scene, script.voice)).map((scene) => scene.key);
}

const audioPaths = (script: ShowScript) => [...script.scenes.flatMap((scene) => (scene.audio ? [scene.audio.path] : [])), ...(script.music ? [script.music.path] : [])];

/** Pliki nagrań i podkładu, których nowy scenariusz już nie używa: do usunięcia z bucketu. */
export function droppedAudio(before: ShowScript, after: ShowScript): string[] {
  const kept = new Set(audioPaths(after));
  return [...new Set(audioPaths(before).filter((path) => !kept.has(path)))];
}

/** Formaty podkładu przyjmowane przez bucket `show_audio` (typ pliku → rozszerzenie). */
const MUSIC_TYPES: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
};
const MUSIC_EXTENSIONS: Record<string, string> = { mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', wav: 'audio/wav' };
/** Największy plik podkładu (limit bucketu `show_audio`). */
export const MUSIC_MAX_BYTES = 20 * 1024 * 1024;

/**
 * Ścieżka i typ podkładu z pliku od użytkownika: typ z przeglądarki, a gdy go nie ma, z rozszerzenia nazwy.
 * `null`, gdy to nie MP3, M4A, AAC, OGG ani WAV.
 */
export function showMusicFile(tripId: string, file: { name: string; type: string }, stamp: string): { path: string; contentType: string } | null {
  const fromName = file.name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  const ext = MUSIC_TYPES[file.type] ?? (fromName !== undefined && MUSIC_EXTENSIONS[fromName] !== undefined ? fromName : undefined);
  if (ext === undefined) return null;
  return { path: `${tripId}/muzyka-${stamp}.${ext}`, contentType: MUSIC_EXTENSIONS[ext]! };
}

/** Czy ścieżka to podkład tego wyjazdu (zapisany przez `showMusicFile`). */
export const isShowMusicPath = (tripId: string, path: string): boolean =>
  path.startsWith(`${tripId}/`) && /^muzyka-[a-z0-9]+\.(mp3|m4a|aac|ogg|wav)$/.test(path.slice(tripId.length + 1));

/** Nagranie sceny w scenariuszu (tylko gdy tekst się w międzyczasie nie zmienił). */
export function setShowAudio(script: ShowScript, key: string, audio: ShowAudio, text: string): ShowScript {
  return { ...script, scenes: script.scenes.map((scene) => (scene.key === key && scene.text === text ? { ...scene, audio } : scene)) };
}

/** Czas sceny bez nagrania: tyle, ile zajmuje przeczytanie napisów (ok. 15 znaków na sekundę), co najmniej 5 s. */
export const readingMs = (text: string): number => Math.max(5_000, Math.round((text.trim().length / 15) * 1000));
