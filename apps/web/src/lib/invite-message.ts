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

/** Wiadomość o dostępie do kolejnego wyjazdu dla kogoś, kto już ma konto (bez linku zaproszenia). */
export function accessGrantedMessage(grant: { tripTitle: string; dates: string; role: string; origin: string; tripId: string; from?: string | undefined }): string {
  return [
    "Cześć!",
    `${grant.from ? `${grant.from} dodał(a)` : "Dodano"} Cię do wyjazdu „${grant.tripTitle}” (${grant.dates}) w Expedition Planner jako ${grant.role}.`,
    "",
    `Na webie: ${grant.origin}/trips/${grant.tripId} — zaloguj się tym samym mailem co zwykle.`,
    "Na telefonie wyjazd pojawi się sam na liście „Wyjazdy” po odświeżeniu.",
  ].join("\n");
}
