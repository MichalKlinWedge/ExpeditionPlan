import { Directory, File, Paths } from 'expo-file-system';

/**
 * Miniatury zdjęć przewodnika jako pliki w katalogu aplikacji (jak dokumenty sejfu), a nie tylko
 * w pamięci podręcznej `expo-image`, którą biblioteka może wyczyścić przy braku miejsca. Wspólny
 * katalog dla wszystkich wyjazdów — to samo zdjęcie z Commons w dwóch wyjazdach to jeden plik.
 */

const FOLDER = 'guide-images';

/** Krótki, stały skrót adresu (FNV-1a, 2 × 32 bity) — nazwa pliku bez znaków z URL. */
function hash(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ code, 0x811c9dc5) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

function extension(url: string): string {
  const match = /\.(jpe?g|png|webp|gif)(?:$|[?#])/i.exec(url);
  return match ? `.${match[1]!.toLowerCase()}` : '.jpg';
}

const fileOf = (url: string) => new File(Paths.document, FOLDER, `${hash(url)}${extension(url)}`);

/** Adres do `<Image>`: plik z telefonu, a bez niego — adres z sieci (pamięć podręczna). */
export function guideImageUri(url: string): string {
  try {
    const file = fileOf(url);
    return file.exists ? file.uri : url;
  } catch {
    return url;
  }
}

/** Ile z tych zdjęć jest już plikami na telefonie. */
export function savedGuideImages(urls: string[]): number {
  return urls.filter((url) => fileOf(url).exists).length;
}

/** Pobiera brakujące; zwraca, ilu nie udało się pobrać. */
export async function saveGuideImages(urls: string[], onProgress?: (done: number, total: number) => void): Promise<number> {
  const folder = new Directory(Paths.document, FOLDER);
  if (!folder.exists) folder.create({ intermediates: true });
  const missing = [...new Set(urls)].filter((url) => !fileOf(url).exists);
  let failed = 0;
  for (const [index, url] of missing.entries()) {
    try {
      await File.downloadFileAsync(url, fileOf(url));
    } catch {
      failed++;
    }
    onProgress?.(index + 1, missing.length);
  }
  return failed;
}
