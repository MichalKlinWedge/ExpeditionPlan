# Integracja z Task Plannerem — kontrakt API

Stan: wersja 1.1 (27.11.2026), zaimplementowana po obu stronach (Task Planner: `D:\AI\PRIV\PRACA\Tasks`, Edge Function
`inbound-api`). TP przyjmuje więcej niż EP wysyła (statusy `in_progress` / `waiting`, opis do 20 000 znaków).

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
  `in_progress`.
- **Wyjątek dla statusu (uzgodnione z TP 27.11.2026):** `done` albo `cancelled` z EP zamyka zadanie, które w TP jest
  otwarte (`todo` / `in_progress` / `waiting`), nawet jeśli status zmieniono w TP. Zadania zamkniętego w TP EP nie
  zmienia. Przykład: w TP `in_progress`, EP wysyła `done` → `done`.
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
| 410 | zadanie z tym kluczem usunięto w TP na stałe; TP nie zakłada go od nowa | `task_exports.tp_deleted = true`, „usunięte w TP”, bez ponowień |
| 413 | treść > 64 KB | — |
| 429 | limit zapytań (≥ 60 na minutę na token); nagłówek `Retry-After` w sekundach | czeka i ponawia |
| 5xx | błąd TP | ponawia później |

## TP → EP: webhook

Konfiguracja w TP: Ustawienia → „Integracje” → połączenie **Webhook** na adres
`https://expedition-plan.vercel.app/api/taskplanner` z sekretem zapisanym też w Vault bazy EP (niżej) oraz reguła
zdarzeniowa:

- zdarzenia `task.completed`, `task.reopened`, `task.deleted`, `task.restored`,
- filtr: lista docelowa tokenu,
- „Także zadania z integracji” nie jest potrzebne: dotyczy zmian zrobionych przez integrację, a zamknięcie zadania przez użytkownika w TP nią nie jest.
  Gdy jest włączone, status wysłany przez EP wraca echem, a EP go pomija (stan już docelowy).

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

EP przy odbiorze (trasa `apps/web/src/app/api/taskplanner/route.ts` przekazuje surową treść i nagłówki do RPC
`taskplanner_webhook`, migracja `*_taskplanner_exports.sql`; klucz serwisowy nie jest potrzebny):

1. Sprawdza podpis na **surowej** treści sekretem z Vault (`taskplanner_webhook_secret`) i znacznik czasu w oknie ±5 min.
2. Szuka zadania po `task.id` w `task_exports` (zapisanym przy wysyłce); `task.source` jest tylko informacyjne.
3. Zdarzenia:
   - `task.completed` przy statusie TP `done` → `done`,
   - `task.reopened`, `task.restored` przy otwartym statusie TP → `open` (tylko gdy w EP jest `done`; `dropped` zostaje),
   - `task.deleted` → tylko `task_exports.tp_deleted`, status w EP bez zmian.
4. Idempotentnie po stanie: status już docelowy = nic. `Idempotency-Key` nie jest zapamiętywany.

Odpowiedzi EP (zgodne z regułami ponowień TP):

| Kod | Kiedy | Skutek w TP |
|---|---|---|
| 204 | przyjęte, także nieznane zadanie, powtórka albo brak zmiany | wysłane |
| 400 | znacznik czasu poza oknem albo zła treść | `failed`, bez ponowień |
| 401 | zły podpis (niezgodny sekret) | połączenie wyłączone, komunikat w Ustawieniach TP |
| 413 | treść > 256 KB | `failed` |
| 503 | brak sekretu w Vault EP | ponowienia 1 min … 12 h |
| 500 | błąd bazy EP | ponowienia |

Sekret w bazie EP (raz, w SQL Editorze projektu w chmurze; ta sama wartość co w połączeniu Webhook w TP):

```sql
select vault.create_secret('<sekret>', 'taskplanner_webhook_secret');
-- zmiana: select vault.update_secret((select id from vault.secrets where name = 'taskplanner_webhook_secret'), '<nowy>');
```

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

Domyślnie zaznaczone (`suggestedForPlanner`) są otwarte zadania bez osoby albo przypisane do mnie (moi uczestnicy
i dzieci pod opieką), jeszcze niewysłane; wysłać można dowolne.

Kod: `packages/core/src/taskplanner.ts` (`plannerKey`, `plannerTask`, schematy `PlannerTaskInput` / `PlannerTaskResult`),
`apps/web/src/lib/taskplanner.ts` (klient, jedno ponowienie po 429), `app/taskplanner-actions.ts` (`sendTasksToPlanner`
→ `task_exports`), karta `components/taskplanner-send.tsx` na stronie zadań (zwijana, bez „Edytuj”, bo nie zmienia
planu; wiersze mają kotwice `#zadanie-<ref>` dla linku z TP).

## Konfiguracja

EP, zmienne serwera (bez `NEXT_PUBLIC_`, przez `scripts/sync-env.mjs`, także na Vercelu): `TASKPLANNER_API_URL`,
`TASKPLANNER_TOKEN`, `TASKPLANNER_EMAILS` (konta EP, które widzą kartę i wysyłają; po przecinku). Sekret webhooka:
Vault bazy EP (wyżej).

TP: token z Ustawień → „Integracje” → „Token API” (z listą docelową), połączenie Webhook i reguła jak wyżej.

## Później

- Automatyczna wysyłka zmian z EP (trigger `pg_net` na `tasks` w bazie EP, łapie też zmiany z telefonu i
  `shiftTripDates`).
- `task.due_changed` z TP → `remindAt` w EP.
- Wyciszenie przypomnień telefonu EP dla zadań wysłanych do TP (do decyzji).
