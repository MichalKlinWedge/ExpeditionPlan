"use server";

import { type BriefImport, docxHtmlToText } from "@expeditionplan/core";
import { BRIEF_DOCUMENT_FILE_MIME, BRIEF_DOCUMENT_TEXT_LIMIT, readBriefDocument } from "@expeditionplan/planner";

import type { FormState } from "@/app/actions";
import { aiAccessError, geminiClient } from "@/lib/ai";
import { requireUser } from "@/lib/auth";

/**
 * Brief z dokumentu przygotowanego poza aplikacją (strona „Brief wyjazdu”): PDF, DOCX, plik tekstowy, zdjęcie strony
 * albo wklejony tekst → szkic AI (Gemini). Wynik wraca do przeglądarki, która pokazuje podgląd i wstawia wybrane pola
 * do formularza (`core/brief-import.ts`); zapis briefu to dalej „Zapisz brief”. Plik nie zostaje na serwerze.
 */

/** Limit ciała akcji to 4 MB (`next.config.ts`) — plik z zapasem na resztę formularza. */
const MAX_FILE_BYTES = 3_800_000;
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const TEXT_EXTENSIONS = /\.(txt|md|markdown|csv)$/i;

export type BriefImportState = FormState & { draft?: BriefImport };

async function documentText(upload: File): Promise<string | { error: string }> {
  const data = Buffer.from(await upload.arrayBuffer());
  if (upload.type === DOCX_MIME || upload.name.toLowerCase().endsWith(".docx")) {
    try {
      const mammoth = await import("mammoth");
      const { value } = await mammoth.convertToHtml({ buffer: data });
      return docxHtmlToText(value);
    } catch {
      return { error: "Nie udało się odczytać pliku DOCX. Zapisz go jako PDF albo wklej tekst." };
    }
  }
  return data.toString("utf8");
}

/** Czyta dokument i zwraca szkic briefu do podglądu; nic nie zapisuje. */
export async function readBriefImport(tripId: string, form: FormData): Promise<BriefImportState> {
  const file = form.get("file");
  const pasted = String(form.get("text") ?? "").trim();
  const upload = file instanceof File && file.size > 0 ? file : null;
  if (upload === null && pasted === "") return { error: "Wybierz plik albo wklej tekst dokumentu." };
  const direct = upload !== null && BRIEF_DOCUMENT_FILE_MIME.includes(upload.type);
  const asText = upload !== null && !direct && (upload.type === DOCX_MIME || upload.name.toLowerCase().endsWith(".docx") || upload.type.startsWith("text/") || TEXT_EXTENSIONS.test(upload.name));
  if (upload !== null && !direct && !asText) return { error: "AI czyta PDF, DOCX, pliki tekstowe (TXT, MD) i zdjęcia (JPG, PNG, WebP, HEIC). Plik .doc zapisz jako .docx albo PDF." };
  if (upload !== null && upload.size > MAX_FILE_BYTES) return { error: "Plik jest za duży do odczytu przez AI (limit ok. 3,8 MB). Wklej najważniejszą część jako tekst." };

  const { supabase } = await requireUser(`/trips/${tripId}/brief`);
  const denied = await aiAccessError();
  if (denied !== null) return { error: denied };
  const gemini = geminiClient();
  if (gemini === null) return { error: "Brak klucza GEMINI_API_KEY." };
  const trip = await supabase.from("my_trips").select("title, start_date, end_date, role").eq("id", tripId).maybeSingle();
  if (trip.data === null) return { error: "Nie ma takiego wyjazdu." };
  if (trip.data.role !== "owner" && trip.data.role !== "editor") return { error: "Brief może zmieniać organizator albo edytor wyjazdu." };

  let text: string | undefined = pasted === "" ? undefined : pasted;
  if (asText) {
    const read = await documentText(upload!);
    if (typeof read !== "string") return read;
    text = read.trim();
    if (text === "") return { error: "W pliku nie ma tekstu." };
  }
  const tooLong = text !== undefined && text.length > BRIEF_DOCUMENT_TEXT_LIMIT;
  try {
    const source = direct ? { file: { mimeType: upload!.type, data: Buffer.from(await upload!.arrayBuffer()).toString("base64") } } : { text: text! };
    const draft = await readBriefDocument(gemini.client, source, { title: trip.data.title!, startDate: trip.data.start_date!, endDate: trip.data.end_date! }, { timeoutMs: 120_000 });
    return { draft, ...(tooLong ? { ok: `Dokument jest długi: AI przeczytało pierwsze ${BRIEF_DOCUMENT_TEXT_LIMIT.toLocaleString("pl-PL")} znaków.` } : {}) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
