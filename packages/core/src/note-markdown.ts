/**
 * Uwagi punktu jako Markdown (mały podzbiór, ten sam na webie i telefonie): nagłówki `#`–`###`,
 * listy `- ` / `* ` / `• ` i `1. `, akapity z zachowanymi przejściami linii, w tekście **pogrubienie**,
 * *kursywa* / _kursywa_ i [opis](https://…), a także tabele jak w GitHubie (`| a | b |`, pod nagłówkiem
 * `| --- | :---: |`; `\|` to kreska w komórce). Gołe adresy zostają tekstem — aplikacje robią z nich
 * przyciski jak dotąd (`splitLinks`), a znaczniki w adresach (`_` w URL) nie są czytane jako formatowanie.
 *
 * Uwagi w planie to `item.notes: string[]`. Edytor zapisuje cały tekst jako jedną pozycję; starsze plany
 * (import, AI, fixtures) mają uwagę na pozycję — `notesMarkdown` składa je w listę, więc wyglądają jak dawniej.
 */

export type MdInline = { kind: 'text'; text: string; bold?: true; italic?: true } | { kind: 'link'; url: string; label: string };

export type MdBlock =
  | { kind: 'heading'; level: 1 | 2 | 3; inline: MdInline[] }
  /** Akapit: kolejne linie (bez łączenia w jedną) — `lines[i]` to jedna linia tekstu. */
  | { kind: 'paragraph'; lines: MdInline[][] }
  | { kind: 'list'; ordered: boolean; items: MdInline[][] }
  /** Tabela: nagłówek i wiersze (każdy uzupełniony do liczby kolumn nagłówka), wyrównanie kolumn. */
  | { kind: 'table'; header: MdInline[][]; rows: MdInline[][][]; align: MdAlign[] };

export type MdAlign = 'left' | 'center' | 'right' | null;

const BULLET = /^[-*•]\s+(.*)$/;
const ORDERED = /^\d+[.)]\s+(.*)$/;
const HEADING = /^(#{1,3})\s+(.*)$/;
const URL = /https?:\/\/[^\s<>"]+/gi;
const TABLE_RULE = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$/;

/** Komórki wiersza tabeli: bez skrajnych `|`, `\|` zostaje kreską w tekście. */
function tableCells(line: string): string[] {
  const inner = line.replace(/^\|/, '').replace(/(?<!\\)\|$/, '');
  return inner.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, '|'));
}

const isTableRow = (line: string) => line.includes('|');

function tableAlign(rule: string): MdAlign {
  const left = rule.startsWith(':');
  const right = rule.endsWith(':');
  return left && right ? 'center' : right ? 'right' : left ? 'left' : null;
}

/** Uwagi z planu jako jeden tekst Markdown: jedna pozycja — ona sama, kilka — lista (pozycja ze znacznikiem zostaje). */
export function notesMarkdown(notes: readonly string[]): string {
  const items = notes.map((note) => note.trim()).filter((note) => note !== '');
  if (items.length <= 1) return items[0] ?? '';
  return items.map((note) => (BULLET.test(note) || ORDERED.test(note) || HEADING.test(note) || note.includes('\n') ? note : `- ${note}`)).join('\n');
}

const isWordChar = (char: string | undefined) => char !== undefined && /[\p{L}\p{N}]/u.test(char);

function pushText(out: MdInline[], text: string, style: { bold?: true; italic?: true }) {
  if (text === '') return;
  const last = out.at(-1);
  if (last !== undefined && last.kind === 'text' && last.bold === style.bold && last.italic === style.italic) last.text += text;
  else out.push({ kind: 'text', text, ...style });
}

/** Formatowanie w kawałku bez adresów. */
function parseStyled(source: string, style: { bold?: true; italic?: true }, out: MdInline[]) {
  let buffer = '';
  const flush = () => {
    pushText(out, buffer, style);
    buffer = '';
  };
  let i = 0;
  while (i < source.length) {
    if (source.startsWith('**', i)) {
      const close = source.indexOf('**', i + 2);
      if (close > i + 2) {
        flush();
        parseStyled(source.slice(i + 2, close), { ...style, bold: true }, out);
        i = close + 2;
        continue;
      }
    }
    const char = source[i]!;
    if (char === '[') {
      const match = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/.exec(source.slice(i));
      if (match !== null) {
        flush();
        out.push({ kind: 'link', label: match[1]!, url: match[2]! });
        i += match[0].length;
        continue;
      }
    }
    if ((char === '*' || char === '_') && !isWordChar(source[i - 1]) && source[i + 1] !== undefined && source[i + 1] !== ' ' && source[i + 1] !== char) {
      let close = -1;
      for (let j = i + 2; j < source.length; j++) {
        if (source[j] === char && source[j - 1] !== ' ' && source[j + 1] !== char && !isWordChar(source[j + 1])) {
          close = j;
          break;
        }
      }
      if (close !== -1) {
        flush();
        parseStyled(source.slice(i + 1, close), { ...style, italic: true }, out);
        i = close + 1;
        continue;
      }
    }
    buffer += char;
    i++;
  }
  flush();
}

