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

## Итерация 2 (ветка `improve/notetaker-compliance`)
| Время | Команда | Результат |
|---|---|---|
| 2026-10-28 13:47 | `pytest -q` / `npm test` (исходно) | 71 passed / 17 passed |
| 2026-10-28 13:48 | `pytest tests/test_probe_compliance.py` | 5 failed (подтверждённые дефекты), 2 passed |
| 2026-10-28 13:50 | `pytest -q -s tests/test_upcoming.py` | 7 passed; 5000 прошедших + серия 2 года: 0.24 с |
| 2026-10-28 13:54 | `pytest -q` | 87 passed (пробы заменены постоянными тестами) |
| 2026-10-28 13:56 | `npm run e2e` ×3 | 1-й запуск: 6 passed / 1 failed (локатор теста при общей БД); после исправления 7 passed ×3, 1 письмо на прогон |
| 2026-10-28 13:58 | EXPLAIN ANALYZE, 20 000 заметок | список 3 мс, поиск с подзапросом 12 мс, тег+период 0.4 мс, кандидаты автоочистки 0.1 мс, сортировка по изменению 7 мс |
| 2026-10-28 13:59 | `pytest -q` ×3 | 90 passed каждый раз |
| 2026-10-28 13:59 | `npm test` / `npm run build` / `eslint src e2e` | 17 passed / OK / OK |
| 2026-10-28 13:59 | `npm run e2e` ×3 | 7 passed каждый раз, по 1 письму |
| 2026-10-28 14:00 | `python scripts/restart_check.py` | RESULT: OK (SIGKILL + 2 рестарта, 2 письма, `(10,'sent',1)`, `(60,'sent',1)`) |
| 2026-10-28 14:00 | `docker compose config -q` | OK |
| 2026-10-28 14:00 | `docker compose ps` | **не выполнено**: permission denied на `docker.sock` |

Новые тесты итерации 2: `test_list.py::test_search_matches_edited_occurrence`;
`test_upcoming.py::test_overdue_has_no_hidden_cutoff`, `::test_overdue_performance`;
`test_reminders.py::test_pending_email_cancelled_when_note_changed` (4 случая),
`::test_pending_email_cancelled_for_deleted_occurrence`, `::test_pending_email_still_sent_after_unrelated_edit`,
`::test_restored_note_resumes_reminders`, `::test_reactivated_note_gets_reminders`,
`::test_email_failures_are_logged_with_context`, `::test_missed_reminders_are_logged`,
`::test_scheduler_survives_failing_stage_and_logs_it`;
`test_notes.py::test_trash_autopurge_after_retention_period`, `::test_trash_autopurge_respects_configured_retention`,
`::test_concurrent_edit_with_stale_version_is_rejected`, `::test_simultaneous_edits_exactly_one_wins`,
`::test_version_changes_on_trash_restore_and_occurrence_edits`; vitest `upcoming.test.ts` (итог прошедших);
e2e `conflict.spec.ts` (2 сценария).
