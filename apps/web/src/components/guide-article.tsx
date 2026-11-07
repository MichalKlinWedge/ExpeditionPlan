import { GUIDE_SITE, type GuideContent, type GuideImage, type GuideLinkTarget, type GuideSegment, linkGuideText } from "@expeditionplan/core";
import Link from "next/link";

import { GuideListen } from "@/components/guide-listen";

/**
 * Treść przewodnika po miejscu: opis, zdjęcia z Commons, ciekawostki, historia, wskazówki i atrybucja.
 * Karta punktu w planie i publiczny link. `itemBase` to adres karty bez klucza punktu; nazwy innych
 * opisanych miejsc w tekście prowadzą do ich kart (raz na miejsce w całym opisie).
 * „Posłuchaj” czyta opis głosem przeglądarki (`GuideListen`); `title` jest czytany na początku.
 */
export function GuideArticle({ guide, targets, itemBase, title }: { guide: GuideContent; targets: GuideLinkTarget[]; itemBase: string; title?: string }) {
  const used = new Set<string>();
  const linked = (text: string) => <Linked itemBase={itemBase} segments={linkGuideText(text, targets, used)} />;
  return (
    <article className="card flex flex-col gap-3 p-4 text-sm">
      <div className="flex items-start gap-3">
        <p className="flex-1 text-base">{linked(guide.summary)}</p>
        <GuideListen guide={guide} {...(title ? { title } : {})} />
      </div>
      {guide.images.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {guide.images.map((image) => (
            <GuideFigure key={image.url} image={image} />
          ))}
        </div>
      )}
      {guide.facts.length > 0 && (
        <div>
          <h3 className="font-semibold">Ciekawostki</h3>
          <ul className="ml-5 list-disc">
            {guide.facts.map((fact) => (
              <li key={fact}>{linked(fact)}</li>
            ))}
          </ul>
        </div>
      )}
      {guide.history && (
        <div>
          <h3 className="font-semibold">Historia</h3>
          <p>{linked(guide.history)}</p>
        </div>
      )}
      {guide.tips.length > 0 && (
        <div>
          <h3 className="font-semibold">Na miejscu</h3>
          <ul className="ml-5 list-disc">
            {guide.tips.map((tip) => (
              <li key={tip}>{linked(tip)}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-xs text-zinc-500">
        Na podstawie {guide.article.site === "web" ? "strony" : "artykułu"}{" "}
        <a href={guide.article.url} target="_blank" rel="noreferrer" className="underline">
          „{guide.article.title}”
        </a>
        {guide.article.site !== "web" && (
          <>
            {" "}
            z {GUIDE_SITE[guide.article.site]} ({guide.article.lang}), licencja{" "}
            <a href="https://creativecommons.org/licenses/by-sa/4.0/deed.pl" target="_blank" rel="noreferrer" className="underline">
              CC BY-SA 4.0
            </a>
          </>
        )}
        ; streszczenie: AI{guide.edited ? ", poprawione ręcznie" : ""}.
      </p>
    </article>
  );
}

/** Zdjęcie z Commons z autorem i licencją: wymaga ich licencja, więc nie ma go bez podpisu. */
export function GuideFigure({ image }: { image: GuideImage }) {
  return (
    <figure className="flex flex-col gap-1">
      <a href={image.sourceUrl} target="_blank" rel="noreferrer">
        {/* Zdjęcia z Commons (upload.wikimedia.org) — zwykły <img>, miniatura 960 px. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image.thumbUrl} alt={image.title} loading="lazy" className="aspect-[4/3] w-full rounded-lg object-cover" />
      </a>
      <figcaption className="text-[11px] leading-tight text-zinc-500">
        {image.author ? `${image.author}, ` : ""}
        {image.licenseUrl ? (
          <a href={image.licenseUrl} target="_blank" rel="noreferrer" className="underline">
            {image.license}
          </a>
        ) : (
          image.license
        )}
        , Wikimedia Commons
      </figcaption>
    </figure>
  );
}

function Linked({ itemBase, segments }: { itemBase: string; segments: GuideSegment[] }) {
  return segments.map((segment, i) =>
    segment.ref ? (
      <Link key={i} href={`${itemBase}${encodeURIComponent(segment.ref)}`} className="font-medium text-sea underline decoration-sea/40 underline-offset-2 hover:decoration-sea">
        {segment.text}
      </Link>
    ) : (
      <span key={i}>{segment.text}</span>
    ),
  );
}
