/**
 * Adresy wklejone do zwykłego tekstu (np. link do obiektu w polu „Firma / obiekt”): do pokazania jako
 * krótki link z samą nazwą strony, bo pełny adres z parametrami wyszukiwania nic nie mówi i rozpycha stronę.
 */

export type TextPart = { text: string } | { url: string; label: string };

/** Nazwa strony bez `www.`; `null`, gdy to nie jest poprawny adres http(s). */
export function linkLabel(url: string): string | null {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === 'http:' || protocol === 'https:' ? hostname.replace(/^www\./, '') : null;
  } catch {
    return null;
  }
}

/** Tekst podzielony na zwykłe kawałki i adresy; znak interpunkcyjny na końcu adresu zostaje przy tekście. */
export function splitLinks(text: string): TextPart[] {
  const parts: TextPart[] = [];
  const pushText = (value: string) => {
    const last = parts.at(-1);
    if (value === '') return;
    if (last !== undefined && 'text' in last) last.text += value;
    else parts.push({ text: value });
  };
  let position = 0;
  for (const match of text.matchAll(/https?:\/\/[^\s<>"]+/gi)) {
    const url = match[0].replace(/[.,;:!?)\]]+$/, '');
    const label = linkLabel(url);
    if (label === null) continue;
    pushText(text.slice(position, match.index));
    parts.push({ url, label });
    position = match.index + url.length;
  }
  pushText(text.slice(position));
  return parts;
}
