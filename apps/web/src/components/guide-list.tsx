"use client";

import { GUIDE_PHOTO_BUCKET, type GuideImage, guidePhotoPath, MAX_GUIDE_IMAGES, type TripGuide } from "@expeditionplan/core";
import { dbErrorMessage, uuidv7 } from "@expeditionplan/sync";
import Link from "next/link";
import { type FormEvent, useEffect, useState, useTransition } from "react";

import type { FormState } from "@/app/actions";
import { addOwnGuideImage, dropGuideImage, findGuideImages, pickGuideImage, removeGuide, reorderGuideImage, saveGuideText } from "@/app/guide-actions";
import { GuideArticle, GuideFigure } from "@/components/guide-article";
import { GuideButtons, PlaceGuideButtons } from "@/components/guide-button";
import { IconAction } from "@/components/icon-action";
import { createClient } from "@/lib/supabase/client";

/** Lista opisów na stronie „Opisy miejsc”: skrót, a po rozwinięciu cały opis, nowa wersja z AI, ręczna poprawka tekstu i zdjęć oraz usunięcie. */

const REGENERATE = "Przygotować nowy opis? Obecny zostanie zastąpiony.";
const REGENERATE_EDITED = "Przygotować nowy opis? Obecny, razem z ręcznymi poprawkami, zostanie zastąpiony.";

