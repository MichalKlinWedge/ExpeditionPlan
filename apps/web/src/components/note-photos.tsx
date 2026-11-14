"use client";

import { GUIDE_PHOTO_BUCKET, guidePhotoPath, MAX_NOTE_PHOTOS, type NotePhoto, notePhotoCredit } from "@expeditionplan/core";
import { dbErrorMessage, uuidv7 } from "@expeditionplan/sync";
import { type FormEvent, useRef, useState, useTransition } from "react";

import type { FormState } from "@/app/actions";
import { addItemNotePhoto, captionItemNotePhoto, moveItemNotePhoto, removeItemNotePhoto } from "@/app/note-photo-actions";
import { IconAction } from "@/components/icon-action";
import { OWN_PHOTO_PX, ownPhotoJpeg } from "@/lib/own-photo";
import { createClient } from "@/lib/supabase/client";

/**
 * Zdjęcia przy uwagach punktu (`core/note-photos.ts`): miniatury z podpisem, klik otwiera pełne zdjęcie.
 * W trybie edycji: wgrywanie z dysku (jak własne zdjęcia opisów miejsc), podpis, kolejność i usuwanie.
 */
export function NotePhotos({ tripId, itemRef, photos, editing }: { tripId: string; itemRef: string; photos: NotePhoto[]; editing: boolean }) {
  const [state, setState] = useState<FormState>({});
  const [adding, setAdding] = useState(false);
  const [captioning, setCaptioning] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [pending, start] = useTransition();
  if (photos.length === 0 && !editing) return null;
  const run = (action: () => Promise<FormState>, after?: () => void) =>
    start(async () => {
      const result = await action();
      setState(result);
      if (result.ok) after?.();
    });
  return (
    <div className="flex flex-col gap-2">
      {photos.length > 0 && (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {photos.map((photo, at) => (
            <li key={photo.url} className="flex flex-col gap-1">
              <figure className="flex flex-col gap-1">
                <a href={photo.url} target="_blank" rel="noreferrer" title="Otwórz całe zdjęcie">
                  {/* Własne zdjęcie z publicznego `guide_photos` — zwykły <img>, plik ma najwyżej 1920 px. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photo.url} alt={photo.caption ?? "Zdjęcie do uwag"} loading="lazy" className="aspect-[4/3] w-full rounded-lg object-cover" />
                </a>
                {notePhotoCredit(photo) && <figcaption className="text-[11px] leading-tight text-zinc-500">{notePhotoCredit(photo)}</figcaption>}
              </figure>
              {editing &&
                (captioning === photo.url ? (
                  <form
                    className="flex flex-col gap-1"
                    onSubmit={(event) => {
                      event.preventDefault();
                      run(() => captionItemNotePhoto(tripId, itemRef, photo.url, caption), () => setCaptioning(null));
                    }}>
                    <input value={caption} onChange={(event) => setCaption(event.target.value)} disabled={pending} maxLength={200} placeholder="Podpis zdjęcia" aria-label="Podpis zdjęcia" className="field px-2 py-1 text-xs" autoFocus />
                    <div className="flex gap-1">
                      <button disabled={pending} className="btn-primary btn-sm">
                        Zapisz
                      </button>
                      <button type="button" disabled={pending} onClick={() => setCaptioning(null)} className="btn-secondary btn-sm">
                        Anuluj
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="flex flex-wrap items-center gap-1 text-xs">
                    {photos.length > 1 && (
                      <>
                        <button type="button" disabled={pending || at === 0} onClick={() => run(() => moveItemNotePhoto(tripId, itemRef, photo.url, -1))} className="btn-mini" aria-label="Przesuń wcześniej" title="Wcześniej">
                          ←
                        </button>
                        <button type="button" disabled={pending || at === photos.length - 1} onClick={() => run(() => moveItemNotePhoto(tripId, itemRef, photo.url, 1))} className="btn-mini" aria-label="Przesuń później" title="Później">
                          →
                        </button>
                      </>
                    )}
                    <IconAction
                      kind="edit"
                      tip="Zmień podpis"
                      disabled={pending}
                      onClick={() => {
                        setCaption(photo.caption ?? "");
                        setCaptioning(photo.url);
                      }}
                    />
                    <IconAction kind="remove" tip="Usuń zdjęcie" disabled={pending} onClick={() => window.confirm("Usunąć to zdjęcie?") && run(() => removeItemNotePhoto(tripId, itemRef, photo.url))} />
                  </div>
                ))}
            </li>
          ))}
        </ul>
      )}
      {state.error && <p className="text-xs msg-error">{state.error}</p>}
      {editing &&
        (adding ? (
          <NotePhotoUpload tripId={tripId} itemRef={itemRef} full={photos.length >= MAX_NOTE_PHOTOS} onClose={() => setAdding(false)} onState={setState} />
        ) : (
          photos.length < MAX_NOTE_PHOTOS && (
            <button type="button" onClick={() => setAdding(true)} className="btn-secondary btn-sm self-start">
              + Zdjęcie do uwag
            </button>
          )
        ))}
    </div>
  );
}

/** Wgranie z dysku: plik do `guide_photos`, potem do punktu. Formularz zostaje otwarty na kolejne zdjęcie. */
function NotePhotoUpload({ tripId, itemRef, full, onClose, onState }: { tripId: string; itemRef: string; full: boolean; onClose: () => void; onState: (state: FormState) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const [author, setAuthor] = useState("");
  const [added, setAdded] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const picker = useRef<HTMLInputElement>(null);
  const upload = (event: FormEvent) => {
    event.preventDefault();
    if (file === null) return;
    setAdded(null);
    start(async () => {
      const jpeg = await ownPhotoJpeg(file);
      if (typeof jpeg === "string") return onState({ error: jpeg });
      const id = uuidv7();
      const sent = await createClient().storage.from(GUIDE_PHOTO_BUCKET).upload(guidePhotoPath(tripId, id), jpeg, { contentType: "image/jpeg", upsert: false });
      if (sent.error) return onState({ error: dbErrorMessage(sent.error, "Nie wgrano zdjęcia. Spróbuj jeszcze raz.") });
      const result = await addItemNotePhoto(tripId, itemRef, id, { caption, author });
      onState(result.error ? result : {});
      if (!result.ok) return;
      setAdded(`Dodano „${file.name}”. Możesz wgrać kolejne.`);
      setFile(null);
      setCaption("");
      if (picker.current) picker.current.value = "";
    });
  };
  return (
    <form onSubmit={upload} className="panel flex flex-col gap-2 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={picker}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          disabled={pending || full}
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setAdded(null);
          }}
          aria-label="Plik zdjęcia"
          className="text-xs"
        />
        <input value={caption} onChange={(event) => setCaption(event.target.value)} disabled={pending} maxLength={200} placeholder="Podpis (np. wejście do T2B)" aria-label="Podpis zdjęcia" className="field min-w-40 flex-1 p-2 text-sm" />
        <input value={author} onChange={(event) => setAuthor(event.target.value)} disabled={pending} maxLength={80} placeholder="Autor (domyślnie Ty)" aria-label="Autor zdjęcia" className="field w-44 p-2 text-sm" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button disabled={pending || file === null || full} className="btn-primary btn-sm">
          {pending ? "Wgrywam…" : "Wgraj"}
        </button>
        <button type="button" disabled={pending} onClick={onClose} className="btn-secondary btn-sm">
          {added ? "Gotowe" : "Anuluj"}
        </button>
        {full && <span className="text-xs text-zinc-500">Przy uwagach jest już {MAX_NOTE_PHOTOS} zdjęć.</span>}
      </div>
      {added && <p className="text-xs msg-ok">{added}</p>}
      <p className="text-xs text-zinc-500">
        Zdjęcie zmniejszamy do {OWN_PHOTO_PX} px i bez danych z aparatu (także położenia). Zobaczą je uczestnicy wyjazdu, także offline w telefonie; plik ma publiczny adres, którego nie da się zgadnąć. Bilety i dokumenty trzymaj w Sejfie.
      </p>
    </form>
  );
}
