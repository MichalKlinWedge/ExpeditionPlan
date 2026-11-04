/** Wiadomość z zaproszeniem dla jednej osoby: do skopiowania na stronie i do wysłania e-mailem. */
export function travelerInviteMessage(invite: { name: string; tripTitle: string; dates: string; origin: string; token: string; apkUrl?: string | undefined }): string {
  return [
    `Cześć ${invite.name}!`,
    `Zapraszam Cię do wyjazdu „${invite.tripTitle}” (${invite.dates}) w Expedition Planner — plan dzień po dniu, mapa i wspólne wydatki.`,
    "",
    `1. Otwórz link (tylko dla Ciebie, ważny 14 dni) i zaloguj się linkiem z maila: ${invite.origin}/join/${invite.token}`,
    invite.apkUrl
      ? `2. Aplikacja na telefon (Android): ${invite.apkUrl} — otwórz w Chrome, przy ostrzeżeniu wybierz „Zainstaluj mimo to” i zaloguj się tym samym mailem.`
      : "2. Link do aplikacji na telefon (Android) wyślę osobno.",
    `3. Jak to działa: ${invite.origin}/help`,
  ].join("\n");
}
