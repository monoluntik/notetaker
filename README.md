# Notetaker

Веб-приложение для заметок, привязанных к дате и времени: теги, календарь, повторения,
напоминания (email + уведомления в браузере), поиск и фильтрация.

> Статус: в разработке. Фактическое состояние этапов — `docs/PLAN.md` §5,
> результаты тестов — `docs/TESTING.md`.

## Стек
- Backend: Python 3.12, FastAPI, SQLAlchemy 2, Alembic, PostgreSQL 16, WebSocket.
- Frontend: React 19 + TypeScript, Vite, TanStack Query, luxon.
- Email: SMTP (Mailpit в docker compose) или вывод в лог.
- Тесты: pytest (на реальном PostgreSQL), vitest.

## Запуск через Docker Compose (основной способ)
```bash
docker compose up --build
```
- Приложение: http://localhost:8080
- Почтовый ящик Mailpit (письма-напоминания): http://localhost:8025

Миграции применяются автоматически при старте backend.

## Локальная разработка без Docker
Требуется Python 3.12 и Node.js ≥ 20.

```bash
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements-dev.txt pixeltable-pgserver
scripts/dev-db.sh start                     # PostgreSQL 16 на 127.0.0.1:5433

cd backend
../.venv/bin/alembic upgrade head
../.venv/bin/uvicorn app.main:app --port 8001 --reload

cd frontend                                 # в другом терминале
npm install
npm run dev                                 # http://localhost:5173 (проксирует /api и /ws на :8001)
```

`scripts/dev-db.sh` запускает настоящий PostgreSQL 16 из pip-пакета `pixeltable-pgserver`
(см. `docs/DECISIONS.md` D2). Можно использовать и любой свой PostgreSQL, задав
`NOTETAKER_DATABASE_URL`.

## Тесты
```bash
scripts/dev-db.sh start
cd backend && ../.venv/bin/pytest -q
cd frontend && npm test && npm run build
```

## Конфигурация (переменные окружения)
| Переменная | По умолчанию | Назначение |
|---|---|---|
| `NOTETAKER_DATABASE_URL` | `postgresql+psycopg://postgres@127.0.0.1:5433/notetaker` | БД |
| `NOTETAKER_EMAIL_BACKEND` | `console` | `console` или `smtp` |
| `NOTETAKER_SMTP_HOST` / `_PORT` / `_FROM` | `localhost` / `1025` / `notetaker@localhost` | SMTP |
| `NOTETAKER_SCHEDULER_INTERVAL_SECONDS` | `15` | Период планировщика напоминаний |

## Документация
- `docs/PLAN.md` — план, матрица требований, риски.
- `docs/DECISIONS.md` — архитектурные решения.
- `docs/TESTING.md` — команды и фактические результаты тестов.
- `docs/WORKLOG.md` — хронология работы (разработка выполнена ИИ-агентом Claude Code).
