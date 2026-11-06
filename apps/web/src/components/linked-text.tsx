import { splitLinks } from "@expeditionplan/core";

/** Tekst, w którym wklejone adresy są krótkimi linkami z nazwą strony; pełny adres w podpowiedzi. */
export function LinkedText({ text }: { text: string }) {
  return (
    <>
      {splitLinks(text).map((part, index) =>
        "url" in part ? (
          <a key={index} href={part.url} title={part.url} target="_blank" rel="noreferrer" className="underline">
            {part.label}
          </a>
        ) : (
          part.text
        ),
      )}
    </>
  );
}
