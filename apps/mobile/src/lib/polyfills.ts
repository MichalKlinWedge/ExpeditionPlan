import { getRandomValues } from 'expo-crypto';

/**
 * `crypto.getRandomValues` dla Hermesa — z niego `uuidv7` (packages/sync) nadaje id zapisom
 * z telefonu (zdarzenia dnia, wydatki, nowe punkty). Importowane jako pierwsze w `_layout`.
 */
const scope = globalThis as { crypto?: { getRandomValues?: unknown } };
if (typeof scope.crypto?.getRandomValues !== 'function') {
  scope.crypto = { ...scope.crypto, getRandomValues };
}
