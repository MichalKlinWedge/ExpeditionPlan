"use client";

import { type BookingDetails, codeLabel, CONTACT_ROLE, formatBytes, type VaultDocument } from "@expeditionplan/core";
import { dbErrorMessage } from "@expeditionplan/sync";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";

import { DialogTitle } from "@/components/dialog-title";
import { LinkedText } from "@/components/linked-text";
import { CodeScreen } from "@/components/vault";
import { bookingHref, contactHref } from "@/lib/booking-link";
import { createClient } from "@/lib/supabase/client";

/**
 * Rezerwacja z planu albo karty punktu, jak okno rezerwacji na telefonie: termin, kwota, warunki, punkty
 * w pakiecie, kontakty, linki i dokumenty z sejfu. Dane z `bookingDetails` (packages/core); dopiero stąd
 * przejście do tabeli „Rezerwacje” i do sejfu. Link publiczny tego okna nie ma.
 */

type Props = {
  tripId: string;
  details: BookingDetails;
  /** Dokumenty tej rezerwacji, które RLS pozwala zobaczyć. */
  documents: VaultDocument[];
  onClose: () => void;
};

export function BookingDialog({ tripId, details, documents, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [code, setCode] = useState<{ title: string; payload: string; format: string | null; plain?: boolean } | null>(null);
  const { booking } = details;
  const listHref = bookingHref(tripId, booking) ?? `/trips/${tripId}/logistics`;

  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  // Next trzyma opuszczoną stronę w ukrytym `Activity`, a okno modalne zostałoby nad nową: zamknięcie przed przejściem.
  const leave = () => dialog.current?.close();

  // Portal: przycisk stoi w zdaniu (`<p>`), a okno ma bloki, których w akapicie być nie może.
  return createPortal(
    <dialog
      ref={dialog}
      onClose={onClose}
      // Escape przy kodzie na pełnym ekranie zamyka tylko kod (bez domyślnej akcji klawisza nie ma `cancel`).
      onKeyDown={(event) => event.key === "Escape" && code !== null && event.preventDefault()}
      onClick={(event) => event.target === dialog.current && dialog.current.close()}
      aria-label={`Rezerwacja: ${booking.title}`}
      className="card dialog">
      <div className="flex flex-col gap-3">
        <DialogTitle onClose={() => dialog.current?.close()}>
          <h2>🎫 {booking.title}</h2>
          <p className="text-xs text-zinc-500">{[details.kind, details.status].join(" · ")}</p>
        </DialogTitle>

        <div className="flex flex-col gap-1 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900">
          {details.when !== "" && <p className="font-medium">{details.when}</p>}
          {details.price !== null && <p>💰 {details.price}</p>}
          {details.line !== "" && (
            <p>
              <LinkedText text={details.line} />
            </p>
          )}
          {details.place !== undefined && <p>Miejsce: {details.place}</p>}
          {booking.confirmationCode && (
            <p>
              Kod rezerwacji:{" "}
              <button type="button" onClick={() => setCode({ title: `${booking.title} — kod rezerwacji`, payload: booking.confirmationCode!, format: null, plain: true })} className="chip font-mono">
                {booking.confirmationCode}
              </button>
            </p>
          )}
          {details.facts.map((fact) => (
            <p key={fact} className="text-zinc-600 dark:text-zinc-400">
              · <LinkedText text={fact} />
            </p>
          ))}
        </div>

        {details.items.length > 0 && (
          <div className="flex flex-col gap-1">
            <h3 className="font-semibold">W pakiecie</h3>
            <ul className="flex flex-wrap gap-1">
              {details.items.map((item) => (
                <li key={item.ref}>
                  <Link href={`/trips/${tripId}/item/${encodeURIComponent(item.ref)}`} title="Karta punktu" onClick={leave} className="btn-mini">
                    {item.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        {booking.notes.length > 0 && (
          <div className="flex flex-col gap-1 text-zinc-600 dark:text-zinc-400">
            {booking.notes.map((note) => (
              <p key={note} className="whitespace-pre-line">
                <LinkedText text={note} />
              </p>
            ))}
          </div>
        )}

        {details.contacts.length > 0 && (
          <div className="flex flex-col gap-1">
            <h3 className="font-semibold">Kontakty</h3>
            {details.contacts.map((contact) => (
              <p key={contact.ref}>
                <Link href={contactHref(tripId, contact.ref)} title="Na stronie Kontakty" onClick={leave} className="btn-mini">
                  {contact.name}
                </Link>
                <span className="text-zinc-500"> · {CONTACT_ROLE[contact.role]}</span>
                {contact.phone ? (
                  <>
                    {" · "}
                    <a href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`} className="underline">
                      {contact.phone}
                    </a>
                  </>
                ) : null}
                {contact.email ? (
                  <>
                    {" · "}
                    <a href={`mailto:${contact.email}`} className="underline">
                      {contact.email}
                    </a>
                  </>
                ) : null}
              </p>
            ))}
          </div>
        )}

        {booking.links.length > 0 && (
          <p className="flex flex-wrap gap-x-3 gap-y-1">
            {booking.links.map((link) => (
              <a key={link.url} href={link.url} target="_blank" rel="noreferrer" className="underline">
                {link.label || link.url} ↗
              </a>
            ))}
          </p>
        )}

        <div className="flex flex-col gap-2">
          <h3 className="font-semibold">Dokumenty z sejfu</h3>
          {documents.length === 0 ? (
            <p className="text-zinc-500">Brak dokumentów przy tej rezerwacji.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {documents.map((document) => (
                <DocumentLine key={document.id} document={document} onShow={() => setCode({ title: document.fileName, payload: document.codePayload!, format: document.codeFormat })} />
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <Link href={listHref} onClick={leave} className="btn-secondary btn-sm">
            Wszystkie rezerwacje →
          </Link>
          <Link href={`/trips/${tripId}/documents`} onClick={leave} className="btn-secondary btn-sm">
            Sejf dokumentów →
          </Link>
        </div>
      </div>
      {code && <CodeScreen {...code} onClose={() => setCode(null)} />}
    </dialog>,
    document.body,
  );
}

/** Plik z sejfu: kod na pełnym ekranie albo plik przez krótki podpisany URL (jak w sejfie). */
function DocumentLine({ document, onShow }: { document: VaultDocument; onShow: () => void }) {
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const open = () =>
    start(async () => {
      const { data, error } = await createClient().storage.from("documents").createSignedUrl(document.storagePath, 120);
      if (error || !data) return setProblem(error ? dbErrorMessage(error) : "Nie udało się otworzyć pliku.");
      window.open(data.signedUrl, "_blank", "noopener");
    });
  return (
    <li className="flex flex-col gap-1">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span aria-hidden="true">{document.mime === "application/pdf" ? "📄" : "🖼️"}</span>
        <span className="font-medium break-all">{document.fileName}</span>
        {document.size !== null && <span className="text-xs text-zinc-500">{formatBytes(document.size)}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {document.codePayload && (
          <button type="button" onClick={onShow} className="btn-primary btn-sm">
            Pokaż {codeLabel(document.codeFormat)}
          </button>
        )}
        <button type="button" disabled={pending} onClick={open} className="btn-mini">
          otwórz plik
        </button>
      </div>
      {problem && <p className="text-xs msg-error">{problem}</p>}
    </li>
  );
}

/** Przycisk otwierający okno — dla stron serwera (karta punktu), które liczą `details` u siebie. */
export function BookingButton({ tripId, details, documents, label = "szczegóły" }: Omit<Props, "onClose"> & { label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn-mini">
        {label}
      </button>
      {open && <BookingDialog tripId={tripId} details={details} documents={documents} onClose={() => setOpen(false)} />}
    </>
  );
}
