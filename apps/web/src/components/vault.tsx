"use client";

import { CODE_FORMATS, codeLabel, DOCUMENT_MIME, documentPath, type DocumentVisibility, formatBytes, MAX_DOCUMENT_BYTES, VISIBILITY_LABEL, type VaultDocument } from "@expeditionplan/core";
import { uuidv7 } from "@expeditionplan/sync";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { codeSvg, type DetectedCode, detectCode, sha256 } from "@/lib/barcode";
import { createClient } from "@/lib/supabase/client";

/**
 * Sejf w przeglądarce: lista dokumentów pogrupowana po rezerwacjach i punktach, „Pokaż kod” na
 * pełnym ekranie, otwieranie pliku przez krótki podpisany URL, a w trybie edycji wgrywanie
 * (z odczytem kodu z pliku), zmiana i usuwanie. Zapis wprost do Supabase — o prawach decyduje RLS
 * tabeli `documents` i polityki bucketu (migracja *_documents_vault).
 */

type Ref = { id: string; title: string };
type Person = { userId: string; name: string; role: string };
type Props = {
  tripId: string;
  documents: VaultDocument[];
  bookings: (Ref & { code: string | null })[];
  items: Ref[];
  people: Person[];
  userId: string;
  owner: boolean;
  editing: boolean;
};

const input = "field min-w-0 px-2 py-1 text-sm";
const label = "flex min-w-0 flex-col gap-1 text-xs text-zinc-500";
const small = "text-xs underline disabled:opacity-50";
const BUCKET = "documents";

export function Vault({ tripId, documents, bookings, items, people, userId, owner, editing }: Props) {
  const [shown, setShown] = useState<{ title: string; payload: string; format: string | null; plain?: boolean } | null>(null);
  const [adding, setAdding] = useState(false);
  const groups = [
    ...bookings.map((booking) => ({ key: booking.id, title: booking.title, code: booking.code, docs: documents.filter((each) => each.bookingId === booking.id) })),
    ...items.map((item) => ({ key: item.id, title: item.title, code: null, docs: documents.filter((each) => each.itemId === item.id && each.bookingId === null) })),
    { key: "other", title: "Inne dokumenty", code: null, docs: documents.filter((each) => each.bookingId === null && each.itemId === null) },
  ].filter((group) => group.docs.length > 0 || (group.code !== null && group.code !== ""));
  const names = new Map(people.map((person) => [person.userId, person.name]));

  return (
    <div className="flex flex-col gap-4">
      {groups.length === 0 && <p className="text-sm text-zinc-500">W sejfie nie ma jeszcze dokumentów{editing ? "." : " — dodasz je po „Edytuj”."}</p>}
      {groups.map((group) => (
        <section key={group.key} className="card flex flex-col gap-2 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold">{group.title}</h2>
            {group.code && (
              <button onClick={() => setShown({ title: `${group.title} — kod rezerwacji`, payload: group.code!, format: null, plain: true })} className="chip">
                kod rezerwacji: {group.code}
              </button>
            )}
          </div>
          <ul className="flex flex-col gap-2">
            {group.docs.map((document) => (
              <DocumentRow
                key={document.id}
                tripId={tripId}
                document={document}
                names={names}
                editing={editing}
                bookings={bookings}
                items={items}
                people={people}
                userId={userId}
                owner={owner}
                onShow={() => setShown({ title: document.fileName, payload: document.codePayload!, format: document.codeFormat })}
              />
            ))}
          </ul>
        </section>
      ))}
      {editing &&
        (adding ? (
          <UploadForm tripId={tripId} bookings={bookings} items={items} people={people} userId={userId} owner={owner} onDone={() => setAdding(false)} />
        ) : (
          <button onClick={() => setAdding(true)} className="btn-secondary btn-sm self-start">
            + Dodaj dokument
          </button>
        ))}
      {shown && <CodeScreen {...shown} onClose={() => setShown(null)} />}
    </div>
  );
}