export function GuideList({ tripId, guides, missing, canEdit, openId }: { tripId: string; guides: TripGuide[]; missing: { ref: string; title: string }[]; canEdit: boolean; openId?: string }) {
  return (
    <div className="flex flex-col gap-6">
      {guides.length === 0 ? (
        <p className="text-sm text-zinc-500">Ten wyjazd nie ma jeszcze opisów.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {guides.map((guide) => (
            <GuideRowCard key={guide.rowId} tripId={tripId} guide={guide} canEdit={canEdit} startOpen={guide.rowId === openId} />
          ))}
        </ul>
      )}
      {missing.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">Atrakcje bez opisu ({missing.length})</h2>
          <ul className="flex flex-col gap-2">
            {missing.map((item) => (
              <MissingRow key={item.ref} tripId={tripId} item={item} canEdit={canEdit} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function GuideRowCard({ tripId, guide, canEdit, startOpen }: { tripId: string; guide: TripGuide; canEdit: boolean; startOpen: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const [editing, setEditing] = useState<"text" | "images" | null>(null);
  const { content } = guide;
  const confirm = content.edited || content.imagesEdited ? REGENERATE_EDITED : REGENERATE;
  return (
    <li id={`opis-${guide.rowId}`} className={`card flex scroll-mt-4 flex-col gap-2 p-3 text-sm ${startOpen ? "ring-2 ring-sea" : ""}`}>
      <div className="card-title flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="text-left font-semibold hover:text-sea">
          {guide.title}
        </button>
        {content.edited && <span className="rounded bg-sea-light px-1.5 text-xs text-sea">poprawiony ręcznie</span>}
        {content.imagesEdited && <span className="rounded bg-sea-light px-1.5 text-xs text-sea">zmienione zdjęcia</span>}
        <button type="button" onClick={() => setOpen(!open)} className="btn-mini ml-auto">
          {open ? "zwiń" : "pokaż"}
        </button>
      </div>
      {!open && <p className="line-clamp-2 text-zinc-600 dark:text-zinc-400">{content.summary}</p>}
      <p className="text-xs text-zinc-500">
        Źródło:{" "}
        <a href={content.article.url} target="_blank" rel="noreferrer" className="underline">
          {content.article.title}
        </a>
        {guide.usedBy.length > 0 && (
          <>
            {" · "}
            {guide.usedBy.slice(0, 4).map((item, index) => (
              <span key={item.ref}>
                {index > 0 && " "}
                <Link href={`/trips/${tripId}/item/${encodeURIComponent(item.ref)}`} className="btn-mini">
                  {item.title}
                </Link>
              </span>
            ))}
            {guide.usedBy.length > 4 ? ` i ${guide.usedBy.length - 4} więcej` : ""}
          </>
        )}
      </p>
      {open && editing === null && <GuideArticle guide={content} title={guide.title} targets={[]} itemBase={`/trips/${tripId}/item/`} />}
      {open && editing === "text" && <GuideTextForm tripId={tripId} guide={guide} onClose={() => setEditing(null)} />}
      {open && editing === "images" && <GuideImagesForm tripId={tripId} guide={guide} onClose={() => setEditing(null)} />}
      {open && canEdit && editing === null && (
        <div className="flex flex-col gap-2 border-t border-zinc-200 pt-2 dark:border-zinc-800">
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setEditing("text")} className="btn-secondary btn-sm">
              Popraw tekst
            </button>
            <button type="button" onClick={() => setEditing("images")} className="btn-secondary btn-sm">
              Zmień zdjęcia
            </button>
          </div>
          {guide.placeRef !== undefined ? (
            <PlaceGuideButtons tripId={tripId} placeRef={guide.placeRef} guideId={guide.rowId} label="Przygotuj od nowa (AI)" which={content.hint} confirmRegenerate={confirm} />
          ) : guide.itemRef !== undefined ? (
            <GuideButtons tripId={tripId} itemRef={guide.itemRef} guideId={guide.rowId} hint={content.hint} label="Przygotuj od nowa (AI)" confirmRegenerate={confirm} />
          ) : (
            <OrphanGuide tripId={tripId} guideId={guide.rowId} />
          )}
        </div>
      )}
    </li>
  );
}

/** Punkt albo miejsce opisu już nie istnieje: nowej wersji nie ma z czego zrobić, można go tylko usunąć. */
function OrphanGuide({ tripId, guideId }: { tripId: string; guideId: string }) {
  const [state, setState] = useState<FormState>({});
  const [pending, start] = useTransition();
  return (
    <p className="flex flex-wrap items-baseline gap-2 text-xs text-zinc-500">
      Tego punktu ani miejsca już nie ma w planie.
      <IconAction kind="remove" tip="Usuń opis" disabled={pending} onClick={() => window.confirm("Usunąć ten opis?") && start(async () => setState(await removeGuide(tripId, guideId)))} />
      {state.error && <span className="text-red-600">{state.error}</span>}
    </p>
  );
}

function MissingRow({ tripId, item, canEdit }: { tripId: string; item: { ref: string; title: string }; canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="card flex flex-col gap-2 p-3 text-sm">
      <div className="card-title flex flex-wrap items-baseline gap-x-2">
        <Link href={`/trips/${tripId}/item/${encodeURIComponent(item.ref)}`} className="btn-mini">
          {item.title}
        </Link>
        {canEdit && (
          <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="btn-mini ml-auto">
            {open ? "zwiń" : "przygotuj"}
          </button>
        )}
      </div>
      {open && <GuideButtons tripId={tripId} itemRef={item.ref} guideId={null} />}
    </li>
  );
}

/** Zdjęcia opisu: każde można przesunąć, usunąć albo wymienić na inne z Wikimedia lub własne, a poniżej limitu dodać kolejne. */
function GuideImagesForm({ tripId, guide, onClose }: { tripId: string; guide: TripGuide; onClose: () => void }) {
  const { images } = guide.content;
  /** Otwarty wybór: `replace` to zdjęcie do wymiany, bez niego wybór dodaje kolejne. */
  const [picking, setPicking] = useState<{ replace?: string } | null>(null);
  const [state, setState] = useState<FormState>({});
  const [pending, start] = useTransition();
  const remove = (url: string) =>
    start(async () => {
      setState(await dropGuideImage(tripId, guide.rowId, url));
      setPicking(null);
    });
  const move = (url: string, by: -1 | 1 | "first") => start(async () => setState(await reorderGuideImage(tripId, guide.rowId, url, by)));
  const pick = (image: GuideImage) =>
    start(async () => {
      const result = await pickGuideImage(tripId, guide.rowId, image, picking?.replace);
      setState(result);
      if (result.ok) setPicking(null);
    });
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-zinc-500">Pierwsze zdjęcie pokazuje się w „Opisie wyprawy”, a punkt bez zdjęcia tam nie trafia. Zmiana dotyczy tylko tego wyjazdu.</p>
      {images.length === 0 ? (
        <p className="text-xs text-zinc-500">Ten opis nie ma zdjęć.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {images.map((image, at) => (
            <li key={image.url} className={`flex flex-col gap-1 rounded-lg ${picking?.replace === image.url ? "ring-2 ring-sea" : ""}`}>
              <GuideFigure image={image} />
              {images.length > 1 && (
                <div className="flex flex-wrap items-center gap-1 text-xs">
                  <span className="text-zinc-500">{at + 1}.</span>
                  <button type="button" disabled={pending || at === 0} onClick={() => move(image.url, -1)} className="btn-mini" aria-label="Przesuń wcześniej" title="Wcześniej">
                    ←
                  </button>
                  <button type="button" disabled={pending || at === images.length - 1} onClick={() => move(image.url, 1)} className="btn-mini" aria-label="Przesuń później" title="Później">
                    →
                  </button>
                  {at > 0 && (
                    <button type="button" disabled={pending} onClick={() => move(image.url, "first")} className="btn-mini" title="Pierwsze zdjęcie pokazuje się w „Opisie wyprawy”">
                      na początek
                    </button>
                  )}
                </div>
              )}
              <div className="flex gap-3 text-xs">
                <button type="button" disabled={pending} onClick={() => setPicking({ replace: image.url })} className="btn-mini">
                  wymień
                </button>
                <IconAction kind="remove" disabled={pending} onClick={() => remove(image.url)} />
              </div>
            </li>
          ))}
        </ul>
      )}
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
      {picking !== null && <OwnPhotoUpload tripId={tripId} guideId={guide.rowId} title={guide.title} replaceUrl={picking.replace} onDone={() => setPicking(null)} onState={setState} />}
      {picking !== null ? (
        <ImagePicker tripId={tripId} guideId={guide.rowId} title={picking.replace ? "Wybierz zdjęcie na wymianę" : "Wybierz kolejne zdjęcie"} used={images.map((image) => image.url)} saving={pending} onPick={pick} onCancel={() => setPicking(null)} />
      ) : (
        <div className="flex items-center gap-3">
          {images.length < MAX_GUIDE_IMAGES && (
            <button type="button" disabled={pending} onClick={() => setPicking({})} className="btn-secondary btn-sm">
              Dodaj zdjęcie
            </button>
          )}
          <button type="button" disabled={pending} onClick={onClose} className="btn-mini">
            gotowe
          </button>
        </div>
      )}
    </div>
  );
}

/** Najdłuższy bok wgrywanego zdjęcia: wystarcza na pełny ekran pokazu, a plik ma kilkaset kB. */
const OWN_PHOTO_PX = 1920;

/** Zdjęcie z dysku → JPEG najwyżej `OWN_PHOTO_PX` (bez EXIF, więc bez położenia z aparatu). */
async function ownPhotoJpeg(file: File): Promise<Blob | string> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, OWN_PHOTO_PX / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    return blob ?? "Nie udało się przygotować zdjęcia.";
  } catch {
    return "Nie da się odczytać tego pliku jako zdjęcia (JPG, PNG albo WebP).";
  }
}

/** Własne zdjęcie z dysku: plik idzie z przeglądarki do publicznego `guide_photos`, potem do opisu. */
function OwnPhotoUpload({ tripId, guideId, title, replaceUrl, onDone, onState }: { tripId: string; guideId: string; title: string; replaceUrl?: string; onDone: () => void; onState: (state: FormState) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState(title);
  const [author, setAuthor] = useState("");
  const [pending, start] = useTransition();
  const upload = (event: FormEvent) => {
    event.preventDefault();
    if (file === null) return;
    start(async () => {
      const jpeg = await ownPhotoJpeg(file);
      if (typeof jpeg === "string") return onState({ error: jpeg });
      const id = uuidv7();
      const sent = await createClient().storage.from(GUIDE_PHOTO_BUCKET).upload(guidePhotoPath(tripId, id), jpeg, { contentType: "image/jpeg", upsert: false });
      if (sent.error) return onState({ error: dbErrorMessage(sent.error, "Nie wgrano zdjęcia. Spróbuj jeszcze raz.") });
      const result = await addOwnGuideImage(tripId, guideId, id, { title: caption, author }, replaceUrl);
      onState(result);
      if (result.ok) onDone();
    });
  };
  return (
    <form onSubmit={upload} className="flex flex-col gap-2 border-t border-zinc-200 pt-2 dark:border-zinc-800">
      <h3 className="text-xs font-semibold">{replaceUrl ? "Wymień na własne zdjęcie" : "Własne zdjęcie z dysku"}</h3>
      <div className="flex flex-wrap items-center gap-2">
        <input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" disabled={pending} onChange={(event) => setFile(event.target.files?.[0] ?? null)} aria-label="Plik zdjęcia" className="text-xs" />
        <input value={caption} onChange={(event) => setCaption(event.target.value)} disabled={pending} placeholder="Opis zdjęcia" aria-label="Opis zdjęcia" className="field min-w-40 flex-1 p-2 text-sm" />
        <input value={author} onChange={(event) => setAuthor(event.target.value)} disabled={pending} placeholder="Autor (domyślnie Ty)" aria-label="Autor zdjęcia" className="field w-44 p-2 text-sm" />
        <button disabled={pending || file === null} className="btn-secondary btn-sm">
          {pending ? "Wgrywam…" : "Wgraj"}
        </button>
      </div>
      <p className="text-xs text-zinc-500">Zdjęcie zmniejszamy do {OWN_PHOTO_PX} px i bez danych z aparatu (także położenia). Będzie widać je wszędzie, gdzie ten opis: w planie, w telefonie, w pokazie i pod publicznym linkiem wyjazdu. Wgrywaj tylko zdjęcia, do których masz prawa.</p>
    </form>
  );
}

/** Zdjęcia z artykułu opisu i z Commons, a własne hasło szuka w Commons. */
function ImagePicker({ tripId, guideId, title, used, saving, onPick, onCancel }: { tripId: string; guideId: string; title: string; used: string[]; saving: boolean; onPick: (image: GuideImage) => void; onCancel: () => void }) {
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Awaited<ReturnType<typeof findGuideImages>> | null>(null);
  const [loading, start] = useTransition();
  useEffect(() => {
    start(async () => setFound(await findGuideImages(tripId, guideId)));
  }, [tripId, guideId]);
  const search = (event: FormEvent) => {
    event.preventDefault();
    start(async () => setFound(await findGuideImages(tripId, guideId, query)));
  };
  const images = found !== null && "images" in found ? found.images.filter((image) => !used.includes(image.url)) : [];
  return (
    <section className="flex flex-col gap-2 border-t border-zinc-200 pt-2 dark:border-zinc-800">
      <h3 className="text-xs font-semibold">{title}</h3>
      <form onSubmit={search} className="flex flex-wrap items-center gap-2">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Szukaj w Wikimedia Commons, np. nazwa po angielsku" aria-label="Szukaj zdjęcia w Wikimedia Commons" className="field min-w-48 flex-1 p-2 text-sm" />
        <button disabled={loading || query.trim() === ""} className="btn-secondary btn-sm">
          Szukaj
        </button>
        <button type="button" onClick={onCancel} className="btn-mini">
          anuluj
        </button>
      </form>
      {loading && <p className="text-xs text-zinc-500">Szukam zdjęć…</p>}
      {!loading && found !== null && "error" in found && <p className="text-xs text-red-600">{found.error}</p>}
      {!loading && found !== null && "images" in found && images.length === 0 && <p className="text-xs text-zinc-500">Nie ma innych zdjęć. Spróbuj innego hasła.</p>}
      {!loading && images.length > 0 && (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {images.map((image) => (
            <li key={image.url} className="flex flex-col gap-1">
              <button type="button" disabled={saving} onClick={() => onPick(image)} title={`Wybierz: ${image.title}`} className="rounded-lg hover:ring-2 hover:ring-sea disabled:opacity-50">
                {/* Zdjęcia z Commons (upload.wikimedia.org) — zwykły <img>, jak w opisie. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image.thumbUrl} alt={image.title} loading="lazy" className="aspect-[4/3] w-full rounded-lg object-cover" />
              </button>
              <a href={image.sourceUrl} target="_blank" rel="noreferrer" className="text-[11px] leading-tight text-zinc-500 underline">
                {image.author ? `${image.author}, ` : ""}
                {image.license}
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const lines = (text: string) => [...new Set(text.split("\n").map((line) => line.trim()).filter((line) => line !== ""))];

const MAX_FACTS = 8;
const MAX_TIPS = 4;

function GuideTextForm({ tripId, guide, onClose }: { tripId: string; guide: TripGuide; onClose: () => void }) {
  const { content } = guide;
  const [summary, setSummary] = useState(content.summary);
  const [facts, setFacts] = useState(content.facts.join("\n"));
  const [history, setHistory] = useState(content.history ?? "");
  const [tips, setTips] = useState(content.tips.join("\n"));
  const [state, setState] = useState<FormState>({});
  const [pending, start] = useTransition();
  const factList = lines(facts);
  const tipList = lines(tips);
  const tooMany = factList.length > MAX_FACTS ? `Najwyżej ${MAX_FACTS} ciekawostek (jest ${factList.length}).` : tipList.length > MAX_TIPS ? `Najwyżej ${MAX_TIPS} wskazówki (jest ${tipList.length}).` : null;
  const field = "field w-full p-2 text-sm";
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        start(async () => {
          const result = await saveGuideText(tripId, guide.rowId, { summary: summary.trim(), facts: factList, tips: tipList, ...(history.trim() ? { history: history.trim() } : {}) });
          setState(result);
          if (result.ok) onClose();
        });
      }}>
      <label className="flex flex-col gap-1 text-xs text-zinc-500">
        Opis
        <textarea value={summary} onChange={(event) => setSummary(event.target.value)} rows={3} disabled={pending} className={field} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-zinc-500">
        Ciekawostki, każda w osobnym wierszu
        <textarea value={facts} onChange={(event) => setFacts(event.target.value)} rows={Math.max(3, factList.length + 1)} disabled={pending} className={field} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-zinc-500">
        Historia
        <textarea value={history} onChange={(event) => setHistory(event.target.value)} rows={3} disabled={pending} className={field} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-zinc-500">
        Na miejscu, każda wskazówka w osobnym wierszu
        <textarea value={tips} onChange={(event) => setTips(event.target.value)} rows={Math.max(2, tipList.length + 1)} disabled={pending} className={field} />
      </label>
      <p className="text-xs text-zinc-500">Poprawka dotyczy tylko tego wyjazdu. Zdjęcia i źródło zostają.</p>
      {tooMany && <p className="text-xs text-red-600">{tooMany}</p>}
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
      <div className="flex items-center gap-2">
        <button disabled={pending || summary.trim() === "" || tooMany !== null} className="btn-primary btn-sm">
          {pending ? "Zapisuję…" : "Zapisz"}
        </button>
        <button type="button" disabled={pending} onClick={onClose} className="btn-mini">
          anuluj
        </button>
      </div>
    </form>
  );
}
