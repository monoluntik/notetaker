# Сдача: «Задания Agentic Developer», задание 1 — Notetaker

Источник требований — PDF «Задания Agentic Developer» (разделы «Требования», «Что мы ожидаем
от вас», «Задание 1. Notetaker»). `TASK.md` в репозитории — развёрнутая постановка, с которой
началась работа. Статусы ниже подтверждены прогонами от 2026-10-28 (см. `docs/TESTING.md`).

## Что мы ожидаем от вас

| # | Пункт | Ответ |
|---|---|---|
| 1 | Ссылка на репозиторий | https://github.com/monoluntik/notetaker |
| 2 | Чем делали: модель, инструмент, почему | **Claude Code** (CLI в терминале) с моделью **Claude Opus 5.5** (`claude-opus-5-5`). Claude Code работает прямо с файлами, git, Docker и тестами, поэтому агент сам запускает проверки и видит реальный результат, а не только пишет код; Opus 5.5 — самая сильная из доступных моделей для длинной многошаговой работы (план → код → тесты → исправления). Claude Code был задан в постановке (`TASK.md`). *Автору стоит подтвердить или дополнить формулировку своими причинами.* |
| 3 | Промпты, лог решений или экспорт сессии | Промпты дословно — [`docs/PROMPTS.md`](PROMPTS.md); лог решений — [`docs/DECISIONS.md`](DECISIONS.md) (D1–D19); журнал разработки — [`docs/WORKLOG.md`](WORKLOG.md). Экспорт сессий — см. раздел ниже. |
| 4 | Ход работы во времени | История git (`master`), по этапам: 32 коммита 2026-10-28 с 12:32 до 18:39 (+06) и исправления по внешней проверке 2026-10-29 с 06:38 (итерация 5); журнал с отметками времени — `docs/WORKLOG.md`; результаты прогонов с временем — `docs/TESTING.md`. Перерыв во второй сессии (лимиты использования) отмечен в журнале. |
| 5 | Описание проекта: как развернуть и в каком он состоянии | [`README.md`](../README.md): требования, запуск в Docker, остановка, тесты, состояние, ограничения. |
| 6 | Что сделали бы следующим заходом | README, раздел «Что сделали бы следующим заходом». |
| 7 | Чужое решение, шаблон или генератор | Frontend создан официальным шаблоном Vite (`npm create vite@6.5.0 -- --template react-ts`), затем переписан. Backend написан с нуля. Для локальной БД без Docker используется pip-пакет `pixeltable-pgserver` (бинарники PostgreSQL). Готовых решений Notetaker или сторонних шаблонов приложения не использовалось. Весь код и документацию написал ИИ-агент по промптам человека. |

### Экспорт сессии
Полные журналы двух сессий Claude Code лежат у автора локально:
`~/.claude/projects/-home-rme-Projects-Notetaker/86cbd04c-6dab-4f5d-a965-fbd90d3bf65d.jsonl` (сессия 1)
и `…/6bfd03f1-853d-44e5-8b4d-667b0738aaa1.jsonl` (сессия 2). В репозиторий они **не добавлены**:
в них есть служебный контекст окружения, в том числе адрес почты аккаунта. Задание допускает
вместо экспорта лог решений или журнал разработки — они есть (`PROMPTS`, `DECISIONS`,
`WORKLOG`). Если экспорт нужен, его можно получить командой `/export` в Claude Code и приложить
после просмотра.

## Соответствие общим требованиям