function DocumentRow({ tripId, document, names, editing, bookings, items, people, userId, owner, onShow }: { tripId: string; document: VaultDocument; names: Map<string, string>; editing: boolean; bookings: Ref[]; items: Ref[]; people: Person[]; userId: string; owner: boolean; onShow: () => void }) {
  const router = useRouter();
  const [changing, setChanging] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const visibility = document.visibility === "members" ? `${VISIBILITY_LABEL.members}: ${document.visibleTo.map((id) => names.get(id) ?? "?").join(", ")}` : VISIBILITY_LABEL[document.visibility];

  const open = () =>
    start(async () => {
      const { data, error } = await createClient().storage.from(BUCKET).createSignedUrl(document.storagePath, 120);
      if (error || !data) return setProblem(error?.message ?? "Nie udało się otworzyć pliku.");
      window.open(data.signedUrl, "_blank", "noopener");
    });
  const remove = () =>
    start(async () => {
      if (!window.confirm(`Usunąć „${document.fileName}” z sejfu?`)) return;
      const supabase = createClient();
      const { data, error } = await supabase.from("documents").update({ deleted_at: new Date().toISOString() }).eq("id", document.id).select("id");
      if (error || (data ?? []).length === 0) return setProblem(error?.message ?? "Brak uprawnień do usunięcia.");
      // Plik po wierszu: bez wiersza i tak nikt go nie otworzy (polityka bucketu).
      await supabase.storage.from(BUCKET).remove([document.storagePath]);
      router.refresh();
    });

  return (
    <li className="flex flex-col gap-1 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span aria-hidden="true">{document.mime === "application/pdf" ? "📄" : "🖼️"}</span>
        <span className="font-medium break-all">{document.fileName}</span>
        <span className="text-xs text-zinc-500">
          {[formatBytes(document.size), visibility, document.offline ? "offline w telefonie" : "tylko z internetem"].filter(Boolean).join(" · ")}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {document.codePayload && (
          <button onClick={onShow} className="btn-primary btn-sm">
            Pokaż {codeLabel(document.codeFormat)}
          </button>
        )}
        <button disabled={pending} onClick={open} className={small}>
          otwórz plik
        </button>
        {editing && (
          <>
            <button onClick={() => setChanging(!changing)} className={small}>
              {changing ? "zamknij" : "zmień"}
            </button>
            <button disabled={pending} onClick={remove} className={small}>
              usuń
            </button>
          </>
        )}
      </div>
      {problem && <p className="text-xs text-red-600">{problem}</p>}
      {changing && (
        <DocumentFields
          tripId={tripId}
          initial={document}
          bookings={bookings}
          items={items}
          people={people}
          userId={userId}
          owner={owner}
          submit="Zapisz"
          onCancel={() => setChanging(false)}
          onSave={async (fields) => {
            const { data, error } = await createClient().from("documents").update(fields).eq("id", document.id).select("id");
            if (error) return error.message;
            if ((data ?? []).length === 0) return "Brak uprawnień do tej zmiany.";
            setChanging(false);
            router.refresh();
            return null;
          }}
        />
      )}
    </li>
  );
}

type Fields = {
  file_name: string;
  booking_id: string | null;
  item_id: string | null;
  visibility: DocumentVisibility;
  visible_to: string[];
  offline: boolean;
  code_payload: string | null;
  code_format: string | null;
};

