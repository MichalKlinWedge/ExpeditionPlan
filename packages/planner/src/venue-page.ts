/**
 * Strona lokalu jako tekst dla AI: bez sieci, czyste funkcje. Pobiera `apps/web/src/lib/venue-site.ts`.
 * Tu są decyzje, które da się przetestować: co jest stroną lokalu, czego nie wolno odwiedzać, co jest tekstem i gdzie jest menu.
 */

/**
 * Serwisy, a nie strony lokali: ich warunki zakazują automatycznego czytania albo treść jest cudza (docs/USLUGI.md §13).
 * Wystarczy końcówka domeny, więc wpis obejmuje też adresy krajowe i subdomeny.
 */
const NOT_OWN_SITE = /(^|\.)(booking|tripadvisor|google|goo|facebook|fb|instagram|tiktok|yelp|foursquare|thefork|lafourchette|zomato|pyszne|glovo|ubereats|wolt|bolt|airbnb|mapy|wikipedia|wikivoyage|linktr)\.[a-z.]+$/i;

/** Czy pod tym adresem można szukać danych lokalu; w przeciwnym razie powód do pokazania. */
export function venueSiteProblem(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'Adres strony jest niepoprawny.';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 'Adres strony jest niepoprawny.';
  if (NOT_OWN_SITE.test(parsed.hostname)) return `${parsed.hostname} to serwis pośredni, a takich stron nie czytamy automatycznie. Wklej tekst ręcznie.`;
  return null;
}

/** Adres z sieci publicznej. Bez tego żądanie z serwera mogłoby trafić do jego sieci wewnętrznej (SSRF). */
export function isPublicAddress(address: string): boolean {
  const ip = address.toLowerCase().replace(/^::ffff:/, '');
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (v4 !== null) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    return true;
  }
  if (!ip.includes(':')) return false;
  // Tylko globalny unicast (2000::/3), a dokumentacyjne 2001:db8:: odpada.
  return /^[23][0-9a-f]{3}:/.test(ip) && !ip.startsWith('2001:db8:');
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', euro: '€', pound: '£', oacute: 'ó', Oacute: 'Ó', ndash: '–', mdash: '—', hellip: '…' };

const decode = (text: string) =>
  text
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code) % 0x110000))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16) % 0x110000))
    .replace(/&([a-z]+);/gi, (whole, name: string) => ENTITIES[name] ?? whole);

/** Tekst strony: bez skryptów, stylów i komentarzy, z podziałem na wiersze przy blokach. Co z niego trafi do planu, wybiera człowiek w podglądzie. */
export function htmlToText(html: string): string {
  const visible = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|svg|iframe|head)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<\/?(p|div|li|ul|ol|tr|table|section|article|header|footer|main|aside|h[1-6]|br|hr|dd|dt)\b[^>]*>/gi, '\n')
    .replace(/<\/t[dh]\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ');
  return decode(visible)
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line !== '')
    .join('\n');
}

const MENU = /menu|karta|jad[łl]ospis|cennik|speisekarte|carte|carta|j[íi]deln|n[áa]pojov|l[íi]stek|cen[íi]k|food|dania/i;
const NOT_PAGE = /\.(pdf|jpe?g|png|gif|webp|svg|zip|docx?)(\?|#|$)/i;

/** Linki do menu na tej samej stronie, najlepiej dopasowane pierwsze; PDF i obrazki odpadają, bo nie ma z nich tekstu. */
export function menuLinks(html: string, base: string): string[] {
  const home = new URL(base);
  const found: { url: string; score: number }[] = [];
  for (const match of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a\s*>/gi)) {
    const href = decode(match[1]!.trim());
    const label = htmlToText(match[2]!);
    let url: URL;
    try {
      url = new URL(href, home);
    } catch {
      continue;
    }
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.hostname.replace(/^www\./, '') !== home.hostname.replace(/^www\./, '')) continue;
    if (NOT_PAGE.test(url.pathname) || url.href === home.href) continue;
    const score = (MENU.test(label) ? 2 : 0) + (MENU.test(url.pathname) ? 1 : 0);
    if (score > 0 && !found.some((each) => each.url === url.href)) found.push({ url: url.href, score });
  }
  return found.sort((a, b) => b.score - a.score).map((each) => each.url);
}

/** Czy `robots.txt` pozwala wszystkim na tę ścieżkę: grupa `User-agent: *`, najdłuższa pasująca reguła wygrywa, a `Allow` przy remisie. */
export function robotsAllows(robots: string, path: string): boolean {
  let inGroup = false;
  let lastWasAgent = false;
  const rules: { allow: boolean; prefix: string }[] = [];
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === 'user-agent') {
      inGroup = lastWasAgent ? inGroup || value === '*' : value === '*';
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (inGroup && (field === 'allow' || field === 'disallow') && value !== '') rules.push({ allow: field === 'allow', prefix: value.replace(/\*$/, '').replace(/\$$/, '') });
  }
  const matching = rules.filter((rule) => path.startsWith(rule.prefix)).sort((a, b) => b.prefix.length - a.prefix.length || Number(b.allow) - Number(a.allow));
  return matching[0]?.allow ?? true;
}