| Требование | Реализация | Доказательство | Статус |
|---|---|---|---|
| 1. Клиент-сервер: отдельные backend и frontend по сети | FastAPI (`backend/`) и React SPA (`frontend/`), REST + WebSocket; в Docker — отдельные контейнеры, nginx проксирует `/api`, `/ws` | `docker-compose.yml`; e2e ходят через HTTP/WS | выполнено |
| 2. Backend: Python / Go / Node.js | Python 3.12, FastAPI, SQLAlchemy, Alembic | `backend/requirements.txt`; выбор — `DECISIONS.md` D1 | выполнено |
| 3. Frontend: Vue или React | React 19 + TypeScript | `frontend/package.json` | выполнено |
| 4. Реляционная СУБД, желательно PostgreSQL | PostgreSQL 16, миграции 0001–0007 | `alembic check`; pytest на реальном PostgreSQL | выполнено |
| 5. Учётные записи — на усмотрение | Без входа: одно рабочее пространство (`DECISIONS.md` D3) | README, «Ограничения» | выполнено (решение описано) |
| 6. Промпты или лог решений вместе с кодом | `docs/PROMPTS.md`, `DECISIONS.md`, `WORKLOG.md` | файлы в репозитории | выполнено |
| 7. Использование AI-агентов | Весь проект сделан Claude Code | `PROMPTS.md`, `WORKLOG.md`, подписи Co-Authored-By в коммитах | выполнено |
| 8. Предварительные требования описаны | README: Docker + Compose v2, порты; для локального режима — Python 3.12, Node ≥ 20, PostgreSQL 16 | README | выполнено |
| 9. Быстрый локальный запуск | `docker compose up --build -d` | чистая копия из коммита, отдельный проект и порты: сборка без кэша 24 с, миграции до `0007`, все сервисы Up (2026-10-28 18:27) | выполнено ¹ |
| 10. Внешние сервисы — эмуляция | Почта — Mailpit (SMTP-эмулятор) | на чистом стеке письмо-напоминание пришло в Mailpit, после следующего тика писем по-прежнему одно (18:28) | выполнено |
| 11. Работает при двух открытых клиентах | WebSocket-синхронизация, проверка версий | e2e: две вкладки, два независимых браузера; pytest `test_concurrency.py` | выполнено |
| 12. Честное описание состояния | README «Состояние проекта», `LOADTEST.md` «Что остаётся медленным», `TESTING.md` «Не выполнялось» | — | выполнено |
| 13. Доказуемость | pytest 138, vitest 34, e2e 18, `restart_check.py`, нагрузочный стенд | `docs/TESTING.md` | выполнено |

¹ Базовые образы (python, node, nginx, postgres) уже были на машине и заново не скачивались;
проверка на машине без них не проводилась.

## Задание 1. Notetaker — «Должен включать»

| Требование | Реализация | Доказательство | Статус |
|---|---|---|---|
| Заметки: заголовок, текст, дата и время, теги, статус; создание, редактирование, удаление, активация/деактивация | `services/notes.py`, `/api/notes`, редактор | `test_create_and_get_note_has_all_fields`, `test_update_note_and_toggle_active`; e2e «create tag and note via UI…» | выполнено |
| Удалённые попадают в корзину и восстанавливаются | мягкое удаление `deleted_at`, `/restore`, «Корзина» | `test_trash_restore_purge`, `test_empty_trash` | выполнено |
| Теги: создание, переименование, удаление, цвет; несколько у заметки | `services/tags.py`, страница «Теги» с палитрой | `test_tag_crud`, `test_delete_tag_unlinks_it_from_notes`, `test_note_without_tags` | выполнено ² |
| Повторения: ежедневно, еженедельно, ежемесячно, дата окончания | `services/recurrence.py` + SQL-функции (миграция 0005) | 11 unit-тестов повторений, `test_sql_recurrence.py` (3600 сверок SQL с Python) | выполнено |
| Отдельное вхождение изменить или удалить, не трогая остальные | `occurrence_overrides`, «Только это вхождение» | `test_edit_single_occurrence_only`, `test_delete_single_occurrence_and_restore_it`; e2e перетаскивания вхождения | выполнено |
| Напоминания: одно или несколько (10 мин, 1 ч, 1 день) | `note_reminders`, переключатели в редакторе | `test_reminders_api_validation`, `test_each_reminder_is_delivered_exactly_once` | выполнено |
| Календарь: месяц, неделя, день; клик открывает; перетаскивание переносит | `CalendarPage` | e2e «create tag and note… move it by drag and drop», «recurring occurrence: drag…» | выполнено ³ |
| Список: поиск по заголовку и тексту, фильтры по тегам, статусу, периоду; сортировка по дате и изменению | `build_list_query`, страница «Заметки» | `test_search_*`, `test_filter_*`, `test_sorting`, `test_pagination_is_stable_and_complete` | выполнено |
| «Ближайшее»: сегодня, неделя, отдельно прошедшие активные | `/api/upcoming`, экран «Предстоящие» | `test_upcoming_sections_in_user_timezone`, `test_overdue_has_no_hidden_cutoff` | выполнено |
| Настройки: почта, часовой пояс | `/api/settings`, страница «Настройки» | `test_settings_roundtrip`, e2e «changing user timezone…» | выполнено |

² Теги необязательны, как в PDF («может быть несколько»): заметка без тегов допустима, удаление тега снимает его с заметок (D8).
³ На сенсорных экранах перетаскивания нет (HTML5 DnD) — перенос через форму.

## Задание 1. Notetaker — «Ожидаемое поведение»

