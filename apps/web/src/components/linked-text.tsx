import { splitLinks } from "@expeditionplan/core";

import { GlobeIcon } from "@/components/icons";

/** Tekst, w którym wklejone adresy są przyciskami `btn-web` z nazwą strony; pełny adres w podpowiedzi. */
export function LinkedText({ text }: { text: string }) {
  return (
    <>
      {splitLinks(text).map((part, index) =>
        "url" in part ? (
          <a key={index} href={part.url} title={part.url} target="_blank" rel="noreferrer" className="btn-web">
            <GlobeIcon className="size-3.5" />
            {part.label}
          </a>
        ) : (
          part.text
        ),
      )}
    </>
  );
}
