/**
 * Wklejony tekst z formatowaniem (Google Docs, Word, strona WWW, mail) → Markdown uwag punktu
 * (`core/note-markdown.ts`): nagłówki, akapity, listy, pogrubienie, kursywa i linki http(s). Reszta
 * (tabele, kolory, obrazy) zostaje samym tekstem. Tylko w przeglądarce (`DOMParser`); skrypty ze
 * schowka się nie wykonują — dokument jest tylko czytany.
 *
 * Google Docs owija cały wklejony fragment w `<b style="font-weight:normal">`, a pogrubienie i kursywę
 * daje stylem `<span>` — dlatego liczy się styl, a nie sama nazwa znacznika.
 */

type Style = { bold: boolean; italic: boolean };

const BLOCK = new Set(["P", "DIV", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "UL", "OL", "TR", "BLOCKQUOTE", "SECTION", "ARTICLE", "HEADER", "FOOTER", "TABLE"]);
const BLOCK_SELECTOR = [...BLOCK].map((tag) => tag.toLowerCase()).join(",");

/** Blok albo element, który ma bloki w środku (np. `<b>` Google Docs wokół akapitów). */
const isBlockish = (node: Node): node is HTMLElement => node instanceof HTMLElement && (BLOCK.has(node.tagName) || node.querySelector(BLOCK_SELECTOR) !== null);

function styleOf(element: HTMLElement, inherited: Style): Style {
  const tag = element.tagName;
  const weight = element.style.fontWeight;
  const normalWeight = weight === "normal" || weight === "400" || (weight !== "" && Number(weight) < 600);
  const heavyWeight = weight === "bold" || weight === "bolder" || Number(weight) >= 600;
  let bold = inherited.bold;
  if (tag === "B" || tag === "STRONG") bold = !normalWeight;
  if (heavyWeight) bold = true;
  else if (normalWeight && tag !== "B" && tag !== "STRONG") bold = false;
  let italic = inherited.italic;
  if (tag === "I" || tag === "EM") italic = element.style.fontStyle !== "normal";
  if (element.style.fontStyle === "italic") italic = true;
  else if (element.style.fontStyle === "normal") italic = false;
  return { bold, italic };
}

/** Znaczniki wokół kawałka tekstu; spacje na brzegach zostają poza znacznikami (`** a**` nie działa). */
function wrap(text: string, style: Style): string {
  if (text.trim() === "" || (!style.bold && !style.italic)) return text;
  const lead = text.match(/^\s*/)![0];
  const tail = text.match(/\s*$/)![0];
  const core = text.trim();
  // Pogrubiona kursywa jako `**_…_**` — tak czyta ją `parseInline` (bez `***`).
  const marked = style.bold && style.italic ? `**_${core}_**` : style.bold ? `**${core}**` : `*${core}*`;
  return `${lead}${marked}${tail}`;
}

function inline(node: Node, style: Style): string {
  if (node.nodeType === Node.TEXT_NODE) return wrap((node.textContent ?? "").replace(/\s+/g, " "), style);
  if (!(node instanceof HTMLElement)) return "";
  if (node.tagName === "BR") return "\n";
  if (node.tagName === "SCRIPT" || node.tagName === "STYLE") return "";
  const own = styleOf(node, style);
  if (node.tagName === "A") {
    const href = node.getAttribute("href") ?? "";
    const label = (node.textContent ?? "").replace(/\s+/g, " ").trim();
    if (/^https?:\/\//i.test(href) && label !== "") return label === href ? href : wrap(`[${label.replace(/[[\]]/g, "")}](${href})`, own);
  }
  return [...node.childNodes].map((child) => inline(child, own)).join("");
}

/** Bloki dokumentu → linie Markdown (puste linie między akapitami). */
function blocks(node: Node, style: Style, out: string[], list?: { ordered: boolean; index: number }) {
  if (!(node instanceof HTMLElement)) {
    const text = inline(node, style).trim();
    if (text !== "") out.push(text);
    return;
  }
  const tag = node.tagName;
  const own = styleOf(node, style);
  if (tag === "UL" || tag === "OL") {
    const state = { ordered: tag === "OL", index: 0 };
    for (const child of node.children) blocks(child, own, out, state);
    out.push("");
    return;
  }
  if (tag === "LI") {
    const index = list === undefined ? 0 : ++list.index;
    const text = [...node.childNodes].filter((child) => !(child instanceof HTMLElement && (child.tagName === "UL" || child.tagName === "OL"))).map((child) => inline(child, own)).join("").replace(/\s*\n\s*/g, " ").trim();
    if (text !== "") out.push(`${list?.ordered ? `${index}.` : "-"} ${text}`);
    for (const child of node.children) if (child.tagName === "UL" || child.tagName === "OL") blocks(child, own, out);
    return;
  }
  const heading = /^H([1-6])$/.exec(tag);
  if (heading !== null) {
    const text = inline(node, { ...own, bold: false }).replace(/\s+/g, " ").trim();
    if (text !== "") out.push(`${"#".repeat(Math.min(Number(heading[1]), 3))} ${text}`, "");
    return;
  }
  // Blok z blokami w środku — schodzimy niżej; bez nich to akapit (linie z <br> zostają liniami).
  if (node.querySelector(BLOCK_SELECTOR) !== null) {
    let run: Node[] = [];
    const flushRun = () => {
      const text = run.map((child) => inline(child, own)).join("").split("\n").map((line) => line.trim()).join("\n").trim();
      if (text !== "") out.push(text, "");
      run = [];
    };
    for (const child of node.childNodes) {
      if (isBlockish(child)) {
        flushRun();
        blocks(child, own, out, list);
      } else run.push(child);
    }
    flushRun();
    return;
  }
  const text = inline(node, own).split("\n").map((line) => line.trim()).join("\n").trim();
  if (text !== "") out.push(text, "");
}

export function htmlToMarkdown(html: string): string {
  const body = new DOMParser().parseFromString(html, "text/html").body;
  const out: string[] = [];
  blocks(body, { bold: false, italic: false }, out);
  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
