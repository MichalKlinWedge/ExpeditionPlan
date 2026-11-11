import { z } from 'zod';

import { itemsForDay, type ScheduleOptions } from './engine/schedule.ts';
import { capitalized, dayLabel, formatKm, plural } from './format.ts';
import type { GuideContent, GuideImage } from './guide.ts';
import { LEG_MODE } from './labels.ts';
import { dayLodging, formatMinutes, isTransit, transitPlaceRefs } from './plan-info.ts';
import { isRouteStop } from './route-stops.ts';
import type { TrackLine } from './gpx.ts';
import { profileSketch, trackProfile } from './track-profile.ts';
import type { TripDocument } from './schemas/trip-document.ts';
import { tripMemories } from './trip-memories.ts';

/**
 * Dwa pokazy z lektorem jednego wyjazdu (`ShowKind`): zapowiedź (`/trips/[id]/show`, czas przyszły, zdjęcia z opisów
 * miejsc) i film z wyjazdu (`/trips/[id]/film`, czas przeszły, przede wszystkim zdjęcia i wpisy z dziennika).
 * Każdy ma własny scenariusz (tabela `trip_shows`, wiersz na wyjazd i rodzaj).
 *
 * Pokaz z lektorem: sceny zebrane z planu — wstęp z mapą całej trasy, plansza „Dokąd jedziemy” (ogólnie o kraju albo
 * mieście, tekst AI z wiedzy ogólnej), po jednej scenie na dzień
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
  /**
   * Zatwierdzone (pole „zatwierdzone” w edytorze): nowy szkic z AI tego tekstu nie zastąpi. Ręczna poprawka zatwierdza
   * sama, odznaczenie oddaje tekst AI (`setShowLocked`).
   */
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

/**
 * Co pokazuje pierwsza scena (pola „pokaż” w edycji pod jej tekstem); brak pola = domyślnie (`introParts`).
 * Kolejność w scenie: mapa dojazdu, mapa całej trasy, kolaże, wybrane zdjęcia, plansza „Kto jedzie i plan”.
 */
export const ShowIntro = z.object({
  approach: z.boolean().optional(),
  route: z.boolean().optional(),
  collage: z.boolean().optional(),
  /** Dawne pole (osobny kolaż z opisów miejsc w filmie): już bez znaczenia, zostaje dla starszych scenariuszy. */
  guideCollage: z.boolean().optional(),
  plan: z.boolean().optional(),
});

/**
 * Co pokazuje ostatnia scena (pola „pokaż” pod jej tekstem); brak pola = domyślnie (`outroParts`).
 * Kolejność w scenie: mapa powrotu, mapa całej trasy, wybrane zdjęcia jako kolaż albo po kolei.
 */
export const ShowOutro = z.object({
  back: z.boolean().optional(),
  route: z.boolean().optional(),
  collage: z.boolean().optional(),
});

export const ShowScript = z.object({
  voice: z.string().min(1).default('Sulafat'),
  scenes: z.array(ShowNarration).default([]),
  music: ShowMusic.optional(),
  /** Mapa dojazdu na początku i powrotu na końcu (dawne pola; teraz `intro.approach` i `outro.back`, te zostają domyślnymi). */
  showApproach: z.boolean().default(true),
  showReturn: z.boolean().default(true),
  /**
   * Dawne „Zdjęcie na koniec” (`ShowImage.key`, pusty tekst = bez zdjęcia): już bez edycji, zostaje jako ostatnie zdjęcie
   * automatycznego zakończenia, póki nikt nie wybierze zdjęć zakończenia pod jego tekstem.
   */
  endPhoto: z.string().max(1000).optional(),
  /**
   * Zdjęcia scen wybrane w edycji: klucz sceny → klucze zdjęć (`ShowImage.key`) w kolejności pokazu, spośród pul
   * wszystkich scen dni i zakończenia (`ShowScene.pool`); pusta lista = scena bez zdjęć, brak sceny = wybór automatyczny
   * (`scenePhotos`).
   */
  photos: z.record(z.string(), z.array(z.string().max(1000)).max(40)).optional(),
  intro: ShowIntro.optional(),
  outro: ShowOutro.optional(),
  /** Wiersz pod „Dokąd jedziemy” (kraj, miejsca), zapisany przy szkicu AI z briefu (`destinationLine`), więc publiczny link pokazuje to samo. */
  destination: z.string().max(300).optional(),
});

