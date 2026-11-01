/**
 * UUIDv7 (RFC 9562): 48 bitów milisekund + losowość. Id nadaje klient, więc obiekt utworzony
 * offline ma od razu stały identyfikator, a ponowna wysyłka z outboxa trafia w ten sam wiersz.
 * Na telefonie `crypto.getRandomValues` daje expo-crypto (polyfill), w Node i przeglądarce jest wbudowane.
 */
export function uuidv7(now: number = Date.now()): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let ms = now;
  for (let i = 5; i >= 0; i--) {
    bytes[i] = ms % 256;
    ms = Math.floor(ms / 256);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Stałe id z kilku części (np. pozycja pakowania + uczestnik): dwa telefony odhaczające tę samą
 * parę offline trafiają w ten sam wiersz, zamiast łamać `unique (packing_item_id, traveler_id)`.
 * Cztery skróty FNV-1a z różnymi ziarnami → 128 bitów w formacie UUID wersji 8.
 */
export function stableUuid(...parts: string[]): string {
  const text = parts.join('|');
  const words = [0x811c9dc5, 0x01000193, 0x2e4f61b7, 0x9e3779b9].map((seed) => {
    let hash = seed >>> 0;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash;
  });
  const hex = words.map((word) => word.toString(16).padStart(8, '0')).join('');
  const variant = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20)}`;
}
