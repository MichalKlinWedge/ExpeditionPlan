"use client";

import { useState, useTransition } from "react";

import type { FormState } from "@/app/actions";
import { describeFromSource, describeItem, describePlaceGuide, removeGuide } from "@/app/guide-actions";
import { IconAction } from "@/components/icon-action";
import { SparkIcon } from "@/components/icons";

/** Własne źródło opisu, gdy automat nic nie znalazł albo trafił w inne miejsce: link albo tekst wklejony ze strony. */
/**
 * Wyszukiwanie miejsca na Tripadvisorze: sam link, nic stamtąd nie pobieramy (warunki serwisu, docs/USLUGI.md §13).
 * Tekst skopiowany przez użytkownika wkleja się niżej jako źródło opisu.
 */
const tripadvisorSearchUrl = (name: string) => `https://www.tripadvisor.com/Search?q=${encodeURIComponent(name)}`;

function GuideSourceForm({ tripId, target, name, confirmRegenerate }: { tripId: string; target: { itemRef?: string; placeRef?: string }; name?: string | undefined; confirmRegenerate?: string | undefined }) {
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [state, setState] = useState<FormState>({});
  const [pending, start] = useTransition();
  return (
    <details className="text-xs text-zinc-500">
      <summary className="cursor-pointer hover:text-sea">Nie ma w Wikipedii? Podaj stronę o tym miejscu</summary>
      <div className="mt-2 flex flex-col gap-2">
        {name !== undefined && name.trim() !== "" && (
          <p>
            <a href={tripadvisorSearchUrl(name)} target="_blank" rel="noreferrer" className="underline">
              Szukaj „{name}” na Tripadvisor ↗
            </a>{" "}
            — tej strony nie czytamy automatycznie: wklej jej adres i skopiowany tekst poniżej.
          </p>
        )}
        <label className="flex flex-col gap-1">
          Adres strony (lokalna turystyka, strona obiektu, artykuł w Wikipedii w dowolnym języku)
          <input type="url" value={url} onChange={(event) => setUrl(event.target.value)} disabled={pending} placeholder="https://" className="field w-full px-2 py-1 text-sm" />
        </label>
        <label className="flex flex-col gap-1">
          Tekst ze strony (opcjonalnie, gdy strony nie da się odczytać)
          <textarea value={text} onChange={(event) => setText(event.target.value)} maxLength={12000} rows={3} disabled={pending} className="field w-full px-2 py-1 text-sm" />
        </label>
        <p>Zapisuję tylko streszczenie AI i link do źródła. Zdjęcia dobierzesz później z Wikimedia Commons.</p>
        <button
          disabled={pending || url.trim() === ""}
          onClick={() => (confirmRegenerate === undefined || window.confirm(confirmRegenerate)) && start(async () => setState(await describeFromSource(tripId, target, url, text)))}
          className="btn-secondary btn-sm self-start">
          <SparkIcon className="size-4" />
          {pending ? "Czytam i piszę… (ok. 10–30 s)" : "Przygotuj z tego źródła (AI)"}
        </button>
        {state.error && <p className="msg-error">{state.error}</p>}
        {state.ok && <p className="msg-ok">{state.ok}</p>}
      </div>
    </details>
  );
}

/**
 * Opis miejsca na stronie „Miejsca”: nowy albo odświeżony; `guideId` to własny opis miejsca, nie opis punktu.
 * Pole „O które dokładnie miejsce chodzi” rozstrzyga, gdy wiele miejsc nosi tę samą nazwę.
 */
export function PlaceGuideButtons({ tripId, placeRef, name, guideId, label, which: saved = "", confirmRegenerate }: { tripId: string; placeRef: string; name?: string; guideId: string | null; label: string; which?: string | undefined; confirmRegenerate?: string }) {
  const [state, setState] = useState<FormState>({});
  const [pending, start] = useTransition();
  const [which, setWhich] = useState(saved);
  return (
    <div className="flex flex-col gap-1">
      <label className="flex flex-col gap-1 text-xs text-zinc-500">
        O które dokładnie miejsce chodzi (opcjonalnie, gdy wiele nosi tę nazwę)
        <input value={which} onChange={(event) => setWhich(event.target.value)} maxLength={200} disabled={pending} placeholder="np. wieś w powiecie trzebnickim" className="field w-full px-2 py-1 text-sm" />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={pending} onClick={() => (confirmRegenerate === undefined || window.confirm(confirmRegenerate)) && start(async () => setState(await describePlaceGuide(tripId, placeRef, which)))} className={guideId ? "btn-secondary btn-sm" : "btn-primary btn-sm"}>
          <SparkIcon className="size-4" />
          {pending ? "Szukam artykułu i piszę… (ok. 10–30 s)" : label}
        </button>
        {guideId && (
          <IconAction kind="remove" tip="Usuń opis" disabled={pending} onClick={() => window.confirm("Usunąć opis tego miejsca?") && start(async () => setState(await removeGuide(tripId, guideId)))} />
        )}
      </div>
      {state.error && <p className="text-xs msg-error">{state.error}</p>}
      {state.ok && <p className="text-xs msg-ok">{state.ok}</p>}
      <GuideSourceForm tripId={tripId} target={{ placeRef }} name={name} confirmRegenerate={confirmRegenerate} />
    </div>
  );
}

/**
 * „Przygotuj opis z Wikipedii” / „Odśwież” i „Usuń opis” — akcje serwera z wynikiem pod spodem.
 * Pole „O czym ma być opis” naprowadza AI (wybór artykułu i treść), np. przejazd A7 → opłaty i bramki.
 */
export function GuideButtons({ tripId, itemRef, name, guideId, hint: saved = "", label, confirmRegenerate }: { tripId: string; itemRef: string; name?: string; guideId: string | null; hint?: string | undefined; label?: string; confirmRegenerate?: string }) {
  const [state, setState] = useState<FormState>({});
  const [pending, start] = useTransition();
  const [hint, setHint] = useState(saved);
  return (
    <div className="flex flex-col gap-1">
      <label className="flex flex-col gap-1 text-xs text-zinc-500">
        O czym ma być opis (opcjonalnie — podpowiedź dla AI)
        <textarea
          value={hint}
          onChange={(event) => setHint(event.target.value)}
          maxLength={300}
          rows={2}
          disabled={pending}
          placeholder="np. opłaty na autostradzie A7: bramki, ile kosztuje, czym płacić"
          className="w-full field max-w-xl px-2 py-1 text-sm"
        />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={pending} onClick={() => (confirmRegenerate === undefined || window.confirm(confirmRegenerate)) && start(async () => setState(await describeItem(tripId, itemRef, hint)))} className={guideId ? "btn-secondary btn-sm" : "btn-primary btn-sm"}>
          <SparkIcon className="size-4" />
          {pending ? "Szukam artykułu i piszę… (ok. 10–30 s)" : (label ?? (guideId ? "Odśwież opis" : "Przygotuj opis (AI)"))}
        </button>
        {guideId && (
          <IconAction kind="remove" tip="Usuń opis" disabled={pending} onClick={() => window.confirm("Usunąć opis tego miejsca?") && start(async () => setState(await removeGuide(tripId, guideId)))} />
        )}
      </div>
      {state.error && <p className="text-xs msg-error">{state.error}</p>}
      {state.ok && <p className="text-xs msg-ok">{state.ok}</p>}
      <GuideSourceForm tripId={tripId} target={{ itemRef }} name={name} confirmRegenerate={confirmRegenerate} />
    </div>
  );
}
