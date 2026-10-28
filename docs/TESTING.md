# TESTING — план и фактические результаты

## Окружение тестов
- Backend-тесты работают на **реальном PostgreSQL 16** (БД `notetaker_test`). Схема создаётся
  миграциями Alembic, каждый тест очищает таблицы.
- В среде разработки Docker недоступен, поэтому PostgreSQL запускается `scripts/dev-db.sh`.

## Команды
```bash
scripts/dev-db.sh start                       # PostgreSQL на 127.0.0.1:5433
cd backend && ../.venv/bin/pytest -q          # backend
cd frontend && npm test                       # vitest
cd frontend && npm run build                  # проверка типов + сборка
cd frontend && npm run e2e                    # Playwright: сам поднимает backend :8011 (БД notetaker_e2e) и Vite :5174
.venv/bin/python scripts/restart_check.py     # SIGKILL/рестарт реального процесса + SMTP-приёмник
```

## План тестирования

| Область | Тип | Что проверяем |
|---|---|---|
| Health/БД | API | `/api/health` проверяет соединение с БД |
| Заметки | API | CRUD, валидация (пустой заголовок, нет тегов, неверный TZ), активность, корзина, restore, purge |
| Теги | API | CRUD, уникальность без учёта регистра, цвет, запрет удаления единственного тега |
| Поиск/фильтры | API | поиск по title/body, теги (любой из), активность, период, сортировки, пагинация, total |
| Производительность | API | 5000 заметок, страница списка/поиск < 1 с |
| Повторения | unit | daily/weekly/monthly, until включительно, окно на границе, 31-е число, DST |
| Исключения | API | правка/удаление одного вхождения, правка серии сбрасывает overrides, корзина серии |
| Календарь | API+unit | окно вхождений, правила DnD-переноса; сетка месяца в TZ (vitest) |
| «Предстоящие» | API | категории при фиксированном `now` и разных TZ |
| Напоминания | API | отправка 1 раз; повторный скан; два параллельных сканера; «рестарт»; неактивная/удалённая — нет; смена TZ не меняет fire_at; пропущенные (D7) |
| WebSocket | API | два клиента получают одно событие с одним `delivery_id` |
| E2E | Playwright | создание заметки, поиск, календарь, DnD, две вкладки, уведомление (`npm run e2e`) |

## Фактические результаты
Заполняется после каждого прогона: дата/время, команда, итог.

| Время | Этап | Команда | Результат |
|---|---|---|---|
| 2026-10-28 12:32 | Э1 | `pytest -q` | 2 passed |
| 2026-10-28 12:32 | Э1 | `npm test` | 1 passed |
| 2026-10-28 12:31 | Э1 | `npm run build` | OK (после добавления `@types/node`) |
| 2026-10-28 12:31 | Э1 | `docker compose config -q` | OK; `docker compose up` не проверен — нет доступа к Docker |
| 2026-10-28 12:31 | Э1 | `curl :5173/api/health` (Vite → FastAPI → PG) | `{"status":"ok","database":"ok"}` |
| 2026-10-28 12:46 | Э2 | `pytest -q` | 16 passed (теги, заметки, корзина, настройки) |
| 2026-10-28 12:46 | Э2 | `npm test` | 4 passed |
| 2026-10-28 12:45 | Э2 | `npm run build` | OK |
| 2026-10-28 12:47 | Э3 | `pytest -q -s` | 29 passed; perf 5000 заметок: max 0.015 с на запрос |
| 2026-10-28 12:48 | Э3 | `npm test` / `npm run build` | 7 passed / OK |
| 2026-10-28 12:51 | Э5 | `pytest -q` | 54 passed (11 unit повторений + 14 API серий/исключений) |
| 2026-10-28 12:53 | Э5 | `npm run build` / `npm test` / `eslint` | OK / 7 passed / 0 проблем |
| 2026-10-28 13:10 | Э4 | `npm run e2e` (Playwright 1.64.1, Chromium) | 2 passed: создание тега/заметки через UI → поиск → календарь → DnD (дата меняется, время 15:30 Алматы сохраняется, в БД `10:30Z`); DnD вхождения серии переносит только его; перенос на день с другим вхождением → сообщение об ошибке 409 |
| 2026-10-28 13:11 | Э4 | `pytest -q` / `npm test` | 54 passed / 13 passed |
| 2026-10-28 13:16 | Э6 | `pytest -q` ×3 | 70 passed каждый раз (16 тестов напоминаний/WS) |
| 2026-10-28 13:17 | Э6 | `npm test` / `npm run build` / `eslint` | 16 passed / OK / 0 проблем |
| 2026-10-28 13:17 | Э6 | `npm run e2e` | 4 passed; в логе backend ровно 1 письмо `EMAIL to=me@example.com … Напомни мне` при 3 вкладках |
| 2026-10-28 13:20 | Э7 | `python scripts/restart_check.py` | RESULT: OK — после SIGKILL и двух рестартов 2 письма через SMTP, `(10,'sent',1)`, `(60,'sent',1)`, данные на месте (лог ниже) |
| 2026-10-28 13:20 | Э7 | `pytest -q` | 71 passed |
| 2026-10-28 13:21 | Э7 | `npm run e2e` | 3 passed / 2 failed: (а) 2 системных уведомления на 2 вкладки — дефект, исправлен; (б) «Сохранено» не видно — дефект UI, исправлен |
| 2026-10-28 13:23 | Э7 | `npm run e2e` ×3 | 5 passed каждый раз; по 1 письму на прогон |
| 2026-10-28 13:22 | Э7 | `npm test` | 17 passed |

Вывод `scripts/restart_check.py` (13:20):
```
[13:20:00] backend started pid=764096
[13:20:03] emails before kill: ['Напоминание: Restart demo — 28.10.2026 12:30']
[13:20:03] backend killed with SIGKILL; waiting 8 s (10-minute reminder fires during downtime)
[13:20:11] backend restarted pid=764285
[13:20:14] note after restart: title='Restart demo' reminders=[10, 60]
[13:20:14] emails after restart: ['Напоминание: Restart demo — 28.10.2026 12:30', 'Напоминание: Restart demo — 28.10.2026 12:30']
[13:20:18] emails after second restart: [... те же 2 письма ...]
[13:20:18] deliveries: [(10, 'sent', 1), (60, 'sent', 1)]
[13:20:18] RESULT: OK
```
