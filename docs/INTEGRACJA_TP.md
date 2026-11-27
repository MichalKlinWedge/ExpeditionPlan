# Integracja z Task Plannerem — kontrakt API

Stan: wersja 1 (27.11.2026), do potwierdzenia przez stronę Task Plannera (`D:\AI\PRIV\PRACA\Tasks`).

## Cel i przepływ

- **EP → TP:** EP wysyła zadania wyjazdu (`tasks`) do Task Plannera i aktualizuje je przy kolejnych wysyłkach. TP
  przyjmuje je przez Edge Function `inbound-api` z tokenem osobistym.
- **TP → EP:** zamknięcie lub ponowne otwarcie zadania w TP wraca do EP przez istniejący plugin Webhook TP (reguła
  zdarzeniowa) na trasę EP `POST /api/taskplanner`.
- Projekty Supabase i konta są osobne. Łącznikiem jest token osobisty TP (EP → TP) i sekret webhooka (TP → EP).
- Odrzucone nośniki: e-mail → Inbox (wymaga domeny), Kalendarz Google (nie przenosi statusu ani zadań bez godziny,
  EP nie ma OAuth Google).

## Klucz zewnętrzny

`ep:<tripId>:<taskRef>` — `tripId` = UUID wyjazdu w EP, `taskRef` = `tasks.ref` (`[a-z0-9][a-z0-9-]*`).
Przykład: `ep:0193a0c4-7d2e-7f00-9c1a-2b3c4d5e6f70:kupic-bilety`. W ścieżce zawsze przez `encodeURIComponent`.

TP wyznacza z klucza deterministyczne id zadania (UUIDv5 we własnej przestrzeni nazw), więc powtórzona wysyłka nigdy
nie tworzy duplikatu.

## EP → TP: `inbound-api`

Adres bazowy: `{TASKPLANNER_API_URL}` = `https://<projekt-tp>.supabase.co/functions/v1/inbound-api`.

Nagłówki każdego zapytania:

```
Authorization: Bearer <token>
Content-Type: application/json; charset=utf-8
User-Agent: ExpeditionPlan/1.0
```

Token jest dla EP nieprzezroczystym napisem. TP trzyma tylko jego hash; token wskazuje konto i listę docelową
i daje dostęp wyłącznie do zadań z kluczem zewnętrznym utworzonych przez ten token.

### `PUT /tasks/{key}` — utwórz albo zaktualizuj

```json
{
  "title": "Kupić bilety na prom",
  "description": "Markdown…\n\n[Otwórz w Expedition Plan](https://…/trips/<id>/tasks#kupic-bilety)",
  "status": "todo",
  "priority": 2,
  "startDate": "2026-12-10",
  "dueDate": "2026-12-14",
  "dueTime": "18:00",
  "timeZone": "Europe/Warsaw",
  "tags": ["wyjazd", "Maroko 2026"],
  "source": { "kind": "expeditionplan", "tripId": "…", "ref": "kupic-bilety", "url": "https://…/trips/<id>/tasks" }
}
```

| Pole | Typ | Uwagi |
|---|---|---|
| `title` | string 1–500 | wymagane |
| `description` | string ≤ 10 000, Markdown | |
| `status` | `todo` / `done` / `cancelled` | EP nie wysyła `in_progress` ani `waiting` |
| `priority` | 1–4 | 1 krytyczny, 2 wysoki, 3 średni, 4 niski |
| `startDate`, `dueDate` | `RRRR-MM-DD` | daty lokalne |
| `dueTime` | `GG:MM` | tylko razem z `dueDate` |
| `timeZone` | IANA | strefa dla `dueTime`; bez niej strefa z ustawień TP |
| `tags` | string[] ≤ 20 | nazwy tagów osobistych; brakujący tag TP zakłada |
| `source` | obiekt | wymagane; `kind` zawsze `expeditionplan`, `ref` i `tripId` zgodne z kluczem |

Semantyka pól:

- **Pole nieobecne** = EP nim nie zarządza: TP go nie zmienia i nie zapisuje w stanie zgodności.
- **`null`** = wyczyść (np. `dueDate: null` usuwa termin).
- **Scalanie trójstronne:** TP pamięta rzut ostatniej przyjętej wysyłki (`pushed`). Pole nadpisuje tylko wtedy, gdy
  wartość w TP nadal równa się `pushed`, czyli użytkownik nie zmienił jej w TP. Zmienione w TP zostaje (`kept`).
  Przykład: EP wysłał `todo`, użytkownik dał w TP `in_progress`, EP znów wysyła `todo` → status zostaje
  `in_progress`. EP wysyła `done` → TP ustawia `done`, bo to zmiana po stronie EP.
- **Tagi:** scalanie dotyczy tylko tagów, które przyszły z EP. Tagów dodanych przez użytkownika w TP EP nigdy nie zdejmuje.
- **Zadanie w koszu TP** nie jest zmieniane ani przywracane; odpowiedź ma `deleted: true`.
- Zmiana z API idzie w TP z `origin = 'integration'`.
- Usunięcie zadania w EP = wysyłka ze `status: "cancelled"`. API v1 nie ma `DELETE`.

Odpowiedź `201` (utworzone) albo `200` (zaktualizowane lub bez zmian):

```json
{
  "id": "<uuid zadania w TP>",
  "key": "ep:…:kupic-bilety",
  "created": true,
  "status": "todo",
  "deleted": false,
  "url": "https://<web-tp>/?task=<uuid>",
  "applied": ["title", "status", "dueDate"],
  "kept": ["priority"]
}
```

### `GET /tasks/{key}` — stan zadania