export const SHOW_KINDS = ['preview', 'film'] as const;
export type ShowKind = (typeof SHOW_KINDS)[number];
export const isShowKind = (value: unknown): value is ShowKind => SHOW_KINDS.includes(value as ShowKind);

export type ShowAudio = z.infer<typeof ShowAudio>;
export type ShowIntro = z.infer<typeof ShowIntro>;
/**
 * Elementy pierwszej sceny: mapa dojazdu, mapa całej trasy, zdjęcia wstępu jako kolaż (`collage`) albo po kolei
 * (`false`), plansza planu.
 */
export type IntroParts = { approach: boolean; route: boolean; collage: boolean; plan: boolean };
export const INTRO_PARTS = ['approach', 'route', 'collage', 'plan'] as const;

/**
 * Elementy wstępu z wyborem w scenariuszu, a bez niego jak dotąd: zapowiedź z mapą trasy i dojazdu (`showApproach`),
 * film bez map (plansza z tytułem), oba z kolażami; plansza „Kto jedzie i plan” tylko na życzenie.
 */
export function introParts(script: { intro?: ShowIntro | undefined; showApproach?: boolean } | undefined, kind: ShowKind): IntroParts {
  const film = kind === 'film';
  const set = script?.intro ?? {};
  return {
    approach: set.approach ?? (film ? false : (script?.showApproach ?? true)),
    route: set.route ?? !film,
    collage: set.collage ?? true,
    plan: set.plan ?? false,
  };
}

/** Zmiana elementów wstępu w scenariuszu (tylko podane pola). */
export function setIntroParts(script: ShowScript, change: Partial<IntroParts>): ShowScript {
  const intro: ShowIntro = { ...script.intro };
  for (const part of INTRO_PARTS) if (typeof change[part] === 'boolean') intro[part] = change[part];
  return { ...script, intro };
}

export type ShowOutro = z.infer<typeof ShowOutro>;
/** Elementy ostatniej sceny: mapa powrotu, mapa całej trasy, zdjęcia jako kolaż (`collage`) albo po kolei (`false`). */
export type OutroParts = { back: boolean; route: boolean; collage: boolean };
export const OUTRO_PARTS = ['back', 'route', 'collage'] as const;

/** Elementy zakończenia z wyborem w scenariuszu, a bez niego jak dotąd: mapa powrotu (`showReturn`), mapa trasy, zdjęcia po kolei. */
export function outroParts(script: { outro?: ShowOutro | undefined; showReturn?: boolean } | undefined): OutroParts {
  const set = script?.outro ?? {};
  return { back: set.back ?? script?.showReturn ?? true, route: set.route ?? true, collage: set.collage ?? false };
}

/** Zmiana elementów zakończenia w scenariuszu (tylko podane pola). */
export function setOutroParts(script: ShowScript, change: Partial<OutroParts>): ShowScript {
  const outro: ShowOutro = { ...script.outro };
  for (const part of OUTRO_PARTS) if (typeof change[part] === 'boolean') outro[part] = change[part];
  return { ...script, outro };
}
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
/** `profile` — zarys profilu wysokości ze śladu GPX (km, m n.p.m.), gdy ślad ma wysokości. */
export type ShowWalk = { refs: string[]; title: string; label: string; facts: string; at?: [number, number]; profile?: { km: number; ele: number }[] };

/** Dojazd (wstęp) albo powrót (zakończenie): osobna mapa na początku i na końcu; mapy dni go nie pokazują. */
export type ShowApproach = { refs: string[]; label: 'Dojazd' | 'Powrót'; title: string; facts: string };

export type ShowScene = {
  key: string;
  kind: 'intro' | 'about' | 'day' | 'outro';
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
  /** Scena bez mapy: plansza z tekstem (wstęp bez map, „Dokąd jedziemy”), potem kolaż i zdjęcia. */
  mapless?: true;
  /** Wstęp: które elementy pokazuje (`introParts`); mapa dojazdu gra tylko przy `approach`. */
  intro?: IntroParts;
  /** Zakończenie: które elementy pokazuje (`outroParts`); mapa powrotu gra tylko przy `back`. */
  outro?: OutroParts;
  /** Wstęp z mapą dojazdu (zakończenie z mapą powrotu), ale bez mapy całej trasy. */
  noOverview?: true;
  /** Plansza „Kto jedzie i plan” na końcu wstępu: imiona uczestników i dni w skrócie. */
  plan?: { people: string[]; days: string[] };
  /**
   * Własne zdjęcia sceny do wyboru w edycji (dzień: wszystkie z dziennika i z opisów jego miejsc; zakończenie: z wpisów
   * bez dnia). Wybierać można też spośród zdjęć innych scen dni i zakończenia.
   */
  pool?: ShowImage[];
  /** Zdjęcia sceny wybrał człowiek (`ShowScript.photos`): pokaz wydłuża scenę, żeby pokazać każde. */
  chosen?: true;
  /** Fakty sceny dla AI piszącego tekst lektora. */
  facts: string[];
};

