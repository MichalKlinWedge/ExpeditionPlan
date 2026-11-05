import "server-only";

import { lookup } from "node:dns/promises";

import { htmlToText, isPublicAddress, menuLinks, robotsAllows, VENUE_TEXT_LIMIT, venueSiteProblem } from "@expeditionplan/planner";

/**
 * Pobranie strony lokalu na kliknięcie użytkownika: strona główna i najwyżej jedna podstrona z menu. Adres pochodzi
 * z OSM albo z tekstu, więc jest niezaufany: tylko sieć publiczna (sprawdzana także po każdym przekierowaniu), limit czasu i rozmiaru.
 * Między sprawdzeniem nazwy a połączeniem DNS może się zmienić; wbudowany `fetch` nie pozwala przypiąć adresu, a Vercel nie ma tu czego chronić poza siecią publiczną.
 */

const UA = "ExpeditionPlan/0.1 (https://github.com/MichalKlinWedge/ExpeditionPlan)";
const MAX_BYTES = 2_000_000;
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

export class VenueSiteError extends Error {}

async function assertPublicHost(url: URL) {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new VenueSiteError("Strona przekierowuje pod niepoprawny adres.");
  if (url.port !== "" && url.port !== "80" && url.port !== "443") throw new VenueSiteError("Strona używa nietypowego portu, więc jej nie pobieram.");
  const problem = venueSiteProblem(url.href);
  if (problem !== null) throw new VenueSiteError(problem);
  let addresses: { address: string }[];
  try {
    addresses = await lookup(url.hostname.replace(/^\[|\]$/g, ""), { all: true });
  } catch {
    throw new VenueSiteError(`Nie znalazłem serwera ${url.hostname}. Strona lokalu może już nie działać.`);
  }
  if (addresses.length === 0 || !addresses.every(({ address }) => isPublicAddress(address))) throw new VenueSiteError("Ten adres nie prowadzi do strony w internecie.");
}

/** Treść odpowiedzi z limitem rozmiaru, w kodowaniu z nagłówka albo znacznika `meta`. */
async function readBody(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (reader === undefined) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  await reader.cancel().catch(() => undefined);
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  const head = new TextDecoder("latin1").decode(bytes.slice(0, 2000));
  const label = /charset=["']?([\w-]+)/i.exec(response.headers.get("content-type") ?? "")?.[1] ?? /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1] ?? "utf-8";
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder().decode(bytes);
  }
}

/** Jedno pobranie z ręcznym przechodzeniem przekierowań; `null`, gdy to nie jest strona tekstowa albo serwer jej nie daje. */
async function fetchPage(start: string, accept: RegExp): Promise<{ url: string; body: string } | null> {
  let url = new URL(start);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicHost(url);
    const response = await fetch(url, { redirect: "manual", cache: "no-store", headers: { "User-Agent": UA, Accept: "text/html,text/plain;q=0.8" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get("location");
      if (next === null) return null;
      url = new URL(next, url);
      continue;
    }
    if (!response.ok || !accept.test(response.headers.get("content-type") ?? "")) return null;
    return { url: url.href, body: await readBody(response) };
  }
  throw new VenueSiteError("Strona przekierowuje zbyt wiele razy.");
}

async function allowed(url: URL): Promise<boolean> {
  const robots = await fetchPage(new URL("/robots.txt", url).href, /text\/plain/i).catch(() => null);
  return robots === null || robotsAllows(robots.body, url.pathname);
}

/** Tekst strony lokalu i jej menu, gotowy dla AI. Błąd `VenueSiteError` ma treść do pokazania. */
export async function fetchVenueSiteText(address: string): Promise<string> {
  const problem = venueSiteProblem(address);
  if (problem !== null) throw new VenueSiteError(problem);
  const start = new URL(address);
  try {
    if (!(await allowed(start))) throw new VenueSiteError("Ta strona nie pozwala na automatyczne czytanie (robots.txt). Wklej tekst ręcznie.");
    const home = await fetchPage(start.href, /text\/html|application\/xhtml|text\/plain/i);
    if (home === null) throw new VenueSiteError("Nie udało się pobrać strony lokalu. Wklej tekst ręcznie.");
    const parts = [htmlToText(home.body)];
    const menu = menuLinks(home.body, home.url)[0];
    if (menu !== undefined && (await allowed(new URL(menu)))) {
      const page = await fetchPage(menu, /text\/html|application\/xhtml/i).catch(() => null);
      if (page !== null) parts.push(htmlToText(page.body));
    }
    const text = parts.join("\n\n").slice(0, VENUE_TEXT_LIMIT);
    if (text.length < 200) throw new VenueSiteError("Na stronie prawie nie ma tekstu: menu może być w PDF-ie albo na zdjęciu. Wklej tekst ręcznie.");
    return text;
  } catch (e) {
    if (e instanceof VenueSiteError) throw e;
    throw new VenueSiteError("Nie udało się pobrać strony lokalu. Wklej tekst ręcznie.");
  }
}
