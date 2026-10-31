/**
 * Linki z zewnątrz → ekran Start z parametrem (zamiast osobnych ekranów poza zakładkami):
 * - `expeditionplan://auth/callback?code=…` — powrót z linku logowania z maila (PKCE),
 * - `expeditionplan://join/<token>` — zaproszenie do wyjazdu (link „otwórz w aplikacji” na webie).
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  try {
    const code = /[?&]code=([^&#]+)/.exec(path)?.[1];
    if (/auth\/callback/.test(path) && code) return `/?code=${code}`;
    const token = /join\/([A-Za-z0-9_-]+)/.exec(path)?.[1];
    if (token) return `/?join=${token}`;
    return path;
  } catch {
    return '/';
  }
}
