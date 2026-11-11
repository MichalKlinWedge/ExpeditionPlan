import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

import { docxHtmlToText as htmlToText } from '@expeditionplan/core';

/**
 * Tekst dokumentu planu dla modelu. Tabele zostają tabelami („a | b | c”), bo w planach niosą
 * harmonogram i porównania — rozsypane na akapity tracą to, która godzina należy do którego punktu.
 * Zamiana HTML-a z DOCX jest wspólna z importem dokumentu do briefu na webie (`core/doc-text.ts`).
 */
export { htmlToText };

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
