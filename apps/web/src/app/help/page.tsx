import type { Metadata } from "next";
import Link from "next/link";

import { Shell } from "@/components/shell";

/**
 * „Jak korzystać” — instrukcja dla organizatora i uczestników: start z zaproszenia, planowanie
 * na webie, telefon w trasie, role. Publiczna (bez logowania), bo czytają ją też osoby przed
 * założeniem konta; telefon otwiera ją z ekranu powitalnego i z Ustawień.
 */

export const metadata: Metadata = { title: "Jak korzystać — Expedition Planner" };

const SECTIONS = [
  { id: "start", title: "Na start: zaproszenie i konto" },
  { id: "planowanie", title: "Planowanie na webie" },
  { id: "telefon", title: "W trasie: aplikacja na telefonie" },
  { id: "role", title: "Kto co może" },
  { id: "pytania", title: "Częste pytania" },
] as const;

function Section({ id, children }: { id: (typeof SECTIONS)[number]["id"]; children: React.ReactNode }) {
  const title = SECTIONS.find((each) => each.id === id)!.title;
  return (
    <section id={id} className="flex scroll-mt-4 flex-col gap-3">
      <h2 className="font-display text-xl font-semibold">{title}</h2>
      {children}
    </section>
  );
}

/** Krok z nazwą miejsca w aplikacji (pogrubione) i opisem. */
function Step({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <li>
      <strong>{name}</strong> — {children}
    </li>
  );
}

