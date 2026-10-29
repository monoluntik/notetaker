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

## Итерация 3 (UI/UX, конкурентное редактирование, нагрузка)
| Время | Команда | Результат |
|---|---|---|
| 2026-10-28 14:36 | исходно: `pytest` / `npm test` / build / eslint / `npm run e2e` | 90 / 17 / OK / OK / 7 passed |
| ≈14:37 | скриншоты 8 экранов × 5 ширин | переполнения нет; 6–54 элемента < 32 px на экран |
| ≈14:40 | `pytest` (тест расхода sequence до исправления) | 1 failed: 40 тиков → 40 значений sequence |
| 14:41 | `pytest -q` ×2 | 103 passed (два клиента на каждом пути, 8 одновременных запросов, разделение серии) |
| ≈16:39 | `tsc -b`, `eslint`, `vitest` | после правок типов: OK, 23 passed |
| ≈16:40 | `npm run e2e` (после смены интерфейса) | 1 passed / 6 failed — устаревшие селекторы; обновлены на `data-testid` |
| ≈16:44 | `npm run e2e` ×2 | 15 passed ×2, по 1 письму |
| ≈16:46 | `docker compose up -d --build`, `restart backend frontend` | 4 сервиса Up, `0004 (head)`, контрольная сумма заметок одинакова |
| ≈16:47 | скриншоты контейнера 390/1440 (только чтение) | WebSocket онлайн, ошибок консоли 0 |
| 16:48 | e2e «два независимых браузера» | 1-я версия недетерминирована (fail), исправленная — passed |
| ≈16:51 | пилот 100k: `bench.py --quick` | «Предстоящие» 5.7 с, тик 2.1 с, месяц 0.8 с, поиск — seq scan |
| ≈16:55 | `pytest tests/test_sql_recurrence.py` | 5 passed (3600 сравнений SQL/Python, окна с исключениями) |
| ≈16:57 | пилот после исправлений | «Предстоящие» 88 мс, тик 22 мс, месяц 223 мс |
| 17:00 | `npm run e2e` | 16 passed, 1 письмо |
| 17:02 | миграция 0005 в Docker | `0005 (head)`, контрольная сумма одинакова |
| 17:24 | `bench.py` на 10M (прогон 1) | см. LOADTEST.md: смешанная нагрузка 6 запросов/с, 0 потерянных обновлений |
| 17:28 | `bench.py` на 10M (прогон 2) | 177 запросов/с, p50 60 мс, 0 потерянных обновлений |
| 17:30 | `bench.py` на 10M (прогон 3, расширенная смесь) | 36 запросов/с, 0 ошибок, 0 потерянных обновлений |
| 17:33 | `pytest -q` / `npm test` / build / eslint / `npm run e2e` ×2 | **112 passed / 23 passed / OK / OK / 16 passed ×2** |
| 17:33 | миграция 0006 в Docker + `restart backend` | `0006 (head)`, контрольная сумма одинакова до/после/после рестарта |

«≈» — время восстановлено по соседним точным отметкам (`date`, время коммитов), а не снято командой.

Не выполнялось: проверка на физических телефонах и с настоящими экранными дикторами (только
эмуляция мобильных устройств в Chromium); реальные системные уведомления браузера и письма в
интерфейсе Mailpit вручную не просматривались (в e2e уведомления подменены, письма — в логе
backend); Firefox/Safari не проверялись.

## Итерация 4 (слияние и подготовка к сдаче)
| Время | Команда | Результат |
|---|---|---|
| 2026-10-28 17:45 | приёмка: `pytest -q` / `vitest` / build / eslint / `alembic check` / e2e | 112 / 23 / OK / OK / OK / 16 passed |
| 17:52 | после `git merge` на master: то же + цикл миграций 0004↔0007 на тестовой БД | 112 / 23 / OK / OK / OK / 16 passed |
| 18:21 | пробы требований PDF (не закоммичены) | 2 failed (напоминания после активации/восстановления), e2e 1 failed (повтор уведомления после перезагрузки) |
| 18:27 | чистая копия: `docker compose -p notetaker-cleancheck … build --no-cache` и `up -d` | сборка 24 с, `0007 (head)`, `/api/health` ok |
| 18:28 | на чистом стеке: email через Mailpit, следующий тик, два клиента | 1 письмо, после тика по-прежнему 1; A 200 / B 409 |
| 18:32 | `pytest -q` | **117 passed** |
| 18:32 | `alembic heads`, `alembic check` | `0007 (head)`, No new upgrade operations detected |
| 18:33 | `npx vitest run` / `npm run build` / `npx eslint src e2e` | **25 passed** / OK / 0 проблем |
| 18:33 | `npx playwright test` | **17 passed**, 1 письмо в логе |
| 18:34 | `python scripts/restart_check.py` | RESULT: OK |
| 18:32–18:34 | контрольная сумма основной БД до/после прогона | одинаковая (`4d7212b5…`) |

## Итерация 5 (исправления по внешней проверке, 2026-10-29)
Отдельный временный PostgreSQL 16 на :55433 (`NOTETAKER_TEST_DATABASE_URL`, `E2E_DATABASE_URL`).

| Время | Команда | Результат |
|---|---|---|
| 06:35 | `pytest -q` до изменений | 117 passed |
| 06:38 | `pytest tests/test_reminders.py` / `npx vitest run` / `npm run lint` / `tsc -b` | 48 passed / 34 passed / 0 проблем / OK |
| 06:40 | новые тесты D20 без исправления (код откатан через `git stash`) | 4 failed, 3 passed |
| 06:40 | они же с исправлением | 7 passed |
| 06:41 | `pytest -q` | **136 passed** |
| 06:41 | `alembic upgrade head` на чистой БД, `alembic check`, `downgrade 0007` → `upgrade head` | OK, No new upgrade operations detected |
| 06:42 | `npx playwright test` | **17 passed** |
| 06:42 | `python scripts/restart_check.py` | RESULT: OK |
| 06:42 | `npm run build` / `npx eslint src e2e` | OK / 0 проблем |
| 07:34 | `pytest -q` (необязательные теги, Idempotency-Key) | **138 passed** |
| 07:34 | `alembic upgrade head` на чистой БД (до 0009), `alembic check`, `downgrade 0007` → `upgrade head` | OK, No new upgrade operations detected |
| 07:34 | `npx vitest run` / `npm run build` / `npx eslint src e2e` | **34 passed** / OK / 0 проблем |
| 07:35 | `npx playwright test` (новый сценарий: стопка уведомлений) | **18 passed** |
| 07:36 | `python scripts/restart_check.py` | RESULT: OK |