/** Pola dokumentu: nazwa, rezerwacja lub punkt, widoczność, offline, kod (z pliku albo wpisany). */
function DocumentFields({ initial, bookings, items, people, userId, owner, submit, onSave, onCancel, busy, children }: {
  tripId: string;
  initial?: VaultDocument;
  bookings: Ref[];
  items: Ref[];
  people: Person[];
  userId: string;
  owner: boolean;
  submit: string;
  onSave: (fields: Fields) => Promise<string | null>;
  onCancel: () => void;
  busy?: boolean;
  children?: React.ReactNode;
}) {
  const [name, setName] = useState(initial?.fileName ?? "");
  const [booking, setBooking] = useState(initial?.bookingId ?? "");
  const [item, setItem] = useState(initial?.itemId ?? "");
  const [visibility, setVisibility] = useState<DocumentVisibility>(initial?.visibility ?? "all");
  const [visibleTo, setVisibleTo] = useState<string[]>(initial?.visibleTo ?? [userId]);
  const [offline, setOffline] = useState(initial?.offline ?? true);
  const [payload, setPayload] = useState(initial?.codePayload ?? "");
  const [format, setFormat] = useState(initial?.codeFormat ?? "QRCode");
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      className="flex flex-col gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800"
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim() === "" && initial !== undefined) return setProblem("Podaj nazwę dokumentu.");
        // Edytor, który wybiera osoby, musi być wśród nich — inaczej baza odrzuci zapis (sam by go nie widział).
        const members = visibility === "members" ? [...new Set(owner ? visibleTo : [...visibleTo, userId])] : [];
        start(async () => {
          setProblem(
            await onSave({
              file_name: name.trim(),
              booking_id: booking || null,
              item_id: item || null,
              visibility,
              visible_to: members,
              offline,
              code_payload: payload.trim() || null,
              code_format: payload.trim() ? format : null,
            }),
          );
        });
      }}>
      {children}
      <div className="grid gap-2 sm:grid-cols-2">
        <label className={`${label} sm:col-span-2`}>
          Nazwa
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="np. Bilety Pałac Bahia, 5 osób" className={input} />
        </label>
        <label className={label}>
          Rezerwacja
          <select value={booking} onChange={(event) => setBooking(event.target.value)} className={input}>
            <option value="">—</option>
            {bookings.map((each) => (
              <option key={each.id} value={each.id}>
                {each.title}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Punkt planu
          <select value={item} onChange={(event) => setItem(event.target.value)} className={input}>
            <option value="">—</option>
            {items.map((each) => (
              <option key={each.id} value={each.id}>
                {each.title}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Kto widzi
          <select value={visibility} onChange={(event) => setVisibility(event.target.value as DocumentVisibility)} className={input}>
            <option value="all">{VISIBILITY_LABEL.all}</option>
            <option value="members">{VISIBILITY_LABEL.members}</option>
            {/* Dokument „tylko organizator” zapisze tylko organizator — edytor sam by go nie widział. */}
            {owner && <option value="owner">{VISIBILITY_LABEL.owner}</option>}
          </select>
        </label>
        <label className="flex items-center gap-2 self-end pb-1 text-xs text-zinc-500">
          <input type="checkbox" checked={offline} onChange={(event) => setOffline(event.target.checked)} /> offline w telefonie (pobierany razem z planem)
        </label>
      </div>
      {visibility === "members" && (
        <fieldset className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-500">
          <legend className="sr-only">Osoby</legend>
          {people.map((person) => (
            <label key={person.userId} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={visibleTo.includes(person.userId) || (!owner && person.userId === userId)}
                disabled={!owner && person.userId === userId}
                onChange={(event) => setVisibleTo(event.target.checked ? [...visibleTo, person.userId] : visibleTo.filter((id) => id !== person.userId))}
              />
              {person.name}
            </label>
          ))}
        </fieldset>
      )}
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <label className={label}>
          Treść kodu (z pliku albo wpisana ręcznie)
          <input value={payload} onChange={(event) => setPayload(event.target.value)} placeholder="brak kodu" className={`${input} font-mono`} />
        </label>
        <label className={label}>
          Rodzaj kodu
          <select value={format} onChange={(event) => setFormat(event.target.value)} className={input}>
            {CODE_FORMATS.map((each) => (
              <option key={each} value={each}>
                {each}
              </option>
            ))}
          </select>
        </label>
      </div>
      {problem && <p className="text-xs text-red-600">{problem}</p>}
      <div className="flex gap-2">
        <button disabled={pending || busy} className="btn-primary btn-sm">
          {pending ? "Zapisuję…" : submit}
        </button>
        <button type="button" onClick={onCancel} className="text-sm underline">
          Anuluj
        </button>
      </div>
    </form>
  );
}

function UploadForm({ tripId, bookings, items, people, userId, owner, onDone }: { tripId: string; bookings: Ref[]; items: Ref[]; people: Person[]; userId: string; owner: boolean; onDone: () => void }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [detected, setDetected] = useState<DetectedCode | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [reading, setReading] = useState(false);

  const choose = async (chosen: File | null) => {
    setFile(chosen);
    setDetected(null);
    setStatus(null);
    if (chosen === null) return;
    if (!DOCUMENT_MIME.includes(chosen.type)) return setStatus("Sejf przyjmuje PDF i zdjęcia (JPG, PNG, WebP, HEIC).");
    if (chosen.size > MAX_DOCUMENT_BYTES) return setStatus(`Plik ma ${formatBytes(chosen.size)} — limit to ${formatBytes(MAX_DOCUMENT_BYTES)}.`);
    setReading(true);
    try {
      const found = await detectCode(chosen);
      setDetected(found);
      setStatus(found ? `Znaleziono ${codeLabel(found.format)}.` : "Nie znaleziono kodu w pliku — możesz go wpisać ręcznie.");
    } catch (error) {
      setStatus(`Nie udało się odczytać kodu (${error instanceof Error ? error.message : String(error)}) — możesz go wpisać ręcznie.`);
    } finally {
      setReading(false);
    }
  };

  return (
    <DocumentFields
      // Nowy plik albo odczytany kod = formularz od nowa, z kodem w polach (nadal do poprawienia ręcznie).
      key={`${file?.name ?? "empty"}:${detected?.payload ?? ""}`}
      tripId={tripId}
      initial={file ? { id: "", fileName: file.name, storagePath: "", mime: file.type, size: file.size, sha256: null, bookingId: null, itemId: null, visibility: "all", visibleTo: [userId], offline: true, codePayload: detected?.payload ?? null, codeFormat: detected?.format ?? null } : undefined}
      bookings={bookings}
      items={items}
      people={people}
      userId={userId}
      owner={owner}
      submit="Wgraj do sejfu"
      busy={reading || file === null}
      onCancel={onDone}
      onSave={async (fields) => {
        if (file === null) return "Wybierz plik.";
        const supabase = createClient();
        const id = uuidv7();
        const path = documentPath(tripId, id, file.name);
        const upload = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
        if (upload.error) return `Nie wgrano pliku: ${upload.error.message}`;
        const { error } = await supabase.from("documents").insert({ ...fields, file_name: fields.file_name || file.name, id, trip_id: tripId, storage_path: path, mime: file.type, size: file.size, sha256: await sha256(file) });
        if (error) {
          await supabase.storage.from(BUCKET).remove([path]);
          return `Nie zapisano dokumentu: ${error.message}`;
        }
        onDone();
        router.refresh();
        return null;
      }}>
      <label className={label}>
        Plik (PDF albo zdjęcie, do {formatBytes(MAX_DOCUMENT_BYTES)})
        <input type="file" accept={DOCUMENT_MIME.join(",")} onChange={(event) => void choose(event.target.files?.[0] ?? null)} className="text-sm" />
      </label>
      {reading && <p className="text-xs text-zinc-500">Szukam kodu w pliku…</p>}
      {status && !reading && <p className={`text-xs ${detected ? "text-green-700 dark:text-green-400" : "text-zinc-500"}`}>{status}</p>}
    </DocumentFields>
  );
}

/** Kod na całym ekranie, czarny na białym (czytniki przy bramkach nie lubią ciemnego motywu). */
function CodeScreen({ title, payload, format, plain, onClose }: { title: string; payload: string; format: string | null; plain?: boolean; onClose: () => void }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    if (plain) return;
    let cancelled = false;
    codeSvg(payload, format).then(
      (markup) => !cancelled && setSvg(markup),
      (error: unknown) => !cancelled && setProblem(error instanceof Error ? error.message : String(error)),
    );
    return () => {
      cancelled = true;
    };
  }, [payload, format, plain]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  return (
    <div role="dialog" aria-modal="true" aria-label={title} onClick={onClose} className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-white p-4 text-black">
      <p className="text-center text-sm font-medium">{title}</p>
      {plain ? (
        <p className="font-mono text-5xl font-bold tracking-widest break-all">{payload}</p>
      ) : svg ? (
        // SVG z bwip-js (nasza treść kodu, bez skryptów) — rozciągnięty do ekranu.
        <div className="w-[min(90vw,70vh)] [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
      ) : (
        <p className="text-sm">{problem ? `Nie da się narysować kodu: ${problem}` : "Rysuję kod…"}</p>
      )}
      {!plain && <p className="max-w-full font-mono text-xs break-all text-zinc-600">{payload}</p>}
      <button onClick={onClose} className="rounded-full border border-zinc-300 px-4 py-1 text-sm">
        Zamknij
      </button>
    </div>
  );
}
