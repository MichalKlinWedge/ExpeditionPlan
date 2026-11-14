"use client";

import { type ClipboardEvent, useRef, useState } from "react";

import { NoteMarkdown } from "@/components/note-markdown";
import { htmlToMarkdown } from "@/lib/html-markdown";

/**
 * Pole tekstu z formatowaniem (uwagi punktu): zwykłe pole, w którym tekst zapisuje się jako Markdown
 * (`core/note-markdown.ts`). Pasek: pogrubienie, kursywa, nagłówek, lista, lista numerowana, link —
 * wstawiają znaczniki wokół zaznaczenia. Wklejony tekst z formatowaniem (Google Docs, Word, strona,
 * mail) zamienia się na Markdown (`htmlToMarkdown`), więc pogrubienia, listy i linki zostają. „Podgląd”
 * pokazuje wynik tak, jak na karcie punktu i w telefonie.
 */
export function MarkdownField({ value, onChange, rows = 6, placeholder, label }: { value: string; onChange: (value: string) => void; rows?: number; placeholder?: string; label: string }) {
  const area = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState(false);

  /** Zamienia zaznaczenie (start–end) na tekst i ustawia kursor / zaznaczenie po zmianie. */
  const replace = (start: number, end: number, text: string, select?: [number, number]) => {
    const next = value.slice(0, start) + text + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      const element = area.current;
      if (element === null) return;
      element.focus();
      const [from, to] = select ?? [start + text.length, start + text.length];
      element.setSelectionRange(from, to);
    });
  };

  const surround = (mark: string, sample: string) => {
    const element = area.current;
    if (element === null) return;
    const { selectionStart: start, selectionEnd: end } = element;
    const chosen = value.slice(start, end) || sample;
    replace(start, end, `${mark}${chosen}${mark}`, [start + mark.length, start + mark.length + chosen.length]);
  };

  /** Znacznik na początku każdej zaznaczonej linii (lista, nagłówek); drugi raz zdejmuje go. */
  const prefixLines = (prefix: (index: number) => string, pattern: RegExp) => {
    const element = area.current;
    if (element === null) return;
    const start = value.lastIndexOf("\n", element.selectionStart - 1) + 1;
    const lineEnd = value.indexOf("\n", element.selectionEnd);
    const end = lineEnd === -1 ? value.length : lineEnd;
    const lines = value.slice(start, end).split("\n");
    const all = lines.every((line) => pattern.test(line));
    const next = lines.map((line, index) => (all ? line.replace(pattern, "") : `${prefix(index)}${line.replace(/^(\s*([-*•]|\d+[.)]|#{1,3})\s+)/, "")}`)).join("\n");
    replace(start, end, next, [start, start + next.length]);
  };

  /** Link: zaznaczenie zostaje opisem, a zaznaczone „https://” czeka na wklejenie adresu. */
  const link = () => {
    const element = area.current;
    if (element === null) return;
    const { selectionStart: start, selectionEnd: end } = element;
    const label = value.slice(start, end) || "opis";
    const at = start + label.length + 3;
    replace(start, end, `[${label}](https://)`, [at, at + "https://".length]);
  };

  const paste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const html = event.clipboardData.getData("text/html");
    if (html === "") return;
    const markdown = htmlToMarkdown(html);
    if (markdown === "") return;
    event.preventDefault();
    const element = event.currentTarget;
    replace(element.selectionStart, element.selectionEnd, markdown);
  };

  const tool = "btn-mini min-w-8 justify-center";
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-1 text-xs text-zinc-500">{label}</span>
        <button type="button" aria-pressed={!preview} onClick={() => setPreview(false)} className="toggle-chip">
          Pisz
        </button>
        <button type="button" aria-pressed={preview} onClick={() => setPreview(true)} className="toggle-chip">
          Podgląd
        </button>
        {!preview && (
          <span className="ml-auto flex flex-wrap gap-1" role="toolbar" aria-label="Formatowanie">
            <button type="button" onClick={() => surround("**", "pogrubienie")} className={`${tool} font-bold`} title="Pogrubienie (**tekst**)">
              B
            </button>
            <button type="button" onClick={() => surround("*", "kursywa")} className={`${tool} italic`} title="Kursywa (*tekst*)">
              I
            </button>
            <button type="button" onClick={() => prefixLines(() => "## ", /^##\s+/)} className={tool} title="Nagłówek (## tekst)">
              H
            </button>
            <button type="button" onClick={() => prefixLines(() => "- ", /^[-*•]\s+/)} className={tool} title="Lista (- tekst)">
              • lista
            </button>
            <button type="button" onClick={() => prefixLines((index) => `${index + 1}. `, /^\d+[.)]\s+/)} className={tool} title="Lista numerowana (1. tekst)">
              1. lista
            </button>
            <button type="button" onClick={link} className={tool} title="Link ([opis](https://…))">
              link
            </button>
          </span>
        )}
      </div>
      {preview ? (
        <div className="field min-h-24 px-2 py-1 text-sm text-zinc-700 dark:text-zinc-300">
          {value.trim() === "" ? <span className="text-zinc-400">Nic do pokazania.</span> : <NoteMarkdown text={value} />}
        </div>
      ) : (
        <textarea
          ref={area}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onPaste={paste}
          rows={rows}
          placeholder={placeholder}
          aria-label={label}
          className="field px-2 py-1 font-mono text-sm text-ink dark:text-zinc-100"
        />
      )}
    </div>
  );
}