| Требование | Реализация | Доказательство | Статус |
|---|---|---|---|
| В момент «время − интервал» у активной заметки уходит письмо, ровно одно | планировщик (15 с) + журнал доставок с уникальным ключом, advisory lock, очередь писем `SKIP LOCKED` (D6) | `test_each_reminder_is_delivered_exactly_once`, `test_concurrent_scanners_do_not_duplicate`, `test_concurrent_senders_send_each_email_once`; Mailpit на чистом стеке; e2e — одно письмо на прогон | выполнено ⁴ |
| Уведомление в интерфейсе в тот же момент во всех открытых вкладках | WebSocket-рассылка | e2e «two tabs: … one reminder shown in both tabs»; `test_two_tabs_receive_same_notification…` | выполнено |
| Однажды показанное не всплывает снова после обновления страницы | показанные id запоминаются в браузере (исправлено 2026-10-28, коммит 2ea4cc6) | e2e: перезагрузка вкладки — уведомление и системное уведомление не повторяются; vitest `shown once per browser` | выполнено ⁵ |
| Деактивированная не напоминает; активировали до срока — возвращаются; после срока — прошедшие не досылаются | фильтр активности + `reminders_resume_at` (исправлено 2026-10-28, коммит 8b9ee9f) | `test_inactive_deleted_and_cancelled_get_no_reminders`, `test_reactivated_before_due_keeps_all_reminders`, `test_reactivated_after_due_does_not_send_past_reminders`, `test_occurrence_reactivated_after_due_does_not_send_past_reminders` (отдельное вхождение серии, D20) | выполнено |
| Изменение времени или интервала переносит напоминания | `fire_at` в ключе события; перепроверка очереди перед отправкой | `test_rescheduling_after_send_creates_new_event_once`, `test_changing_reminder_interval_moves_the_reminder`, `test_pending_email_cancelled_when_note_changed` | выполнено |
| Удаление отменяет; восстановление из корзины возвращает те, чей срок не наступил | удалённые не сканируются; очередь отменяется; `reminders_resume_at` | `test_pending_email_cancelled_when_note_changed` (случай «заметка удалена»), `test_restored_after_due_returns_only_reminders_not_yet_due` | выполнено |
| Корзина очищается сама через 30 дней | тик планировщика (`NOTETAKER_TRASH_RETENTION_DAYS`) | `test_trash_autopurge_after_retention_period` | выполнено |
| Повторяющаяся напоминает о каждом вхождении; изменение серии «с этого дня» не трогает прошлые | развёртка вхождений; разделение серии (D17) | `test_series_reminders_follow_moved_occurrence`, `test_split_changes_future_and_keeps_past`, `test_split_does_not_resend_reminders` | выполнено |
| Заметка в двух вкладках или на двух устройствах показывает одно и то же; календарь, список и «Ближайшее» обновляются без перезагрузки | WebSocket `changed` → обновление данных во всех вкладках | e2e «two tabs: data sync…» (список), «calendar and upcoming in another tab update without reload» | выполнено |
| При одновременной правке ни одна правка не теряется молча; второй видит, что версия изменилась | обязательная версия, проверка под `SELECT … FOR UPDATE`, 409; форма переносит правки (D14) | `test_concurrency.py` (два клиента на каждом пути, 8 одновременных запросов); e2e «editing the same note in two tabs», «two independent browsers»; нагрузка: 0 потерянных обновлений | выполнено |
| Время в поясе пользователя; смена пояса меняет отображение, не момент напоминания | UTC в БД, пояс серии у заметки (D4) | `test_timezone_change_does_not_move_reminder`, e2e «changing user timezone…» | выполнено |
| Прошедшая заметка переходит в «прошедшие» без обновления страницы | пересчёт разделов на клиенте по таймеру | e2e «upcoming: a note moves to overdue without page reload» | выполнено |
| Поиск и фильтры по всем заметкам; несколько тысяч открываются и листаются без задержек | серверный поиск и пагинация, индексы | `test_search_applies_to_whole_database_not_page`, `test_performance_with_5000_notes`; 10 млн — `docs/LOADTEST.md` (стр. 1 — 9.5 мс) | выполнено |
| После перезапуска заметки, теги и напоминания на месте; политика для пропущенных за время простоя описана | всё в PostgreSQL; водяной знак планировщика; политика D7 | `test_restart_restores_schedule_without_duplicates`, `test_missed_reminders_policy`; `scripts/restart_check.py` (SIGKILL реального процесса); перезапуск Docker с проверкой контрольной суммы | выполнено |

⁴ Строгое «ровно один раз» для внешнего SMTP невозможно в момент сбоя между приёмом письма и
записью статуса — описано в README и D6.
⁵ Запоминание — в браузере: на другом устройстве непрочитанное уведомление покажется один раз.

## Что не проверено
- Физические телефоны, экранные дикторы, Firefox и Safari (только Chromium с эмуляцией).
- Ручной просмотр интерфейса человеком; настоящие системные уведомления браузера (в e2e
  подменены заглушкой).
- Чистая машина без заранее скачанных базовых Docker-образов.
- Причина падения пропускной способности в последнем нагрузочном прогоне (`LOADTEST.md`).
