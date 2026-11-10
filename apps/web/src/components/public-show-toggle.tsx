"use client";

import type { ShowKind } from "@expeditionplan/core";
import Link from "next/link";
import { useState, useTransition } from "react";

import type { FormState } from "@/app/actions";
import { setPublicShow } from "@/app/show-actions";
import { SHOW_PAGES } from "@/lib/show-pages";

/**
 * Zgoda właściciela na pokaz pod publicznym linkiem. Pod linkiem jest ten sam film co tutaj: tekst i głos lektora bez
 * zmian (ukrywanie imion i kwot z ustawień linku ich nie obejmuje) i zdjęcia z dziennika.
 */
export function PublicShowToggle({ tripId, kind, linkOn, showOn }: { tripId: string; kind: ShowKind; linkOn: boolean; showOn: boolean }) {
  const page = SHOW_PAGES[kind];
  const [result, setResult] = useState<FormState>({});
  const [pending, start] = useTransition();
  const change = (on: boolean) => {
    if (on && !window.confirm("Pokaz trafi pod publiczny link razem z tekstem i głosem lektora (także imionami i kwotami, jeśli w nich są) oraz zdjęciami z dziennika. Udostępnić?")) return;
    start(async () => setResult(await setPublicShow(tripId, kind, on)));
  };
  return (
    <section className="card flex flex-col gap-2 p-4 text-sm">
      <h2 className="card-title">Publiczny link</h2>
      {!linkOn ? (
        <p className="flex flex-wrap items-center gap-2 text-zinc-600 dark:text-zinc-400">
          Pokaz można udostępnić pod publicznym linkiem wyjazdu, a tego linku jeszcze nie ma.
          <Link href={`/trips/${tripId}/people`} className="btn-mini">
            Uczestnicy i dostęp
          </Link>
        </p>
      ) : (
        <>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={showOn} disabled={pending} onChange={(event) => change(event.target.checked)} /> {page.title.toLowerCase()} pod publicznym linkiem
          </label>
          <p className="text-xs text-zinc-500">
            {showOn
              ? `Kto ma link do wyjazdu, ogląda ten film w zakładce „${page.title}”, bez logowania. Dopisz /${kind === "film" ? "film" : "show"} do linku, żeby wysłać od razu ten film.`
              : "Tekst i głos lektora idą pod link bez zmian (ustawienia ukrywania imion i cen ich nie obejmują), razem ze zdjęciami z dziennika."}
          </p>
        </>
      )}
      {result.error && <p className="msg-error">{result.error}</p>}
      {result.ok && <p className="msg-ok">{result.ok}</p>}
    </section>
  );
}