export default function HelpPage() {
  return (
    <Shell>
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold">Jak korzystać</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Expedition Planner to dwie części: <strong>Planner Hub</strong> w przeglądarce (ta strona) do planowania przed wyjazdem i aplikacja <strong>Expedition Planner</strong> na
          Androida do korzystania z planu w trasie — także bez internetu. Obie widzą ten sam wyjazd; zmiana w jednej po chwili jest w drugiej.
        </p>
      </div>

      <nav className="card flex flex-col gap-1 p-4 text-sm">
        <span className="text-xs text-zinc-500">Spis treści</span>
        {SECTIONS.map((each) => (
          <a key={each.id} href={`#${each.id}`} className="underline-offset-2 hover:text-sea hover:underline">
            {each.title}
          </a>
        ))}
      </nav>

      <div className="flex flex-col gap-8 text-sm leading-relaxed [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5 [&_li]:mt-1">
        <Section id="start">
          <ol>
            <Step name="Link zaproszenia">
              dostajesz go od organizatora. Otwórz go (najlepiej na telefonie) i zaloguj się <strong>linkiem z maila</strong> — tak powstaje konto. Potem „Dołącz do wyjazdu”. Link
              działa 14 dni i tylko dla tylu osób, dla ilu go utworzono.
            </Step>
            <Step name="Aplikacja na telefon">
              organizator wysyła też link do pliku APK. Otwórz go w Chrome na telefonie, zezwól na instalację z tego źródła, a gdy Play Protect ostrzeże — „Zainstaluj mimo to”.
            </Step>
            <Step name="Logowanie w aplikacji">
              tym samym adresem e-mail (link z maila albo Google z tym samym adresem). Wyjazd pojawi się w zakładce <em>Wyjazdy</em>.
            </Step>
            <Step name="Przed wyjazdem, z internetem">
              na karcie wyjazdu w telefonie naciśnij <em>Pobierz wyjazd offline</em> — plan, mapa okolicy, dokumenty i opisy miejsc zostaną w telefonie.
            </Step>
          </ol>
        </Section>

        <Section id="planowanie">
          <p>Strona wyjazdu to kafelki — każdy prowadzi do jednej części planu. U góry „Co nowego” pokazuje, co zmienili inni od Twojej ostatniej wizyty.</p>
          <ul>
            <Step name="Brief i „Zaplanuj z AI”">
              kto jedzie, dokąd, w jakim tempie. Z briefu AI robi <em>szkic</em> jako osobny wyjazd „Szkic AI: …”; w <em>Porównaniu ze szkicem</em> przenosisz do prawdziwego planu tylko
              to, co Ci pasuje. AI nigdy niczego nie nadpisuje po cichu.
            </Step>
            <Step name="Plan dzień po dniu">
              punkty z godzinami, przejazdami, wschodem i zachodem słońca oraz mapą. Godziny liczą się same z czasów trwania i przejazdów; „Edytuj” pozwala dodawać, przesuwać i usuwać
              punkty. ⚠ przy dniu oznacza złą prognozę dla punktów na zewnątrz.
            </Step>
            <Step name="Pula">
              pomysły, których nie ma w żadnym dniu („+ Dodaj do puli”). Można je grupować, filtrować (z opisem, koniecznie, bez miejsca na mapie) i w każdej chwili wstawić do dnia.
            </Step>
            <Step name="Karta punktu">
              opis, ceny, linki, opis przewodnika z Wikipedii (📖 przy punkcie znaczy, że opis już jest) i trasa pieszo: link z mapy.com (🗺 w planie dnia) z długością i czasem przepisanymi z mapy, od których liczą się godziny dnia. Plik GPX sam wypełnia długość, czas i podejście oraz rysuje dokładny przebieg na mapie planu.
            </Step>
            <Step name="Miejsca">
              wszystkie miejsca planu z listą tego, co z nich korzysta. Organizator i edytor poprawią tu nazwę, adres i współrzędne (wklejone, wskazane na mapie albo znalezione po nazwie), także gdy automat postawił pinezkę w złym miejscu. Zmiana obowiązuje wszędzie, gdzie miejsce jest użyte, a czasy przejazdów trzeba potem przeliczyć w planie.
            </Step>
            <Step name="Rezerwacje i budżet">
              noclegi, auta, bilety ze statusem (do zarezerwowania → zarezerwowane → opłacone; anulowane można usunąć z listy), plan budżetu i wydatki z trasy, także plan a wydatki dzień po dniu.
            </Step>
            <Step name="Zadania, posiłki, lista zakupów, kontakty">
              co trzeba zrobić przed wyjazdem, kto gotuje i dla ilu osób, wspólne zakupy, gospodarze i numery alarmowe.
            </Step>
            <Step name="Sejf dokumentów">bilety, vouchery i kody QR — w telefonie dostępne offline.</Step>
            <Step name="Uczestnicy i dostęp">
              lista jadących, linki zaproszeń (widz albo edytor) i — dla organizatora — kto dołączył, kiedy ostatnio był w aplikacji i zmiana dostępu.
            </Step>
            <Step name="Kalendarz, wydruk, eksport">
              plan do Google/Apple Calendar (link ICS), wersja do druku/PDF i kopia całego planu w JSON.
            </Step>
            <Step name="Pamiątka z wyjazdu">
              od pierwszego dnia wyjazdu: liczby (punkty, kilometry, wydatki), mapa trasy, dziennik ze zdjęciami dzień po dniu i rozliczenie — także do druku/PDF. Minione wyjazdy są w
              „Archiwum” pod listą wyjazdów.
            </Step>
            <Step name="Wyjazdy odłożone">
              termin niepewny albo wyjazd nie wypalił? „Odłóż wyjazd” na jego stronie przenosi go do osobnej sekcji „Odłożone” (nie do archiwum). Plan można dalej układać, a daty są tylko orientacyjne:
              telefon nie odlicza dni i nie przypomina. „Przywróć do planów” cofa to w każdej chwili. Gdy termin już minął, przywrócenie najpierw proponuje nową datę.
            </Step>
            <Step name="Zmiana terminu">
              „Zmień termin” na stronie wyjazdu przesuwa cały plan o tę samą liczbę dni, a długość zostaje. Podgląd przed zapisem pokazuje, co pójdzie z planem (dni, niekupione rezerwacje, terminy zadań i decyzji) i co trzeba sprawdzić samemu:
              kupione rezerwacje zostają przy swoich datach, bo zmienia się je u dostawcy.
            </Step>
          </ul>
        </Section>

        <Section id="telefon">
          <p>Na dole aplikacji jest pięć zakładek:</p>
          <ul>
            <Step name="Start">statystyki wyjazdów, pogoda przed najbliższym wyjazdem, logowanie i ⚙︎ Ustawienia (konto, przypomnienia, wersja).</Step>
            <Step name="Wyjazdy">Twoje wyjazdy i „Pobierz wyjazd offline”.</Step>
            <Step name="Plan">
              plan dnia z godzinami liczonymi na telefonie. Karta „Teraz” w dniu wyjazdu: <em>✓ Zrobione</em>, <em>+15 min</em> / <em>+30 min</em> (zostajemy dłużej — reszta dnia się
              przesuwa), <em>Pomiń</em>. Niżej zakładki <em>Wydatki</em> (także 📷 paragon — AI odczyta kwotę), <em>Pakowanie</em>, <em>Zadania</em>, <em>Dziennik</em> ze zdjęciami i{" "}
              <em>Info</em>. Chip <em>Pula</em> pokazuje pomysły spoza dni.
            </Step>
            <Step name="Mapa">
              punkty dnia na mapie działającej offline, <em>Nawiguj</em> otwiera Google Maps. „Pula” dokłada szare pinezki pomysłów; długie przytrzymanie mapy dodaje nowy punkt do puli.
            </Step>
            <Step name="Spacer">
              spacer z przewodnikiem: telefon powiadomi, gdy będziesz przy opisanym miejscu, i przeczyta opis na głos (działa przy wygaszonym ekranie).
            </Step>
          </ul>
          <p>
            Bez zasięgu wszystko działa na danych z telefonu; wydatki, pakowanie i dziennik zapisane offline wyślą się same, gdy wróci internet. Zmiany planu (edycja, wstawianie z
            puli) wymagają połączenia.
          </p>
        </Section>

        <Section id="role">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-left">
              <thead className="text-xs text-zinc-500">
                <tr>
                  <th className="py-1 pr-3 font-normal">Rola</th>
                  <th className="py-1 font-normal">Co może</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-zinc-200 align-top dark:border-zinc-800">
                  <td className="py-1.5 pr-3 font-medium">Organizator</td>
                  <td className="py-1.5">wszystko: plan, AI, zaproszenia, zmiana i odbieranie dostępu, statystyki uczestników.</td>
                </tr>
                <tr className="border-t border-zinc-200 align-top dark:border-zinc-800">
                  <td className="py-1.5 pr-3 font-medium">Edytor</td>
                  <td className="py-1.5">zmienia plan, rezerwacje, zadania i listy; dodaje wydatki.</td>
                </tr>
                <tr className="border-t border-zinc-200 align-top dark:border-zinc-800">
                  <td className="py-1.5 pr-3 font-medium">Widz</td>
                  <td className="py-1.5">ogląda plan i korzysta z niego w trasie, pisze dziennik; wydatki dodaje, jeśli organizator na to pozwolił. Swoje pakowanie odhacza, gdy organizator przypisze jego konto do uczestnika.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Section>

        <Section id="pytania">
          <ul>
            <Step name="Nie widzę wyjazdu w aplikacji">sprawdź, czy jesteś zalogowany tym samym adresem co na webie, i naciśnij „Odśwież”.</Step>
            <Step name="Aktualizacje">przychodzą same — aplikacja pokaże znaczek nowej wersji i zaproponuje restart. Czasem trzeba zainstalować nowy APK z linku od organizatora.</Step>
            <Step name="Mapa bez internetu jest pusta">przed wyjazdem pobierz wyjazd offline (zakładka Wyjazdy), najlepiej przez Wi-Fi.</Step>
            <Step name="Godziny w planie">to „nie wcześniej niż” — w czasie lokalnym miejsca, do którego jedziesz, nie w czasie telefonu.</Step>
            <Step name="Kto widzi moje dane">tylko członkowie wyjazdu. Publiczny link podglądu (jeśli organizator go utworzy) nigdy nie pokazuje sejfu dokumentów, a koszty, nazwiska i adres noclegu organizator może ukryć.</Step>
          </ul>
        </Section>
      </div>

      <Link href="/" className="self-start text-sm text-zinc-500 underline hover:text-sea">
        ← Wyjazdy
      </Link>
    </Shell>
  );
}
