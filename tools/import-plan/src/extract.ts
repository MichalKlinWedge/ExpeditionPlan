import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

/**
 * Tekst dokumentu planu dla modelu. Tabele zostają tabelami („a | b | c”), bo w planach niosą
 * harmonogram i porównania — rozsypane na akapity tracą to, która godzina należy do którego punktu.
 */

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
};

/** HTML z mammotha → tekst z zachowanymi nagłówkami, listami i wierszami tabel. */
export function htmlToText(html: string): string {
  return html
    // Komórka tabeli w DOCX to zwykle kilka akapitów — w środku wiersza nie może być nowej linii.
    .replace(/<t([dh])([^>]*)>([\s\S]*?)<\/t\1>/g, (_m, tag: string, attrs: string, inner: string) =>
      `<t${tag}${attrs}>${inner.replace(/<\/p>\s*<p[^>]*>/g, ' / ').replace(/<\/?p[^>]*>/g, '')}</t${tag}>`,
    )
    .replace(/<h([1-6])[^>]*>/g, (_m, level: string) => `\n${'#'.repeat(Number(level))} `)
    .replace(/<\/h[1-6]>/g, '\n')
    .replace(/<li[^>]*>/g, '\n- ')
    .replace(/<\/(p|li|ul|ol)>/g, '\n')
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<table[^>]*>/g, '\n')
    .replace(/<\/td>|<\/th>/g, ' | ')
    .replace(/<\/tr>/g, '\n')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/g, (_m, href: string, label: string) =>
      label.includes(href) ? label : `${label} (${href})`,
    )
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z]+;|&#\d+;/g, (entity) => ENTITIES[entity] ?? entity)
    .replace(/ \| \n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function extractText(path: string): Promise<string> {
  const extension = extname(path).toLowerCase();
  const data = await readFile(path);

  if (extension === '.docx') {
    const mammoth = await import('mammoth');
    const { value } = await mammoth.convertToHtml({ buffer: data });
    return htmlToText(value);
  }

  if (extension === '.pdf') {
    const { extractText: extractPdf, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(data));
    const { text } = await extractPdf(pdf, { mergePages: false });
    return text.map((page, index) => `--- strona ${index + 1} ---\n${page}`).join('\n\n');
  }

  if (extension === '.txt' || extension === '.md') return data.toString('utf8');

  throw new Error(`Nieobsługiwany format „${extension}”. Obsługiwane: .docx, .pdf, .txt, .md.`);
}
