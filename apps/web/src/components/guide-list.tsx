"use client";

import { type TripGuide } from "@expeditionplan/core";
import Link from "next/link";
import { useState, useTransition } from "react";

import type { FormState } from "@/app/actions";
import { removeGuide, saveGuideText } from "@/app/guide-actions";
import { GuideArticle } from "@/components/guide-article";
import { GuideButtons, PlaceGuideButtons } from "@/components/guide-button";

/** Lista opisów na stronie „Opisy miejsc”: skrót, a po rozwinięciu cały opis, nowa wersja z AI, ręczna poprawka i usunięcie. */

const REGENERATE = "Przygotować nowy opis? Obecny zostanie zastąpiony.";
const REGENERATE_EDITED = "Przygotować nowy opis? Obecny, razem z ręcznymi poprawkami, zostanie zastąpiony.";

export function GuideList({ tripId, guides, missing, canEdit }: { tripId: string; guides: TripGuide[]; missing: { ref: string; title: string }[]; canEdit: boolean }) {
  return (
    <div className="flex flex-col gap-6">
      {guides.length === 0 ? (
        <p className="text-sm text-zinc-500">Ten wyjazd nie ma jeszcze opisów.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {guides.map((guide) => (
            <GuideRowCard key={guide.rowId} tripId={tripId} guide={guide} canEdit={canEdit} />
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

function GuideRowCard({ tripId, guide, canEdit }: { tripId: string; guide: TripGuide; canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const { content } = guide;
  const confirm = content.edited ? REGENERATE_EDITED : REGENERATE;
  return (
    <li className="card flex flex-col gap-2 p-3 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="text-left font-semibold hover:text-sea">
          {guide.title}
        </button>
        {content.edited && <span className="rounded bg-sea-light px-1.5 text-xs text-sea">poprawiony ręcznie</span>}
        <button type="button" onClick={() => setOpen(!open)} className="ml-auto text-xs underline">
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
                {index > 0 && ", "}
                <Link href={`/trips/${tripId}/item/${encodeURIComponent(item.ref)}`} className="underline">
                  {item.title}
                </Link>
              </span>
            ))}
            {guide.usedBy.length > 4 ? ` i ${guide.usedBy.length - 4} więcej` : ""}
          </>
        )}
      </p>
      {open && !editing && <GuideArticle guide={content} targets={[]} itemBase={`/trips/${tripId}/item/`} />}
      {open && editing && <GuideTextForm tripId={tripId} guide={guide} onClose={() => setEditing(false)} />}
      {open && canEdit && !editing && (
        <div className="flex flex-col gap-2 border-t border-zinc-200 pt-2 dark:border-zinc-800">
          <button type="button" onClick={() => setEditing(true)} className="btn-secondary btn-sm self-start">
            Popraw tekst
          </button>
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
      <button type="button" disabled={pending} onClick={() => window.confirm("Usunąć ten opis?") && start(async () => setState(await removeGuide(tripId, guideId)))} className="underline disabled:opacity-50">
        usuń opis
      </button>
      {state.error && <span className="text-red-600">{state.error}</span>}
    </p>
  );
}

function MissingRow({ tripId, item, canEdit }: { tripId: string; item: { ref: string; title: string }; canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="card flex flex-col gap-2 p-3 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <Link href={`/trips/${tripId}/item/${encodeURIComponent(item.ref)}`} className="hover:text-sea hover:underline">
          {item.title}
        </Link>
        {canEdit && (
          <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="ml-auto text-xs underline">
            {open ? "zwiń" : "przygotuj"}
          </button>
        )}
      </div>
      {open && <GuideButtons tripId={tripId} itemRef={item.ref} guideId={null} />}
    </li>
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
        <button type="button" disabled={pending} onClick={onClose} className="text-xs underline">
          anuluj
        </button>
      </div>
    </form>
  );
}
