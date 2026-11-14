import { type MdInline, parseMarkdown } from "@expeditionplan/core";

import { LinkedText } from "@/components/linked-text";

/**
 * Uwagi punktu w Markdown (`core/note-markdown.ts`) jako HTML: nagłówki, akapity z liniami, listy,
 * tabele (przewijane w poziomie), pogrubienie, kursywa, linki zewnętrzne (podkreślone — jak każdy link poza aplikacją), a gołe adresy
 * w tekście jako przyciski `btn-web` (`LinkedText`), tak jak dotąd.
 */
export function NoteMarkdown({ text, className = "" }: { text: string; className?: string }) {
  const blocks = parseMarkdown(text);
  if (blocks.length === 0) return null;
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {blocks.map((block, index) =>
        block.kind === "heading" ? (
          <p key={index} className={`font-semibold text-ink dark:text-zinc-100 ${block.level === 1 ? "text-base" : "text-sm"}`}>
            <Inline parts={block.inline} />
          </p>
        ) : block.kind === "paragraph" ? (
          <p key={index}>
            {block.lines.map((line, at) => (
              <span key={at}>
                {at > 0 && <br />}
                <Inline parts={line} />
              </span>
            ))}
          </p>
        ) : block.kind === "table" ? (
          <div key={index} className="overflow-x-auto">
            <table className="border-collapse text-sm">
              <thead>
                <tr>
                  {block.header.map((cell, at) => (
                    <th key={at} className="border border-zinc-300 bg-zinc-100 px-2 py-1 text-left font-semibold text-ink dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100" style={{ textAlign: block.align[at] ?? undefined }}>
                      <Inline parts={cell} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, at) => (
                  <tr key={at}>
                    {row.map((cell, column) => (
                      <td key={column} className="border border-zinc-300 px-2 py-1 align-top dark:border-zinc-700" style={{ textAlign: block.align[column] ?? undefined }}>
                        <Inline parts={cell} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : block.ordered ? (
          <ol key={index} className="list-decimal pl-5">
            {block.items.map((item, at) => (
              <li key={at}>
                <Inline parts={item} />
              </li>
            ))}
          </ol>
        ) : (
          <ul key={index} className="list-disc pl-5">
            {block.items.map((item, at) => (
              <li key={at}>
                <Inline parts={item} />
              </li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}

function Inline({ parts }: { parts: MdInline[] }) {
  return (
    <>
      {parts.map((part, index) => {
        if (part.kind === "link") {
          return (
            <a key={index} href={part.url} title={part.url} target="_blank" rel="noreferrer" className="underline">
              {part.label}
            </a>
          );
        }
        const content = <LinkedText text={part.text} />;
        const italic = part.italic ? <em>{content}</em> : content;
        return part.bold ? <strong key={index}>{italic}</strong> : <span key={index}>{italic}</span>;
      })}
    </>
  );
}
