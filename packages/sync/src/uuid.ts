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