export type ShowCredits = {
  articles: { title: string; url: string; site: GuideContent['article']['site'] }[];
  images: { title: string; author?: string; license?: string; sourceUrl: string; own?: boolean }[];
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
  /** Zdjęcia scen wybrane w edycji (`ShowScript.photos`). */
  photos?: ShowScript['photos'];
  /** Dawne zdjęcie na koniec (`ShowScript.endPhoto`): ostatnie zdjęcie automatycznego zakończenia. */
  endPhoto?: string;
  /** Elementy wstępu (`introParts` ze scenariusza); bez nich domyślne dla rodzaju pokazu. */
  introParts?: IntroParts;
  /** Elementy zakończenia (`outroParts` ze scenariusza); bez nich domyślne. */
  outroParts?: OutroParts;
  /**
   * Wszystkie opisy miejsc wyjazdu (także miejsc spoza planu dni: inne warianty, punkty usunięte, same miejsca): ich
   * zdjęcia, których żadna scena nie ma w swojej puli, idą do wyboru jako „spoza planu” (`spare`).
   */
  allGuides?: readonly { title: string; images: readonly GuideImage[] }[];
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
export function walkFacts(item: Item): string {
  const km = walkKm(item);
  const minutes = item.durationMin ?? item.leg?.durationMin;
  return [km !== undefined ? formatKm(km) : '', item.activity?.ascentM ? `↑ ${item.activity.ascentM} m` : '', minutes ? formatMinutes(minutes) : ''].filter((part) => part !== '').join(' · ');
}

/** Liczby dnia na kartę: autem (bez dojazdu i powrotu), pieszo z podejściami, rowerem. */
export function dayStats(doc: Doc, items: readonly Item[]): string[] {
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

/**
 * Dojazd i powrót całego wyjazdu jako karty z punktami do mapy (`dayMap(doc, refs)`); `dayItems` = punkty kolejnych dni
 * (bez podpunktów poza postojami w trasie), jak w `showScenes`. Też dla pamiątki z wyjazdu.
 */
export function tripApproaches(doc: Doc, dayItems: readonly (readonly Item[])[]): { outbound?: ShowApproach; back?: ShowApproach } {
  const { outbound, back } = approaches(doc, dayItems[0] ?? [], dayItems.at(-1) ?? [], dayItems.flat());
  const outboundCard = approachCard(doc, outbound, 'Dojazd');
  const backCard = approachCard(doc, back, 'Powrót');
  return { ...(outboundCard ? { outbound: outboundCard } : {}), ...(backCard ? { back: backCard } : {}) };
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

/** Wszystkie zdjęcia wpisów dziennika (podpis: pierwszy wiersz wpisu). */
function journalPool(entries: ShowInput['journal'] & {}): ShowImage[] {
  return entries.flatMap((entry) => (entry.photoUrl === undefined ? [] : [{ url: entry.photoUrl, caption: entry.body.split('\n')[0]?.trim() ?? '', ...(entry.photoKey ? { key: entry.photoKey } : {}) }]));
}

/** Zdjęcia wpisów dziennika, najwyżej `FILM_IMAGES_PER_DAY`. */
const journalImages = (entries: ShowInput['journal'] & {}): ShowImage[] => journalPool(entries).slice(0, FILM_IMAGES_PER_DAY);

/** Najwięcej zdjęć wybranych do jednej sceny. */
export const SCENE_PHOTOS_MAX = 40;

/** Stały klucz zdjęcia pokazu (ścieżka w dzienniku, plik z Commons); bez klucza adres. */
export const showImageKey = (image: ShowImage): string => image.key ?? image.url;

/** Zdjęcia sceny: wybrane w edycji (w tej kolejności, tylko z puli sceny), inaczej automatyczne. */
export function scenePhotos(auto: readonly ShowImage[], pool: readonly ShowImage[], choice: readonly string[] | undefined): ShowImage[] {
  if (choice === undefined) return [...auto];
  const byKey = new Map(pool.map((image) => [showImageKey(image), image]));
  return [...new Set(choice)].flatMap((key) => (byKey.has(key) ? [byKey.get(key)!] : [])).slice(0, SCENE_PHOTOS_MAX);
}

/** Wybór zdjęć sceny w scenariuszu: lista kluczy w kolejności albo `null` = z powrotem automatycznie. */
export function setScenePhotos(script: ShowScript, sceneKey: string, keys: readonly string[] | null): ShowScript {
  const photos = { ...script.photos };
  if (keys === null) delete photos[sceneKey];
  else photos[sceneKey] = [...new Set(keys)].slice(0, SCENE_PHOTOS_MAX);
  const next: ShowScript = { ...script, photos };
  if (Object.keys(photos).length === 0) delete next.photos;
  return next;
}

const COLLAGE_MAX = 6;
/** Kolaż wstępu z wybranych zdjęć: najwyżej 3 × 3. */
export const INTRO_COLLAGE_MAX = 9;

/** Kolaż: pierwsze zdjęcia kolejnych dni, potem drugie itd., do `COLLAGE_MAX`; mniej niż 2 zdjęcia to nie kolaż. */
function collageOf(days: readonly ShowScene[]): ShowImage[] {
  const picked: ShowImage[] = [];
  for (let round = 0; picked.length < COLLAGE_MAX && days.some((day) => day.images.length > round); round += 1) {
    for (const day of days) if (day.images[round] && picked.length < COLLAGE_MAX) picked.push(day.images[round]!);
  }
  return picked.length >= 2 ? picked : [];
}

export function showScenes(doc: Doc, input: ShowInput): { scenes: ShowScene[]; credits: ShowCredits; spare: ShowImage[] } {
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
  const daySights = dayItems.map((items) => items.filter((item) => !approachRefs.has(item.ref) && isSight(item) && !(after && skipped.has(item.ref))));
  // Wpisy bez dnia (np. dodane po powrocie) zamykają film.
  const loose = journalAll.filter((entry) => entry.dayRef === undefined || !days.some((day) => day.ref === entry.dayRef));

  // Pule zdjęć do wyboru w edycji: dzień — wszystkie zdjęcia jego dziennika i opisów jego miejsc, zakończenie — zdjęcia
  // wpisów bez dnia. Każda scena wybiera z nich wszystkich (`tripPool`), także dzień bez własnych zdjęć.
  const guideImages = new Map<string, GuideImage>();
  const asShow = (item: Item, image: GuideImage): ShowImage => ({ url: image.thumbUrl, caption: item.title, key: image.url, ...(image.author ? { credit: image.author } : {}) });
  const dayPools = days.map((day, index) => {
    const pool = journalPool(journalAll.filter((entry) => entry.dayRef === day.ref));
    for (const item of daySights[index]!) {
      for (const image of input.guideOf(item)?.images ?? []) {
        if (pool.some((each) => each.key === image.url)) continue;
        guideImages.set(image.url, image);
        pool.push(asShow(item, image));
      }
    }
    return pool;
  });
  const outroPool = journalPool(loose);
  // Zdjęcia opisów miejsc, których nie ma w planie dni (inne warianty, same miejsca): do wyboru, nigdy automatycznie.
  const spare: ShowImage[] = [];
  for (const guide of input.allGuides ?? []) {
    for (const image of guide.images) {
      if (guideImages.has(image.url)) continue;
      guideImages.set(image.url, image);
      spare.push({ url: image.thumbUrl, caption: guide.title, key: image.url, ...(image.author ? { credit: image.author } : {}) });
    }
  }
  const tripPool = [...dayPools.flat(), ...outroPool, ...spare].filter((image, at, all) => all.findIndex((each) => showImageKey(each) === showImageKey(image)) === at);

  const dayScenes: ShowScene[] = days.map((day, index) => {
    const items = dayItems[index]!.filter((item) => !approachRefs.has(item.ref));
    const sights = daySights[index]!;
    const journal = journalAll.filter((entry) => entry.dayRef === day.ref);
    const images = journalImages(journal);
    const pool = dayPools[index]!;
    const autoUrls = new Set<string>();
    const facts: string[] = [`Dzień ${index + 1}: ${dayLabel(day.date)}${day.title ? ` — ${day.title}` : ''}`];
    if (day.summary) facts.push(`Opis dnia: ${day.summary}`);
    for (const item of sights) {
      const guide = input.guideOf(item);
      const image = guide?.images.find((each) => !seenUrls.has(each.url) && !autoUrls.has(each.url));
      if (guide && image !== undefined && images.length < IMAGES_PER_DAY) {
        autoUrls.add(image.url);
        images.push(asShow(item, image));
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
        const line = doc.tracks.find((track) => track.ref === item.activity?.trackRef)?.geojson as TrackLine | undefined;
        const profile = line === undefined ? null : profileSketch(trackProfile(line));
        return {
          refs: [item.ref],
          title: item.title,
          label,
          facts: walkFacts(item),
          ...(place?.lat !== undefined && place.lng !== undefined ? { at: [place.lng, place.lat] as [number, number] } : {}),
          ...(profile ? { profile } : {}),
        };
      });
    const points = [...sights.filter((item) => item.priority === 'must'), ...sights.filter((item) => item.priority !== 'must')]
      .filter((item) => !isShowWalk(item))
      .map((item) => item.title)
      .filter((title, at, all) => all.indexOf(title) === at)
      .slice(0, POINTS_PER_DAY);
    if (lodging !== null) points.push(`Nocleg: ${lodging.name}`);
    const key = `day:${day.ref}`;
    const choice = input.photos?.[key];
    const shown = scenePhotos(images, tripPool, choice);
    // Podziękowania i „już pokazane” liczą się ze zdjęć, które naprawdę grają.
    for (const image of shown) {
      const guideImage = guideImages.get(showImageKey(image));
      if (guideImage === undefined) continue;
      seenUrls.add(guideImage.url);
      usedImages.set(guideImage.url, guideImage);
    }
    return {
      key,
      kind: 'day',
      heading: `Dzień ${index + 1}${day.title ? ` · ${day.title}` : ''}`,
      subheading: dayLabel(day.date),
      routeRefs: items.map((item) => item.ref).filter((ref) => !(after && skipped.has(ref))),
      images: shown,
      ...(pool.length > 0 ? { pool } : {}),
      ...(choice !== undefined ? { chosen: true as const } : {}),
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
  for (const entry of loose) if (entry.body.trim() !== '') outro.push(`Wpis z dziennika: ${clip(entry.body.trim(), 400)}`);

  // Każde zdjęcie gra raz: wstęp ich nie powtarza, zakończenie ma tylko zdjęcia z wpisów bez dnia.
  // Wstęp, „Dokąd jedziemy” i zakończenie z wybranymi zdjęciami: podziękowania tylko za te, które grają.
  const chosenFor = (key: string, auto: readonly ShowImage[]) => {
    const shown = scenePhotos(auto, tripPool, input.photos?.[key]);
    for (const image of shown) {
      const guideImage = guideImages.get(showImageKey(image));
      if (guideImage !== undefined) usedImages.set(guideImage.url, guideImage);
    }
    return shown;
  };
  // Zakończenie bez wyboru: zdjęcia wpisów bez dnia i na koniec ostatnie zdjęcie wyjazdu (jedyne, które gra drugi raz),
  // a w starszym scenariuszu zdjęcie z dawnego „Zdjęcia na koniec” (pusty tekst = bez niego).
  const lastPhoto =
    input.endPhoto === '' ? undefined : input.endPhoto !== undefined ? tripPool.find((image) => showImageKey(image) === input.endPhoto) : dayScenes.flatMap((scene) => scene.images).at(-1);
  const outroAuto = journalImages(loose);
  if (lastPhoto !== undefined && !outroAuto.some((image) => showImageKey(image) === showImageKey(lastPhoto))) outroAuto.push(lastPhoto);
  const outroImages = chosenFor('outro', outroAuto);
  const parts = input.introParts ?? introParts(undefined, input.kind);
  const aboutImages = chosenFor('about', []);
  // Zdjęcia wstępu: wybrane pod jego tekstem, a bez wyboru po jednym z kolejnych dni (do 6); w filmie, gdy dni dają
  // mniej, dochodzą zdjęcia opisów miejsc, najpierw tych, których dni nie pokazują. Grają jako kolaż albo po kolei.
  const autoIntro = [...collageOf(dayScenes)];
  if (after && autoIntro.length < COLLAGE_MAX) {
    const sights = dayItems.flat().filter((item) => isSight(item) && !approachRefs.has(item.ref) && !skipped.has(item.ref));
    const candidates = sights.flatMap((item) => {
      const image = input.guideOf(item)?.images[0];
      return image === undefined ? [] : [{ item, image }];
    });
    const unseen = candidates.filter(({ image }) => !seenUrls.has(image.url));
    for (const { item, image } of [...unseen, ...candidates.filter((each) => !unseen.includes(each))]) {
      if (autoIntro.length >= COLLAGE_MAX) break;
      if (autoIntro.some((each) => showImageKey(each) === image.url)) continue;
      autoIntro.push({ url: image.thumbUrl, caption: item.title, key: image.url, ...(image.author ? { credit: image.author } : {}) });
    }
  }
  const introPhotos = chosenFor('intro', autoIntro.length >= 2 ? autoIntro : []);
  // Kolaż albo pokaz po kolei — jedno albo drugie; jedno zdjęcie to zawsze zwykłe zdjęcie.
  const collage = parts.collage && introPhotos.length >= 2 ? introPhotos.slice(0, INTRO_COLLAGE_MAX) : [];
  const introImages = collage.length > 0 ? [] : introPhotos;
  // Scena o celu: AI dostaje miejsca noclegów i najważniejsze punkty, a kraj i miejsca z briefu dokłada `showBrief`.
  const bases = days
    .map((day) => doc.places.find((place) => place.ref === day.baseRef)?.name ?? dayLodging(doc, day.ref)?.name)
    .filter((name): name is string => name !== undefined)
    .filter((name, at, all) => all.indexOf(name) === at);
  const highlights = dayItems
    .flat()
    .filter((item) => isSight(item) && item.priority === 'must' && !approachRefs.has(item.ref))
    .map((item) => item.title)
    .filter((title, at, all) => all.indexOf(title) === at)
    .slice(0, 8);
  const aboutFacts = [`Wyjazd: ${doc.trip.title}${doc.trip.subtitle ? ` — ${doc.trip.subtitle}` : ''}`];
  if (bases.length > 0) aboutFacts.push(`Noclegi: ${bases.join(', ')}`);
  if (highlights.length > 0) aboutFacts.push(`Najważniejsze punkty: ${highlights.join(', ')}`);
  const outboundCard = approachCard(doc, outbound, 'Dojazd');
  const backCard = approachCard(doc, back, 'Powrót');
  const localRoute = stats.routeRefs.filter((ref) => !approachRefs.has(ref));
  // Zakończenie: mapa powrotu, mapa trasy i zdjęcia jako kolaż albo po kolei; bez map plansza z tytułem i liczbami.
  const end = input.outroParts ?? outroParts(undefined);
  const backShown = end.back && backCard !== undefined;
  const outroCollage = end.collage && outroImages.length >= 2 ? outroImages.slice(0, INTRO_COLLAGE_MAX) : [];
  if (outboundCard) intro.push(`Dojazd: ${outboundCard.title}${outboundCard.facts ? ` (${outboundCard.facts})` : ''}`);
  // Bez mapy trasy i dojazdu wstęp zaczyna się planszą z tytułem (jak dotąd w filmie).
  const approachShown = parts.approach && outboundCard !== undefined;
  const introMapless = !parts.route && !approachShown;
  const plan = parts.plan
    ? {
        people: doc.travelers.map((traveler) => traveler.name).filter((name) => name.trim() !== ''),
        days: days.map((day, index) => `${index + 1}. ${clip(day.title?.trim() || capitalized(dayLabel(day.date)), 48)}`),
      }
    : undefined;

  const scenes: ShowScene[] = [
    {
      key: 'intro',
      kind: 'intro',
      heading: doc.trip.title,
      subheading: `${dayLabel(doc.trip.startDate)} – ${dayLabel(doc.trip.endDate)}`,
      routeRefs: localRoute,
      images: introImages,
      ...(input.photos?.intro !== undefined ? { chosen: true as const } : {}),
      ...(collage.length > 0 ? { collage } : {}),
      ...(introMapless ? { mapless: true as const } : {}),
      ...(!parts.route && approachShown ? { noOverview: true as const } : {}),
      intro: parts,
      ...(plan ? { plan } : {}),
      stats: [plural(stats.days, ['dzień', 'dni', 'dni']), ...numbers],
      points: [],
      walks: [],
      // Karta dojazdu zawsze (pole „mapa dojazdu” w edycji); gra tylko przy `intro.approach`.
      ...(outboundCard ? { approach: outboundCard } : {}),
      facts: intro,
    },
    {
      key: 'about',
      kind: 'about',
      heading: after ? 'Dokąd pojechaliśmy' : 'Dokąd jedziemy',
      routeRefs: [],
      images: aboutImages,
      ...(input.photos?.about !== undefined ? { chosen: true as const } : {}),
      // Plansza z tekstem: mapa całej trasy była przed chwilą we wstępie; zdjęcia (tylko wybrane) po niej.
      mapless: true,
      stats: [],
      points: [],
      walks: [],
      facts: aboutFacts,
    },
    ...dayScenes,
    {
      key: 'outro',
      kind: 'outro',
      heading: doc.trip.title,
      subheading: numbers.join(' · '),
      routeRefs: localRoute,
      images: outroCollage.length > 0 ? [] : outroImages,
      ...(outroPool.length > 0 ? { pool: outroPool } : {}),
      ...(input.photos?.outro !== undefined ? { chosen: true as const } : {}),
      ...(outroCollage.length > 0 ? { collage: outroCollage } : {}),
      ...(!end.route && !backShown ? { mapless: true as const } : {}),
      ...(!end.route && backShown ? { noOverview: true as const } : {}),
      outro: end,
      stats: [],
      points: [],
      walks: [],
      ...(backCard ? { approach: backCard } : {}),
      facts: outro,
    },
  ];
  return {
    scenes,
    spare,
    credits: {
      articles: [...usedArticles.values()].map((article) => ({ title: article.title, url: article.url, site: article.site })),
      images: [...usedImages.values()].map((image) => ({ title: image.title, ...(image.author ? { author: image.author } : {}), ...(image.license ? { license: image.license } : {}), sourceUrl: image.sourceUrl, ...(image.own ? { own: true } : {}) })),
    },
  };
}

/** Cel wyjazdu z briefu: kody krajów (ISO 3166-1) i miejsca tak, jak je wpisano. */
export type ShowDestination = { countries: readonly string[]; places: readonly string[] };

/** Polska nazwa kraju z kodu („GE” → „Gruzja”); nieznany kod zostaje kodem. */
export function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(['pl'], { type: 'region' }).of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

/** Wiersz pod „Dokąd jedziemy”: „Gruzja · Kutaisi, Zugdidi, Mestia” (najwyżej 5 miejsc). */
export function destinationLine(destination: ShowDestination): string {
  const places = destination.places.slice(0, 5).join(', ');
  return [destination.countries.map(countryName).join(', '), places].filter((part) => part !== '').join(' · ');
}

/**
 * Dane dla AI piszącego tekst lektora: tytuł, czas opowieści (film: przeszły) i fakty kolejnych scen; scena o celu
 * dostaje kraje i miejsca z briefu, gdy jest.
 */
export function showBrief(doc: Doc, scenes: readonly ShowScene[], kind: ShowKind, destination?: ShowDestination) {
  const extra = destination ? [`Kraj: ${destination.countries.map(countryName).join(', ')}`, ...(destination.places.length > 0 ? [`Miejsca z briefu: ${destination.places.join(', ')}`] : [])] : [];
  return {
    title: doc.trip.title,
    after: kind === 'film',
    scenes: scenes.map((scene) => ({ key: scene.key, kind: scene.kind, facts: scene.kind === 'about' ? [...scene.facts, ...extra] : scene.facts })),
  };
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

/** Zatwierdzenie tekstu sceny (AI go nie zmieni) albo jego zdjęcie (następny szkic AI napisze go od nowa). Scena bez tekstu bez zmian. */
export function setShowLocked(script: ShowScript, key: string, locked: boolean): ShowScript {
  const at = script.scenes.findIndex((scene) => scene.key === key);
  const old = script.scenes[at];
  if (old === undefined || old.text.trim() === '' || (old.edited === true) === locked) return script;
  const next: ShowNarration = { ...old };
  if (locked) next.edited = true;
  else delete next.edited;
  return { ...script, scenes: script.scenes.map((scene, index) => (index === at ? next : scene)) };
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