`200` z tym samym kształtem (`created: false`, `applied: []`, `kept: []`) albo `404`, gdy zadania z tym kluczem nie ma.

### Błędy

Treść: `{ "error": "<komunikat po polsku>", "details"?: [...] }`.

| Kod | Kiedy | EP robi |
|---|---|---|
| 400 | błąd walidacji (`details` = ścieżki Zod), klucz niezgodny z `source` | pokazuje błąd, bez ponowień |
| 401 | brak, zły albo odwołany token | „Połącz z Task Plannerem od nowa” |
| 403 | konto tokenu straciło prawo edycji listy docelowej | komunikat |
| 404 | `GET` nieznanego klucza | traktuje jako niewysłane |
| 413 | treść > 64 KB | — |
| 429 | limit zapytań (≥ 60 na minutę na token); nagłówek `Retry-After` w sekundach | czeka i ponawia |
| 5xx | błąd TP | ponawia później |

## TP → EP: webhook

Konfiguracja w TP: Ustawienia → „Integracje” → połączenie **Webhook** na adres
`https://expedition-plan.vercel.app/api/taskplanner` z sekretem `TASKPLANNER_WEBHOOK_SECRET` oraz reguła zdarzeniowa:

- zdarzenia `task.completed`, `task.reopened`, `task.deleted`, `task.restored`,
- filtr: lista docelowa tokenu,
- **„Także zadania z integracji” włączone**, bo zadania z EP są w TP zadaniami z integracji.

Nagłówki (plugin Webhook TP, `_shared/plugins/webhook.ts`):

```
Idempotency-Key: <id wysyłki>          (= X-TaskPlanner-Delivery)
X-TaskPlanner-Event: task.completed
X-TaskPlanner-Timestamp: <sekundy unix>
X-TaskPlanner-Signature: sha256=<hex HMAC-SHA256(sekret, "<timestamp>.<surowa treść>")>
```

Treść = `PluginPayload` TP z jednym dodatkiem: **`task.source`** (obiekt `source` zadania albo `null`).

```json
{
  "id": "<id wysyłki>",
  "event": "task.completed",
  "events": ["task.completed"],
  "sentAt": "2026-12-12T09:15:02.000Z",
  "rule": { "id": "…", "name": "Do Expedition Plan" },
  "task": {
    "id": "<uuid>", "title": "…", "status": "done", "completedAt": "…",
    "dueDate": "2026-12-14", "dueTime": "18:00", "url": "https://…/?task=<uuid>",
    "source": { "kind": "expeditionplan", "tripId": "…", "ref": "kupic-bilety", "url": "…" }
  },
  "fields": { }
}
```

EP przy odbiorze:

1. Sprawdza podpis na **surowej** treści (porównanie w stałym czasie) i znacznik czasu w oknie ±5 min.
2. Pomija powtórzony `Idempotency-Key`.
3. Szuka zadania po `task.source` (`kind = expeditionplan`), a bez niego po `task.id` w `task_exports`.
4. Zdarzenia:
   - `task.completed` → `done`,
   - `task.reopened`, `task.restored` → `open` (tylko gdy w EP jest `done`; `dropped` zostaje),
   - `task.deleted` → tylko oznaczenie w `task_exports`, status w EP bez zmian.

   Status w EP nie zmienia się, gdy już jest docelowy.

Odpowiedzi EP (zgodne z regułami ponowień TP):

| Kod | Kiedy | Skutek w TP |
|---|---|---|
| 204 | przyjęte, także nieznane zadanie, powtórka albo brak zmiany | wysłane |
| 400 | znacznik czasu poza oknem albo zła treść | `failed`, bez ponowień |
| 401 | zły podpis (niezgodny sekret) | połączenie wyłączone, komunikat w Ustawieniach TP |
| 5xx | błąd bazy EP | ponowienia 1 min … 12 h |

## Mapowanie zadania EP → TP

| EP (`DocTask`) | TP |
|---|---|
| `title` | `title` |
| `body`, `answer`, kontekst (rezerwacja, punkt), link do EP | `description` (Markdown) |
| `status`: `open` / `done` / `dropped` | `todo` / `done` / `cancelled` |
| `priority`: `high` / `normal` / `low`, brak | 2 / 3 / 4, pole nieobecne |
| `due` przeliczony przez `taskDueDate` | `startDate`, gdy jest też `deadline`; inaczej `dueDate` |
| `deadline` | `dueDate` |
| `due.time` (absolutny, `on_trip`) | `dueTime` + `timeZone` strefy dnia wyjazdu |
| `kind`: `question` / `decision` | tag `pytanie` / `decyzja` |
| — | tagi `wyjazd` i tytuł wyjazdu bez prefiksu |

Wysyłane są zadania przypisane do konta EP z `TASKPLANNER_EMAIL` (jego uczestnika) albo bez osoby.

## Konfiguracja

EP, zmienne serwera (bez `NEXT_PUBLIC_`, przez `scripts/sync-env.mjs`, także na Vercelu): `TASKPLANNER_API_URL`,
`TASKPLANNER_TOKEN`, `TASKPLANNER_WEBHOOK_SECRET`, `TASKPLANNER_EMAIL`.

TP: token z Ustawień → „Integracje” → „Token API” (z listą docelową), połączenie Webhook i reguła jak wyżej.

## Później

- Automatyczna wysyłka zmian z EP (trigger `pg_net` na `tasks` w bazie EP, łapie też zmiany z telefonu i
  `shiftTripDates`).
- `task.due_changed` z TP → `remindAt` w EP.
- Wyciszenie przypomnień telefonu EP dla zadań wysłanych do TP (do decyzji).
