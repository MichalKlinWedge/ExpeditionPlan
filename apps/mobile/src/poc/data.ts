/**
 * Dane do PoC-2 (mapa offline) i PoC-3 (geofencing) — PLAN_ETAPOWY.md. Kod PoC może zostać
 * wyrzucony; zostają wnioski w POC_WYNIKI.md.
 */

export type LngLat = [number, number];

export type Region = {
  id: string;
  name: string;
  /** [zachód, południe, wschód, północ] */
  bounds: [number, number, number, number];
  center: LngLat;
  zoom: number;
};

/** Miasto i region z PLAN_ETAPOWY (PoC-2): medyna Marakeszu i Góry Bystrzyckie ze ścieżką do chatki. */
export const REGIONS: Region[] = [
  {
    id: 'marrakesh',
    name: 'Marakesz (medyna i Gueliz)',
    bounds: [-8.05, 31.6, -7.96, 31.66],
    center: [-7.9889, 31.6258],
    zoom: 14,
  },
  {
    id: 'bystrzyckie',
    name: 'Góry Bystrzyckie (Spalona, Chatka)',
    bounds: [16.45, 50.2, 16.65, 50.33],
    center: [16.5373, 50.2767],
    zoom: 13,
  },
];

export type WalkPoint = { id: string; name: string; latitude: number; longitude: number };

/**
 * Punkty spaceru po Wrocławiu (współrzędne z OSM/Nominatim, 31.10.2026), co najmniej ok. 200 m od
 * siebie — strefy 100 m nie nachodzą na siebie. Inne miasto: dodaj punkty przyciskiem „Dodaj tutaj”.
 */
export const WALK_POINTS: WalkPoint[] = [
  { id: 'ratusz', name: 'Ratusz', latitude: 51.10958, longitude: 17.03207 },
  { id: 'elzbieta', name: 'Kościół św. Elżbiety', latitude: 51.11162, longitude: 17.03038 },
  { id: 'leopoldina', name: 'Aula Leopoldina', latitude: 51.11378, longitude: 17.03328 },
  { id: 'hala-targowa', name: 'Hala Targowa', latitude: 51.11243, longitude: 17.04034 },
  { id: 'most-tumski', name: 'Most Tumski', latitude: 51.11472, longitude: 17.04227 },
  { id: 'katedra', name: 'Katedra', latitude: 51.11399, longitude: 17.04601 },
  { id: 'ogrod', name: 'Ogród Botaniczny', latitude: 51.11598, longitude: 17.04772 },
  { id: 'panorama', name: 'Panorama Racławicka', latitude: 51.11025, longitude: 17.04461 },
  { id: 'opera', name: 'Opera', latitude: 51.1057, longitude: 17.03061 },
  { id: 'nfm', name: 'Narodowe Forum Muzyki', latitude: 51.10698, longitude: 17.02654 },
];
