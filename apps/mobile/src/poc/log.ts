import { File, Paths } from 'expo-file-system';

/**
 * Log PoC-2/PoC-3 jako JSON Lines w katalogu dokumentów aplikacji. Pisany także z zadań w tle,
 * więc bez stanu w pamięci; po spacerze udostępniany przyciskiem („Udostępnij log”).
 */

export type LogEntry = { type: string; [key: string]: unknown };

const logFile = () => new File(Paths.document, 'poc-log.jsonl');

export async function appendLog(entry: LogEntry): Promise<void> {
  const file = logFile();
  if (!file.exists) file.create();
  await file.write(`${JSON.stringify({ t: new Date().toISOString(), ...entry })}\n`, { append: true });
}

export async function readLog(limit = 40): Promise<(LogEntry & { t: string })[]> {
  const file = logFile();
  if (!file.exists) return [];
  const lines = (await file.text()).trim().split('\n').filter(Boolean);
  return lines.slice(-limit).reverse().map((line) => JSON.parse(line));
}

export function logUri(): string | null {
  const file = logFile();
  return file.exists ? file.uri : null;
}

export function clearLog(): void {
  const file = logFile();
  if (file.exists) file.delete();
}
