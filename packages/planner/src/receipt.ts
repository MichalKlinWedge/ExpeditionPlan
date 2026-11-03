import { type AiClient, type AiImage, type AiUsage, askStructured } from '@expeditionplan/ai';
import { BUDGET_CATEGORY } from '@expeditionplan/core';
import { z } from 'zod';

/**
 * Paragon ze zdjęcia (Etap 9): model z obrazem odczytuje kwotę do zapłaty, walutę, datę
 * i sprzedawcę i zgaduje kategorię. Wynik to szkic formularza wydatku — zapisuje człowiek.
 * Kod pilnuje kształtu (kwota dodatnia, waluta ISO, data YYYY-MM-DD); czego model nie jest
 * pewien, zostawia puste.
 */

const CATEGORIES = Object.keys(BUDGET_CATEGORY) as [string, ...string[]];

export const ReceiptReading = z.object({
  /** Czy na zdjęciu w ogóle jest paragon, rachunek albo faktura. */
  isReceipt: z.boolean(),
  /** Suma do zapłaty w jednostkach głównych (45.5 = 45,50), bez napiwku dopisanego ręcznie. */
  total: z.number().positive().nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  merchant: z.string().max(80).nullable(),
  category: z.enum(CATEGORIES).nullable(),
});
export type ReceiptReading = z.infer<typeof ReceiptReading>;

/** Szkic wydatku z paragonu; `null` = nie odczytano. */
export type ReceiptDraft = {
  amountMinor: number | null;
  currency: string | null;
  date: string | null;
  merchant: string | null;
  category: string | null;
};

const schemaOf = (schema: z.ZodType) => JSON.stringify(z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }));

export function receiptPrompt(currencies: string[]): string {
  return [
    'Na zdjęciu jest paragon, rachunek albo faktura z podróży. Odczytaj z niego:',
    '- total: łączną kwotę do zapłaty (SUMA / TOTAL / À PAYER / RAZEM), jako liczbę w jednostkach głównych waluty;',
    `- currency: walutę jako kod ISO 4217; waluty tego wyjazdu: ${currencies.join(', ') || 'nieznane'} — gdy paragon nie podaje waluty, wybierz najbardziej prawdopodobną z nich;`,
    '- date: datę zakupu jako YYYY-MM-DD;',
    '- merchant: krótką nazwę sprzedawcy (sklep, restauracja, stacja);',
    `- category: jedną z kategorii: ${Object.entries(BUDGET_CATEGORY).map(([key, name]) => `${key} (${name})`).join(', ')}.`,
    'Czego nie da się odczytać z pewnością, wpisz null. Gdy na zdjęciu nie ma paragonu, isReceipt = false i resztę null.',
    `JSON Schema odpowiedzi: ${schemaOf(ReceiptReading)}`,
  ].join('\n');
}

const SYSTEM = 'Odczytujesz dokumenty zakupu ze zdjęć. Odpowiadasz wyłącznie jednym obiektem JSON zgodnym z podanym JSON Schema, bez komentarza.';

export function draftFromReading(reading: ReceiptReading): ReceiptDraft | null {
  if (!reading.isReceipt) return null;
  return {
    amountMinor: reading.total === null ? null : Math.round(reading.total * 100),
    currency: reading.currency,
    date: reading.date,
    merchant: reading.merchant?.trim() || null,
    category: reading.category,
  };
}

/** Szkic wydatku z obrazu paragonu; `null`, gdy na zdjęciu nie ma paragonu. */
export async function readReceipt(
  client: AiClient,
  image: AiImage,
  options: { currencies: string[]; onUsage?: (usage: AiUsage) => void; timeoutMs?: number },
): Promise<ReceiptDraft | null> {
  const answer = await askStructured(client, ReceiptReading, receiptPrompt(options.currencies), {
    image,
    system: SYSTEM,
    label: 'paragon',
    ...(options.onUsage ? { onUsage: options.onUsage } : {}),
    ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
  });
  return draftFromReading(answer.data);
}