/** Tekst jednej linii → kawałki; adresy (też [opis](adres)) nie są przeszukiwane pod kątem `*` i `_`. */
export function parseInline(text: string): MdInline[] {
  const out: MdInline[] = [];
  let position = 0;
  for (const match of text.matchAll(URL)) {
    // Adres w nawiasie linku Markdown należy do linku — parseStyled go złoży.
    if (text[match.index - 1] === '(' && text[match.index - 2] === ']') continue;
    parseStyled(text.slice(position, match.index), {}, out);
    pushText(out, match[0], {});
    position = match.index + match[0].length;
  }
  parseStyled(text.slice(position), {}, out);
  return out;
}

export function parseMarkdown(text: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  let paragraph: MdInline[][] | null = null;
  let list: { ordered: boolean; items: MdInline[][] } | null = null;
  const close = () => {
    if (paragraph !== null) blocks.push({ kind: 'paragraph', lines: paragraph });
    if (list !== null) blocks.push({ kind: 'list', ...list });
    paragraph = null;
    list = null;
  };
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((raw) => raw.trim());
  for (let at = 0; at < lines.length; at++) {
    const line = lines[at]!;
    if (line === '') {
      close();
      continue;
    }
    // Tabela: wiersz z `|`, pod nim linia `| --- | --- |` o tej samej liczbie kolumn.
    const rule = lines[at + 1];
    if (isTableRow(line) && rule !== undefined && TABLE_RULE.test(rule)) {
      const head = tableCells(line);
      const rules = tableCells(rule);
      if (rules.length === head.length) {
        close();
        const rows: MdInline[][][] = [];
        at += 2;
        while (at < lines.length && lines[at] !== '' && isTableRow(lines[at]!)) {
          const cells = tableCells(lines[at]!);
          rows.push(head.map((_, column) => parseInline(cells[column] ?? '')));
          at++;
        }
        at--;
        blocks.push({ kind: 'table', header: head.map(parseInline), rows, align: rules.map(tableAlign) });
        continue;
      }
    }
    const heading = HEADING.exec(line);
    if (heading !== null) {
      close();
      blocks.push({ kind: 'heading', level: heading[1]!.length as 1 | 2 | 3, inline: parseInline(heading[2]!) });
      continue;
    }
    const bullet = BULLET.exec(line);
    const ordered = bullet === null ? ORDERED.exec(line) : null;
    if (bullet !== null || ordered !== null) {
      const isOrdered = ordered !== null;
      if (list === null || list.ordered !== isOrdered) {
        close();
        list = { ordered: isOrdered, items: [] };
      }
      list.items.push(parseInline((bullet ?? ordered)![1]!));
      continue;
    }
    if (list !== null) close();
    paragraph ??= [];
    paragraph.push(parseInline(line));
  }
  close();
  return blocks;
}

const plainInline = (inline: MdInline[]) => inline.map((part) => (part.kind === 'link' ? `${part.label} (${part.url})` : part.text)).join('');

/** Bez znaczników, linia po linii (kalendarz, krótkie podglądy): lista dostaje „• ”, numerowana „1. ”, wiersz tabeli komórki po „ | ”. */
export function markdownPlainLines(text: string): string[] {
  return parseMarkdown(text).flatMap((block) =>
    block.kind === 'heading'
      ? [plainInline(block.inline)]
      : block.kind === 'paragraph'
        ? block.lines.map(plainInline)
        : block.kind === 'table'
          ? [block.header, ...block.rows].map((row) => row.map(plainInline).join(' | '))
          : block.items.map((item, index) => `${block.ordered ? `${index + 1}.` : '•'} ${plainInline(item)}`),
  );
}
