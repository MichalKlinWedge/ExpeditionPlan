"use client";

import { addDays, daysBetween, isRealDate } from "@expeditionplan/core";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";

import { applyReschedule, previewReschedule, type ReschedulePreview } from "@/app/reschedule-actions";
import { setTripPostponed } from "@/app/actions";
import { ClimateHint } from "@/components/climate-hint";
import { DialogTitle } from "@/components/dialog-title";
import { tripDates } from "@/lib/labels";

const shortDate = (date: string) => `${Number(date.slice(8))}.${date.slice(5, 7)}.${date.slice(0, 4)}`;

const dayWord = (days: number) => (Math.abs(days) === 1 ? "dzień" : "dni");

type Term = { tripId: string; startDate: string; endDate: string; today: string; hasDrafts?: boolean };

/** Przycisk „Zmień termin” na stronie wyjazdu. */
export function TripRescheduleButton(term: Term) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn-secondary btn-sm">
        Zmień termin
      </button>
      {open && <RescheduleDialog {...term} initial={term.startDate} onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * Nowa data początku i podgląd: co przesunie się z planem, a co trzeba sprawdzić samemu. Z `restore`
 * zapis od razu przywraca wyjazd z „Odłożonych” — wtedy zostaje też droga bez zmiany terminu.
 */
export function RescheduleDialog({ tripId, startDate, endDate, today, hasDrafts, initial, restore = false, onClose }: Term & { initial: string; restore?: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [date, setDate] = useState(initial);
  const [preview, setPreview] = useState<ReschedulePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, load] = useTransition();
  const [saving, save] = useTransition();
  const latest = useRef(initial);

  const fetchPreview = (next: string) => {
    latest.current = next;
    load(async () => {
      const result = await previewReschedule(tripId, next);
      if (latest.current !== next) return;
      setPreview(result.preview ?? null);
      setError(result.error ?? null);
    });
  };

  useEffect(() => {
    dialog.current?.showModal();
    fetchPreview(initial);
    // Podgląd daty początkowej — tylko przy otwarciu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changeDate = (next: string) => {
    setDate(next);
    setPreview(null);
    setError(null);
    if (isRealDate(next)) fetchPreview(next);
  };

  const apply = () => {
    if (preview === null) return;
    save(async () => {
      const result = await applyReschedule(tripId, date, preview.version, restore);
      if (result.ok) return onClose();
      setError(result.error ?? null);
      if (result.preview) setPreview(result.preview);
    });
  };

  const restoreAsIs = () => {
    save(async () => {
      const result = await setTripPostponed(tripId, false);
      if (result.error) return setError(result.error);
      onClose();
    });
  };

  const newEnd = isRealDate(date) ? addDays(date, daysBetween(startDate, endDate)) : null;
  const changed = preview !== null && preview.offsetDays !== 0;
  const review = preview?.review;
  const busy = loading || saving;

  return (
    <dialog ref={dialog} onClose={onClose} className="card dialog">
      <div className="flex flex-col gap-3">
        <DialogTitle onClose={() => dialog.current?.close()} disabled={saving}>
          <h2>{restore ? "Nowy termin przed przywróceniem" : "Zmień termin"}</h2>
        </DialogTitle>
        {restore && <p>Termin tego wyjazdu już minął. Podaj nową datę początku — bez niej wyjazd po przywróceniu trafi do „Archiwum”.</p>}
        <label className="flex flex-col gap-1">
          <span className="font-medium">Nowa data początku</span>
          <input type="date" className="field" value={date} onChange={(event) => changeDate(event.target.value)} />
        </label>
        <p className="text-zinc-600 dark:text-zinc-400">
          Teraz: {tripDates(startDate, endDate)}
          {newEnd !== null && changed && (
            <>
              {" "}→ <strong>{tripDates(date, newEnd)}</strong> ({preview.offsetDays > 0 ? "o" : "wcześniej o"} {Math.abs(preview.offsetDays)} {dayWord(preview.offsetDays)}
              {preview.offsetDays > 0 ? " później" : ""}). Długość bez zmian.
            </>
          )}
        </p>
        <ClimateHint tripId={tripId} start={isRealDate(date) ? date : null} end={newEnd} today={today} />
        {loading && preview === null && <p className="text-zinc-500">Liczę, co się przesunie…</p>}

        {changed && review && (
          <>
            <section>
              <h3 className="font-medium">Przesunie się razem z planem</h3>
              <ul className="ml-5 list-disc text-zinc-700 dark:text-zinc-300">
                <li>dni planu: {preview.moved.days}</li>
                {preview.moved.bookings > 0 && <li>niekupione rezerwacje i kandydaci: {preview.moved.bookings}</li>}
                {preview.moved.tasks > 0 && <li>terminy zadań: {preview.moved.tasks}</li>}
                {preview.moved.decisions > 0 && <li>terminy decyzji: {preview.moved.decisions}</li>}
                {preview.moved.travelers > 0 && <li>daty uczestników: {preview.moved.travelers}</li>}
              </ul>
            </section>

            <section className="rounded-md bg-amber-50 p-3 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100">
              <h3 className="font-medium">Do sprawdzenia ręcznie</h3>
              <ul className="ml-5 mt-1 flex list-disc flex-col gap-1">
                {review.keptBookings.length > 0 && (
                  <li>
                    Kupione rezerwacje zostają przy swoich datach — zmień je u dostawcy, a potem na stronie{" "}
                    <Link className="btn-mini" href={`/trips/${tripId}/logistics`}>
                      Rezerwacje i budżet
                    </Link>
                    :
                    <ul className="ml-4 list-[circle]">
                      {review.keptBookings.map((booking) => (
                        <li key={booking.ref}>
                          {booking.title}
                          {booking.start && ` (${shortDate(booking.start)}${booking.end && booking.end !== booking.start ? `–${shortDate(booking.end)}` : ""})`}
                        </li>
                      ))}
                    </ul>
                  </li>
                )}
                {review.uncertainBookings.length > 0 && <li>Plan nie wie, czy te są kupione — przesunięte, sprawdź: {review.uncertainBookings.map((booking) => booking.title).join(", ")}.</li>}
                {review.repriceBookings.length > 0 && <li>Ceny były sprawdzane na stary termin — do ponownego sprawdzenia: {review.repriceBookings.length}.</li>}
                {review.keptTasks.length > 0 && <li>Zadania przy kupionych rezerwacjach zostają przy swojej dacie: {review.keptTasks.map((task) => `${task.title} (${shortDate(task.date)})`).join(", ")}.</li>}
                {review.schedule.map((entry) => (
                  <li key={`${entry.dayRef}-${entry.message}`}>
                    {shortDate(entry.date)}: {entry.message}
                  </li>
                ))}
                {review.dayTitles.length > 0 && <li>Tytuły dni z datą lub dniem tygodnia nie zmienią się same: {review.dayTitles.map((day) => `„${day.title}”`).join(", ")}.</li>}
                {review.weekdaysChange && <li>Zmienią się dni tygodnia — sprawdź miejsca bez podanych godzin otwarcia.</li>}
                <li>Daty wpisane w opisach i notatkach zostają bez zmian.</li>
                {preview.realEvents > 0 && <li>Wydatki, wpisy dziennika i zdarzenia z trasy ({preview.realEvents}) zostają przy swoich datach.</li>}
                {hasDrafts && <li>Szkice AI zostają przy starym terminie — żeby je porównać z planem, zmień też termin szkicu.</li>}
              </ul>
            </section>
          </>
        )}

        {restore && newEnd !== null && newEnd < today && <p className="text-amber-700 dark:text-amber-400">Ten termin też już minął — wyjazd trafi do „Archiwum”.</p>}
        {error && <p className="msg-error">{error}</p>}

        <div className="flex flex-wrap justify-end gap-2">
          {restore && (
            <button type="button" disabled={busy} onClick={restoreAsIs} className="btn-secondary btn-sm mr-auto">
              Przywróć bez zmiany (do „Archiwum”)
            </button>
          )}
          <button type="button" disabled={saving} onClick={() => dialog.current?.close()} className="btn-secondary btn-sm">
            Anuluj
          </button>
          <button type="button" disabled={busy || !changed} onClick={apply} className="btn-primary btn-sm">
            {saving ? "Zapisuję…" : restore ? "Zmień termin i przywróć" : "Zmień termin"}
          </button>
        </div>
      </div>
    </dialog>
  );
}
